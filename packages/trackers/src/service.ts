import type { Database } from "@openvalens/db";
import { user } from "@openvalens/db/schema/auth";
import { customTracker, customTrackerEntry } from "@openvalens/db/schema/trackers";
import { and, asc, between, count, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import {
  addDays,
  aggregateValues,
  aggregationAllowed,
  datesBetween,
  defaultAggregation,
  findTrackerTemplate,
  localDateIn,
  roundForDisplay,
  targetProgress,
  TRACKER_LIMITS,
  trackerValueProblem,
  weekStart,
  type TargetProgress,
  type TrackerAggregation,
  type TrackerChartDays,
  type TrackerCreateInput,
  type TrackerIcon,
  type TrackerTarget,
  type TrackerTemplateId,
  type TrackerType,
  type TrackerUpdateInput,
} from "./model";

/**
 * Custom trackers (Issue #441): the database service.
 *
 * Every call takes the caller's organization and user from the server
 * session, never from input. Visibility: a tracker is visible to its owner,
 * and to the other members of the workspace only while it is shared (the API
 * checks their `records:read` first). Collaborators and above (`records:write`)
 * log into a shared tracker; only the owner changes, shares, archives or
 * deletes it. Turning sharing off hides other members' entries from them and
 * deletes nothing.
 *
 * Nothing here logs; values and notes never reach a log line.
 */

export type TrackerScope = { organizationId: string; userId: string };
/** The member asking, and whether their role may write records. */
export type TrackerViewer = TrackerScope & { canWrite: boolean };

export type TrackerErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "LOCKED"
  | "LIMIT"
  | "ARCHIVED"
  | "CONFIRMATION"
  | "INVALID";

export class TrackerError extends Error {
  constructor(
    readonly code: TrackerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TrackerError";
  }
}

export type TrackerPerson = { userId: string | null; name: string | null; isYou: boolean };

export type TrackerView = {
  id: string;
  name: string;
  icon: TrackerIcon;
  template: TrackerTemplateId | null;
  type: TrackerType;
  unit: string | null;
  decimals: number;
  aggregation: TrackerAggregation;
  target: TrackerTarget | null;
  shared: boolean;
  aiVisible: boolean;
  archivedAt: string | null;
  owner: TrackerPerson;
  /** The owner may change, share, archive and delete it. */
  canEdit: boolean;
  /** The caller may add entries. */
  canLog: boolean;
  /** Type, unit and aggregation are locked once the tracker has an entry. */
  locked: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TrackerSummary = TrackerView & {
  /** Today's combined value, or null with no entry today. */
  today: number | null;
  progress: TargetProgress | null;
};

export type TrackerEntryView = {
  id: string;
  trackerId: string;
  value: number;
  loggedAt: string;
  localDate: string;
  note: string | null;
  source: string;
  loggedBy: TrackerPerson;
  canEdit: boolean;
};

export type TrackerChart = {
  trackerId: string;
  from: string;
  to: string;
  days: { date: string; value: number | null; count: number }[];
  loggedDays: number;
  /** The average of the logged days' values. */
  average: number | null;
  /** The total of the logged days' values (sum trackers and yes days). */
  total: number | null;
  progress: TargetProgress | null;
};

type TrackerRow = typeof customTracker.$inferSelect;
type EntryRow = typeof customTrackerEntry.$inferSelect;

/** Accepts a `loggedAt` up to ten minutes ahead, for clock drift. */
const FUTURE_TOLERANCE_MS = 10 * 60_000;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function targetOf(row: TrackerRow): TrackerTarget | null {
  return row.targetValue !== null && row.targetPeriod
    ? { value: row.targetValue, period: row.targetPeriod as TrackerTarget["period"] }
    : null;
}

function canLogInto(row: TrackerRow, viewer: TrackerViewer): boolean {
  if (row.archivedAt) return false;
  if (row.userId === viewer.userId) return viewer.canWrite;
  return row.shared && viewer.canWrite;
}

function viewOf(
  row: TrackerRow,
  viewer: TrackerViewer,
  ownerName: string | null,
  entryCount: number,
): TrackerView {
  const isOwner = row.userId === viewer.userId;
  return {
    id: row.id,
    name: row.name,
    icon: row.icon as TrackerIcon,
    template: (row.template as TrackerTemplateId | null) ?? null,
    type: row.type as TrackerType,
    unit: row.unit,
    decimals: row.decimals,
    aggregation: row.aggregation as TrackerAggregation,
    target: targetOf(row),
    shared: row.shared,
    aiVisible: row.aiVisible,
    archivedAt: iso(row.archivedAt),
    owner: { userId: row.userId, name: ownerName, isYou: isOwner },
    canEdit: isOwner && viewer.canWrite,
    canLog: canLogInto(row, viewer),
    locked: entryCount > 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function checkValue(type: TrackerType, value: number) {
  const problem = trackerValueProblem(type, value);
  if (problem) throw new TrackerError("INVALID", problem);
}

function checkLoggedAt(loggedAt: Date, now: Date) {
  if (!Number.isFinite(loggedAt.getTime())) throw new TrackerError("INVALID", "Enter a time.");
  if (loggedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS)
    throw new TrackerError("INVALID", "The time cannot be in the future.");
}

/** Daily values for a set of entries, keyed by tracker then date. */
function dailyValues(
  trackers: readonly TrackerRow[],
  entries: readonly Pick<EntryRow, "trackerId" | "localDate" | "value" | "loggedAt">[],
) {
  const byTracker = new Map<string, Map<string, Pick<EntryRow, "value" | "loggedAt">[]>>();
  for (const entry of entries) {
    const days = byTracker.get(entry.trackerId) ?? new Map();
    const list = days.get(entry.localDate) ?? [];
    list.push(entry);
    days.set(entry.localDate, list);
    byTracker.set(entry.trackerId, days);
  }
  const aggregationOf = new Map(trackers.map((row) => [row.id, row.aggregation]));
  const out = new Map<string, Map<string, { value: number; count: number }>>();
  for (const [trackerId, days] of byTracker) {
    const aggregation = aggregationOf.get(trackerId) as TrackerAggregation | undefined;
    if (!aggregation) continue;
    const values = new Map<string, { value: number; count: number }>();
    for (const [date, list] of days) {
      const value = aggregateValues(aggregation, list);
      if (value !== null) values.set(date, { value, count: list.length });
    }
    out.set(trackerId, values);
  }
  return out;
}

export function createTrackerService(input: { db: Database; now?: () => Date }) {
  const { db } = input;
  const now = input.now ?? (() => new Date());

  const visibleTo = (viewer: TrackerScope) =>
    and(
      eq(customTracker.organizationId, viewer.organizationId),
      or(eq(customTracker.userId, viewer.userId), eq(customTracker.shared, true)),
    );

  async function names(userIds: readonly (string | null)[]): Promise<Map<string, string | null>> {
    const ids = [...new Set(userIds.filter((id): id is string => !!id))];
    if (ids.length === 0) return new Map();
    const rows = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(inArray(user.id, ids));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async function entryCounts(trackerIds: readonly string[]): Promise<Map<string, number>> {
    if (trackerIds.length === 0) return new Map();
    const rows = await db
      .select({ trackerId: customTrackerEntry.trackerId, n: count() })
      .from(customTrackerEntry)
      .where(inArray(customTrackerEntry.trackerId, [...trackerIds]))
      .groupBy(customTrackerEntry.trackerId);
    return new Map(rows.map((row) => [row.trackerId, Number(row.n)]));
  }

  /** A tracker the viewer can see, or NOT_FOUND. */
  async function visible(viewer: TrackerScope, id: string): Promise<TrackerRow> {
    const [row] = await db
      .select()
      .from(customTracker)
      .where(and(eq(customTracker.id, id), visibleTo(viewer)));
    if (!row) throw new TrackerError("NOT_FOUND", "Tracker not found.");
    return row;
  }

  /** A tracker the viewer owns (and may write), or NOT_FOUND / FORBIDDEN. */
  async function owned(viewer: TrackerViewer, id: string): Promise<TrackerRow> {
    const row = await visible(viewer, id);
    if (row.userId !== viewer.userId || !viewer.canWrite)
      throw new TrackerError("FORBIDDEN", "Only the tracker's owner can change it.");
    return row;
  }

  async function view(viewer: TrackerViewer, row: TrackerRow): Promise<TrackerView> {
    const [ownerNames, counts] = await Promise.all([names([row.userId]), entryCounts([row.id])]);
    return viewOf(row, viewer, ownerNames.get(row.userId) ?? null, counts.get(row.id) ?? 0);
  }

  async function activeCount(
    tx: Pick<Database, "select" | "execute">,
    scope: TrackerScope,
  ): Promise<number> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`custom-tracker:${scope.organizationId}:${scope.userId}`}, 0))`,
    );
    const [row] = await tx
      .select({ n: count() })
      .from(customTracker)
      .where(
        and(
          eq(customTracker.organizationId, scope.organizationId),
          eq(customTracker.userId, scope.userId),
          isNull(customTracker.archivedAt),
        ),
      );
    return Number(row?.n ?? 0);
  }

  function entryView(
    entry: EntryRow,
    tracker: TrackerRow,
    viewer: TrackerViewer,
    loggedByName: string | null,
  ): TrackerEntryView {
    const isOwner = tracker.userId === viewer.userId;
    const isLogger = entry.loggedByUserId === viewer.userId;
    return {
      id: entry.id,
      trackerId: entry.trackerId,
      value: entry.value,
      loggedAt: entry.loggedAt.toISOString(),
      localDate: entry.localDate,
      note: entry.note,
      source: entry.source,
      loggedBy: { userId: entry.loggedByUserId, name: loggedByName, isYou: isLogger },
      canEdit: viewer.canWrite && (isOwner || (isLogger && tracker.shared && !tracker.archivedAt)),
    };
  }

  /** An entry the viewer can see, with its tracker. */
  async function visibleEntry(viewer: TrackerScope, id: string) {
    const [row] = await db
      .select({ entry: customTrackerEntry, tracker: customTracker })
      .from(customTrackerEntry)
      .innerJoin(customTracker, eq(customTracker.id, customTrackerEntry.trackerId))
      .where(and(eq(customTrackerEntry.id, id), visibleTo(viewer)));
    if (!row) throw new TrackerError("NOT_FOUND", "Entry not found.");
    return row;
  }

  return Object.freeze({
    /** The trackers the viewer can see, own first, with today's value and target progress. */
    async list(
      viewer: TrackerViewer,
      options: { timeZone: string; includeArchived?: boolean },
    ): Promise<TrackerSummary[]> {
      const rows = await db
        .select()
        .from(customTracker)
        .where(
          and(
            visibleTo(viewer),
            options.includeArchived ? undefined : isNull(customTracker.archivedAt),
          ),
        )
        .orderBy(asc(customTracker.createdAt), asc(customTracker.id));
      if (rows.length === 0) return [];
      const today = localDateIn(now(), options.timeZone);
      const from = weekStart(today);
      const ids = rows.map((row) => row.id);
      const [ownerNames, counts, entries] = await Promise.all([
        names(rows.map((row) => row.userId)),
        entryCounts(ids),
        db
          .select({
            trackerId: customTrackerEntry.trackerId,
            localDate: customTrackerEntry.localDate,
            value: customTrackerEntry.value,
            loggedAt: customTrackerEntry.loggedAt,
          })
          .from(customTrackerEntry)
          .where(
            and(
              inArray(customTrackerEntry.trackerId, ids),
              between(customTrackerEntry.localDate, from, today),
            ),
          ),
      ]);
      const daily = dailyValues(rows, entries);
      const summaries = rows.map((row) => {
        const days = daily.get(row.id);
        const target = targetOf(row);
        const series = (target?.period === "week" ? datesBetween(from, today) : [today]).map(
          (date) => ({ date, value: days?.get(date)?.value ?? null }),
        );
        return {
          ...viewOf(row, viewer, ownerNames.get(row.userId) ?? null, counts.get(row.id) ?? 0),
          today: days?.get(today)?.value ?? null,
          progress: target
            ? targetProgress(row.aggregation as TrackerAggregation, target, series)
            : null,
        };
      });
      return summaries.sort((a, b) => Number(b.owner.isYou) - Number(a.owner.isYou));
    },

    async get(viewer: TrackerViewer, id: string): Promise<TrackerView> {
      return view(viewer, await visible(viewer, id));
    },

    async create(viewer: TrackerViewer, input: TrackerCreateInput): Promise<TrackerView> {
      if (!viewer.canWrite) throw new TrackerError("FORBIDDEN", "Your role cannot add trackers.");
      const template = findTrackerTemplate(input.template);
      const aggregation = input.aggregation ?? defaultAggregation(input.type);
      if (!aggregationAllowed(input.type, aggregation))
        throw new TrackerError(
          "INVALID",
          "This tracker type combines a day's entries in a fixed way.",
        );
      const row = await db.transaction(async (tx) => {
        if ((await activeCount(tx, viewer)) >= TRACKER_LIMITS.activePerMember)
          throw new TrackerError(
            "LIMIT",
            `You can have up to ${TRACKER_LIMITS.activePerMember} active trackers. Archive one first.`,
          );
        const [created] = await tx
          .insert(customTracker)
          .values({
            organizationId: viewer.organizationId,
            userId: viewer.userId,
            name: input.name,
            icon: input.icon,
            template: input.template ?? null,
            type: input.type,
            unit: input.type === "number" ? (input.unit ?? null) : null,
            decimals: input.type === "number" ? (input.decimals ?? 0) : 0,
            aggregation,
            targetValue: input.target?.value ?? null,
            targetPeriod: input.target?.period ?? null,
            shared: input.shared ?? false,
            aiVisible: input.aiVisible ?? template?.aiVisible ?? true,
          })
          .returning();
        return created!;
      });
      return view(viewer, row);
    },

    async update(viewer: TrackerViewer, input: TrackerUpdateInput): Promise<TrackerView> {
      const row = await owned(viewer, input.id);
      const type = input.type ?? (row.type as TrackerType);
      const typeChanged = type !== row.type;
      const unit =
        type === "number"
          ? input.unit !== undefined
            ? input.unit
            : typeChanged
              ? null
              : row.unit
          : null;
      const aggregation =
        input.aggregation ??
        (typeChanged ? defaultAggregation(type) : (row.aggregation as TrackerAggregation));
      const shapeChanged =
        typeChanged || (unit ?? null) !== (row.unit ?? null) || aggregation !== row.aggregation;
      if (shapeChanged && ((await entryCounts([row.id])).get(row.id) ?? 0) > 0)
        throw new TrackerError(
          "LOCKED",
          "Type, unit and how a day's entries combine cannot change after the first entry. Create a new tracker instead.",
        );
      if (type === "number" && !unit) throw new TrackerError("INVALID", "Enter a unit.");
      if (!aggregationAllowed(type, aggregation))
        throw new TrackerError(
          "INVALID",
          "This tracker type combines a day's entries in a fixed way.",
        );
      const target = input.target !== undefined ? input.target : targetOf(row);
      const [updated] = await db
        .update(customTracker)
        .set({
          name: input.name ?? row.name,
          icon: input.icon ?? row.icon,
          type,
          unit,
          aggregation,
          decimals: type === "number" ? (input.decimals ?? row.decimals) : 0,
          targetValue: target?.value ?? null,
          targetPeriod: target?.period ?? null,
          shared: input.shared ?? row.shared,
          aiVisible: input.aiVisible ?? row.aiVisible,
          updatedAt: now(),
        })
        .where(and(eq(customTracker.id, row.id), eq(customTracker.userId, viewer.userId)))
        .returning();
      return view(viewer, updated!);
    },

    /** Archive hides the tracker and keeps its data; restoring counts toward the limit. */
    async setArchived(viewer: TrackerViewer, id: string, archived: boolean): Promise<TrackerView> {
      const row = await owned(viewer, id);
      if (Boolean(row.archivedAt) === archived) return view(viewer, row);
      const updated = await db.transaction(async (tx) => {
        if (!archived && (await activeCount(tx, viewer)) >= TRACKER_LIMITS.activePerMember)
          throw new TrackerError(
            "LIMIT",
            `You can have up to ${TRACKER_LIMITS.activePerMember} active trackers. Archive one first.`,
          );
        const [next] = await tx
          .update(customTracker)
          .set({ archivedAt: archived ? now() : null, updatedAt: now() })
          .where(and(eq(customTracker.id, row.id), eq(customTracker.userId, viewer.userId)))
          .returning();
        return next!;
      });
      return view(viewer, updated);
    },

    /** Deletes the tracker and erases its entries. Needs its name typed back. */
    async remove(
      viewer: TrackerViewer,
      id: string,
      confirmation: string,
    ): Promise<{ deletedEntries: number }> {
      const row = await owned(viewer, id);
      if (confirmation.trim() !== row.name.trim())
        throw new TrackerError("CONFIRMATION", "Type the tracker's name to delete it.");
      return db.transaction(async (tx) => {
        const entries = await tx
          .delete(customTrackerEntry)
          .where(eq(customTrackerEntry.trackerId, row.id))
          .returning({ id: customTrackerEntry.id });
        await tx
          .delete(customTracker)
          .where(and(eq(customTracker.id, row.id), eq(customTracker.userId, viewer.userId)));
        return { deletedEntries: entries.length };
      });
    },

    /**
     * Logs one entry. `options` is for a connected AI app (#439, M2b): `aiApp`
     * accepts only the viewer's own tracker with its AI switch on, and `entryId`
     * makes a retry a no-op (an existing entry with that id, in the same
     * tracker, is returned instead of writing again).
     */
    async log(
      viewer: TrackerViewer,
      input: {
        trackerId: string;
        value: number;
        loggedAt?: string;
        timeZone: string;
        note?: string | null;
      },
      options: { aiApp?: boolean; entryId?: string } = {},
    ): Promise<TrackerEntryView> {
      const tracker = await visible(viewer, input.trackerId);
      if (tracker.archivedAt) throw new TrackerError("ARCHIVED", "Restore this tracker to log it.");
      if (!canLogInto(tracker, viewer))
        throw new TrackerError("FORBIDDEN", "You cannot add entries to this tracker.");
      if (options.aiApp && (tracker.userId !== viewer.userId || !tracker.aiVisible))
        throw new TrackerError(
          "FORBIDDEN",
          "AI apps can log only into the member's own trackers that they let AI apps read.",
        );
      checkValue(tracker.type as TrackerType, input.value);
      const loggedAt = input.loggedAt ? new Date(input.loggedAt) : now();
      checkLoggedAt(loggedAt, now());
      const [entry] = await db
        .insert(customTrackerEntry)
        .values({
          ...(options.entryId ? { id: options.entryId } : {}),
          trackerId: tracker.id,
          organizationId: tracker.organizationId,
          userId: tracker.userId,
          loggedByUserId: viewer.userId,
          value: input.value,
          loggedAt,
          localDate: localDateIn(loggedAt, input.timeZone),
          note: input.note?.trim() ? input.note.trim() : null,
          source: "manual",
        })
        .onConflictDoNothing({ target: customTrackerEntry.id })
        .returning();
      let saved = entry;
      if (!saved && options.entryId) {
        // A retry: the entry is already there. Only ever the same tracker's.
        [saved] = await db
          .select()
          .from(customTrackerEntry)
          .where(
            and(
              eq(customTrackerEntry.id, options.entryId),
              eq(customTrackerEntry.trackerId, tracker.id),
              eq(customTrackerEntry.organizationId, tracker.organizationId),
            ),
          );
        if (!saved) throw new TrackerError("INVALID", "This entry id is already taken.");
      }
      const loggedBy = await names([viewer.userId]);
      return entryView(saved!, tracker, viewer, loggedBy.get(viewer.userId) ?? null);
    },

    async updateEntry(
      viewer: TrackerViewer,
      input: {
        id: string;
        value?: number;
        loggedAt?: string;
        timeZone: string;
        note?: string | null;
      },
    ): Promise<TrackerEntryView> {
      const { entry, tracker } = await visibleEntry(viewer, input.id);
      const current = entryView(entry, tracker, viewer, null);
      if (!current.canEdit) throw new TrackerError("FORBIDDEN", "You cannot change this entry.");
      if (input.value !== undefined) checkValue(tracker.type as TrackerType, input.value);
      const loggedAt = input.loggedAt ? new Date(input.loggedAt) : entry.loggedAt;
      if (input.loggedAt) checkLoggedAt(loggedAt, now());
      const [updated] = await db
        .update(customTrackerEntry)
        .set({
          value: input.value ?? entry.value,
          loggedAt,
          localDate: input.loggedAt ? localDateIn(loggedAt, input.timeZone) : entry.localDate,
          note:
            input.note === undefined ? entry.note : input.note?.trim() ? input.note.trim() : null,
          updatedAt: now(),
        })
        .where(eq(customTrackerEntry.id, entry.id))
        .returning();
      const loggedBy = await names([updated!.loggedByUserId]);
      return entryView(
        updated!,
        tracker,
        viewer,
        updated!.loggedByUserId ? (loggedBy.get(updated!.loggedByUserId) ?? null) : null,
      );
    },

    async deleteEntry(viewer: TrackerViewer, id: string): Promise<void> {
      const { entry, tracker } = await visibleEntry(viewer, id);
      if (!entryView(entry, tracker, viewer, null).canEdit)
        throw new TrackerError("FORBIDDEN", "You cannot delete this entry.");
      await db.delete(customTrackerEntry).where(eq(customTrackerEntry.id, entry.id));
    },

    /** A tracker's entries, newest first. */
    async entries(
      viewer: TrackerViewer,
      input: { trackerId: string; limit?: number; before?: string },
    ): Promise<{ entries: TrackerEntryView[]; hasMore: boolean }> {
      const tracker = await visible(viewer, input.trackerId);
      const limit = input.limit ?? 50;
      const rows = await db
        .select()
        .from(customTrackerEntry)
        .where(
          and(
            eq(customTrackerEntry.trackerId, tracker.id),
            input.before ? lt(customTrackerEntry.loggedAt, new Date(input.before)) : undefined,
          ),
        )
        .orderBy(desc(customTrackerEntry.loggedAt), desc(customTrackerEntry.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const loggedBy = await names(page.map((row) => row.loggedByUserId));
      return {
        entries: page.map((row) =>
          entryView(
            row,
            tracker,
            viewer,
            row.loggedByUserId ? (loggedBy.get(row.loggedByUserId) ?? null) : null,
          ),
        ),
        hasMore: rows.length > limit,
      };
    },

    /** One value per day over the last 30, 90 or 365 days, with target progress. */
    async chart(
      viewer: TrackerViewer,
      input: { trackerId: string; days: TrackerChartDays; timeZone: string },
    ): Promise<TrackerChart> {
      const tracker = await visible(viewer, input.trackerId);
      const to = localDateIn(now(), input.timeZone);
      const from = addDays(to, -(input.days - 1));
      const target = targetOf(tracker);
      // A weekly target needs the whole first week.
      const readFrom = target?.period === "week" ? weekStart(from) : from;
      const entries = await db
        .select({
          trackerId: customTrackerEntry.trackerId,
          localDate: customTrackerEntry.localDate,
          value: customTrackerEntry.value,
          loggedAt: customTrackerEntry.loggedAt,
        })
        .from(customTrackerEntry)
        .where(
          and(
            eq(customTrackerEntry.trackerId, tracker.id),
            between(customTrackerEntry.localDate, readFrom, to),
          ),
        );
      const daily = dailyValues([tracker], entries).get(tracker.id) ?? new Map();
      const series = (from0: string) =>
        datesBetween(from0, to).map((date) => ({
          date,
          value: daily.get(date)?.value ?? null,
          count: daily.get(date)?.count ?? 0,
        }));
      const days = series(from);
      const logged = days.filter((day) => day.value !== null).map((day) => day.value as number);
      const total = logged.reduce((sum, value) => sum + value, 0);
      return {
        trackerId: tracker.id,
        from,
        to,
        days,
        loggedDays: logged.length,
        average: logged.length ? roundForDisplay(total / logged.length, 2) : null,
        total: logged.length ? total : null,
        progress: target
          ? targetProgress(tracker.aggregation as TrackerAggregation, target, series(readFrom))
          : null,
      };
    },
  });
}

export type TrackerService = ReturnType<typeof createTrackerService>;

// ─── AI reads (Coach and connected AI apps) ───────────────────

export type AiTrackerRow = {
  id: string;
  name: string;
  template: TrackerTemplateId | null;
  type: TrackerType;
  unit: string | null;
  decimals: number;
  aggregation: TrackerAggregation;
  target: TrackerTarget | null;
};

/**
 * The trackers an AI tool may read for a member: their own, not archived,
 * with "Coach and connected AI apps can read this" on. Other members' shared
 * trackers are never included. Notes are not read here.
 */
export async function listAiReadableTrackers(
  db: Database,
  scope: TrackerScope,
): Promise<AiTrackerRow[]> {
  const rows = await db
    .select()
    .from(customTracker)
    .where(
      and(
        eq(customTracker.organizationId, scope.organizationId),
        eq(customTracker.userId, scope.userId),
        eq(customTracker.aiVisible, true),
        isNull(customTracker.archivedAt),
      ),
    )
    .orderBy(asc(customTracker.createdAt), asc(customTracker.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    template: (row.template as TrackerTemplateId | null) ?? null,
    type: row.type as TrackerType,
    unit: row.unit,
    decimals: row.decimals,
    aggregation: row.aggregation as TrackerAggregation,
    target: targetOf(row),
  }));
}

/** Per-day combined values of those trackers over a date range (no notes). */
export async function listAiTrackerDays(
  db: Database,
  scope: TrackerScope,
  trackers: readonly AiTrackerRow[],
  range: { from: string; to: string },
): Promise<Map<string, { date: string; value: number; count: number }[]>> {
  if (trackers.length === 0) return new Map();
  const entries = await db
    .select({
      trackerId: customTrackerEntry.trackerId,
      localDate: customTrackerEntry.localDate,
      value: customTrackerEntry.value,
      loggedAt: customTrackerEntry.loggedAt,
    })
    .from(customTrackerEntry)
    .where(
      and(
        eq(customTrackerEntry.organizationId, scope.organizationId),
        eq(customTrackerEntry.userId, scope.userId),
        inArray(
          customTrackerEntry.trackerId,
          trackers.map((tracker) => tracker.id),
        ),
        between(customTrackerEntry.localDate, range.from, range.to),
      ),
    );
  const aggregationOf = new Map(trackers.map((tracker) => [tracker.id, tracker.aggregation]));
  const grouped = new Map<string, Map<string, { value: number; loggedAt: Date }[]>>();
  for (const entry of entries) {
    const days = grouped.get(entry.trackerId) ?? new Map();
    const list = days.get(entry.localDate) ?? [];
    list.push(entry);
    days.set(entry.localDate, list);
    grouped.set(entry.trackerId, days);
  }
  const out = new Map<string, { date: string; value: number; count: number }[]>();
  for (const [trackerId, days] of grouped) {
    const aggregation = aggregationOf.get(trackerId)!;
    out.set(
      trackerId,
      [...days.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, list]) => ({
          date,
          value: aggregateValues(aggregation, list)!,
          count: list.length,
        })),
    );
  }
  return out;
}
