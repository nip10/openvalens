import type { Database } from "@openvalens/db";
import { painEntry, painPreference } from "@openvalens/db/schema/pain";
import { workout } from "@openvalens/db/schema/plans";
import { and, asc, between, count, desc, eq, inArray, max } from "drizzle-orm";

import {
  addDays,
  daysBetween,
  localDateIn,
  PAIN_LIMITS,
  PAIN_WORKOUT_LOOKBACK_DAYS,
  type PainHistoryWindow,
  type PainLogInput,
  type PainMapWindow,
  type PainType,
} from "./model";

/**
 * Pain log reads and writes (Issue #442). Every function takes the member
 * (organization plus user) from the server session, never from input, and
 * reads only that member's rows: workspace roles never reach another
 * member's pain log. While the opt-in is off, reads return nothing and logging
 * is refused; turning it off deletes nothing (erasure does).
 */

export type PainScope = { organizationId: string; userId: string };

export type PainPreference = { enabled: boolean; aiVisible: boolean };

export type PainEntry = {
  id: string;
  region: string;
  rating: number;
  type: PainType | null;
  loggedAt: string;
  localDate: string;
  note: string | null;
  createdAt: string;
};

export type PainMapRegion = {
  region: string;
  /** Highest rating in the window. */
  highest: number;
  entryCount: number;
  lastLoggedAt: string;
};

export type PainWorkoutFact = {
  id: number;
  type: string;
  date: string;
  durationMinutes: number | null;
  /** 0 = the same day, 1 = the day before, 2 = two days before. */
  daysBefore: number;
};

export type PainHistoryEntry = PainEntry & { workoutsBefore: PainWorkoutFact[] };

export class PainError extends Error {
  constructor(
    readonly code: "DISABLED" | "INVALID",
    message: string,
  ) {
    super(message);
  }
}

/** Allowed clock skew for "not in the future". */
const FUTURE_SKEW_MS = 5 * 60_000;

const entryColumns = {
  id: painEntry.id,
  region: painEntry.region,
  rating: painEntry.rating,
  type: painEntry.type,
  loggedAt: painEntry.loggedAt,
  localDate: painEntry.localDate,
  note: painEntry.note,
  createdAt: painEntry.createdAt,
};

type EntryRow = {
  id: string;
  region: string;
  rating: number;
  type: string | null;
  loggedAt: Date;
  localDate: string;
  note: string | null;
  createdAt: Date;
};

function toEntry(row: EntryRow): PainEntry {
  return {
    id: row.id,
    region: row.region,
    rating: row.rating,
    type: (row.type as PainType | null) ?? null,
    loggedAt: row.loggedAt.toISOString(),
    localDate: row.localDate,
    note: row.note ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function own(scope: PainScope) {
  return and(
    eq(painEntry.organizationId, scope.organizationId),
    eq(painEntry.userId, scope.userId),
  );
}

export async function readPainPreference(db: Database, userId: string): Promise<PainPreference> {
  const [row] = await db
    .select({ enabled: painPreference.enabled, aiVisible: painPreference.aiVisible })
    .from(painPreference)
    .where(eq(painPreference.userId, userId));
  return { enabled: row?.enabled ?? false, aiVisible: row?.aiVisible ?? false };
}

export function createPainService(options: { db: Database; now?: () => Date }) {
  const { db } = options;
  const now = options.now ?? (() => new Date());

  return {
    preference: (userId: string) => readPainPreference(db, userId),

    async setPreference(
      userId: string,
      change: { enabled?: boolean; aiVisible?: boolean },
    ): Promise<PainPreference> {
      const current = await readPainPreference(db, userId);
      const next = {
        enabled: change.enabled ?? current.enabled,
        aiVisible: change.aiVisible ?? current.aiVisible,
      };
      await db
        .insert(painPreference)
        .values({ userId, ...next, updatedAt: now() })
        .onConflictDoUpdate({
          target: painPreference.userId,
          set: { ...next, updatedAt: now() },
        });
      return next;
    },

    /**
     * One entry per region. Refused while the pain log is off.
     *
     * `options` is for a connected AI app (#439, M2b): `aiApp` also needs the
     * pain AI switch on (re-checked inside the write), and `ids` (one per
     * region) make a retry a no-op: an entry that already has its id is
     * returned instead of written again.
     */
    async log(
      scope: PainScope,
      input: PainLogInput,
      options: { aiApp?: boolean; ids?: readonly string[] } = {},
    ): Promise<PainEntry[]> {
      const at = input.loggedAt ? new Date(input.loggedAt) : now();
      if (at.getTime() > now().getTime() + FUTURE_SKEW_MS)
        throw new PainError("INVALID", "The time cannot be in the future.");
      if (options.ids && options.ids.length !== input.regions.length)
        throw new PainError("INVALID", "Give one id per region.");
      const localDate = localDateIn(at, input.timeZone);
      const note = input.note?.trim() ? input.note.trim() : null;
      return db.transaction(async (tx) => {
        // Re-checked inside the write so turning it off mid-request stores nothing.
        const [preference] = await tx
          .select({ enabled: painPreference.enabled, aiVisible: painPreference.aiVisible })
          .from(painPreference)
          .where(eq(painPreference.userId, scope.userId))
          .for("share");
        if (!preference?.enabled) throw new PainError("DISABLED", "Turn on the pain log first.");
        if (options.aiApp && !preference.aiVisible)
          throw new PainError(
            "DISABLED",
            'The member has not let AI apps use their pain log ("Coach and connected AI apps can read my pain log" is off).',
          );
        const rows = await tx
          .insert(painEntry)
          .values(
            input.regions.map((region, index) => ({
              ...(options.ids ? { id: options.ids[index] } : {}),
              organizationId: scope.organizationId,
              userId: scope.userId,
              region,
              rating: input.rating,
              type: input.type ?? null,
              loggedAt: at,
              localDate,
              note,
            })),
          )
          .onConflictDoNothing({ target: painEntry.id })
          .returning(entryColumns);
        if (!options.ids || rows.length === input.regions.length) return rows.map(toEntry);
        // A retry: the missing ones are already there, and only ever the member's own.
        const existing = await tx
          .select(entryColumns)
          .from(painEntry)
          .where(and(own(scope), inArray(painEntry.id, [...options.ids])));
        const byId = new Map(existing.map((row) => [row.id, row]));
        return options.ids.map((id) => {
          const row = byId.get(id);
          if (!row) throw new PainError("INVALID", "This entry id is already taken.");
          return toEntry(row);
        });
      });
    },

    /** Deletes one of the member's own entries, whether or not the log is on. */
    async delete(scope: PainScope, id: string): Promise<boolean> {
      const rows = await db
        .delete(painEntry)
        .where(and(own(scope), eq(painEntry.id, id)))
        .returning({ id: painEntry.id });
      return rows.length > 0;
    },

    /** The highest rating per region over the last `days` local days. */
    async map(
      scope: PainScope,
      input: { days: PainMapWindow; timeZone: string },
    ): Promise<{ enabled: boolean; from: string; to: string; regions: PainMapRegion[] }> {
      const to = localDateIn(now(), input.timeZone);
      const from = addDays(to, -(input.days - 1));
      const { enabled } = await readPainPreference(db, scope.userId);
      if (!enabled) return { enabled, from, to, regions: [] };
      const rows = await db
        .select({
          region: painEntry.region,
          highest: max(painEntry.rating),
          entryCount: count(painEntry.id),
          lastLoggedAt: max(painEntry.loggedAt),
        })
        .from(painEntry)
        .where(and(own(scope), between(painEntry.localDate, from, to)))
        .groupBy(painEntry.region)
        .orderBy(asc(painEntry.region));
      return {
        enabled,
        from,
        to,
        regions: rows.map((row) => ({
          region: row.region,
          highest: row.highest ?? 0,
          entryCount: row.entryCount,
          lastLoggedAt: (row.lastLoggedAt ?? new Date(0)).toISOString(),
        })),
      };
    },

    /**
     * One region's ratings over time, newest first, each with the member's
     * own workouts dated that day or up to two days before (48 h), as plain
     * facts. Nothing links a workout to a rating beyond the dates.
     */
    async history(
      scope: PainScope,
      input: { region: string; days: PainHistoryWindow; timeZone: string },
    ): Promise<{
      enabled: boolean;
      region: string;
      from: string;
      to: string;
      entries: PainHistoryEntry[];
    }> {
      const to = localDateIn(now(), input.timeZone);
      const from = addDays(to, -(input.days - 1));
      const { enabled } = await readPainPreference(db, scope.userId);
      if (!enabled) return { enabled, region: input.region, from, to, entries: [] };
      const rows = await db
        .select(entryColumns)
        .from(painEntry)
        .where(
          and(
            own(scope),
            eq(painEntry.region, input.region),
            between(painEntry.localDate, from, to),
          ),
        )
        .orderBy(desc(painEntry.loggedAt), desc(painEntry.id))
        .limit(PAIN_LIMITS.historyEntries);
      const entries = rows.map(toEntry);
      if (entries.length === 0) return { enabled, region: input.region, from, to, entries: [] };
      const days = entries.map((entry) => entry.localDate).sort();
      const workouts = await db
        .select({
          id: workout.id,
          type: workout.type,
          date: workout.date,
          duration: workout.duration,
        })
        .from(workout)
        .where(
          and(
            eq(workout.organizationId, scope.organizationId),
            eq(workout.userId, scope.userId),
            between(workout.date, addDays(days[0]!, -PAIN_WORKOUT_LOOKBACK_DAYS), days.at(-1)!),
          ),
        )
        .orderBy(desc(workout.date), desc(workout.id));
      return {
        enabled,
        region: input.region,
        from,
        to,
        entries: entries.map((entry) => ({
          ...entry,
          workoutsBefore: workouts.flatMap((row) => {
            const daysBefore = daysBetween(row.date, entry.localDate);
            if (daysBefore < 0 || daysBefore > PAIN_WORKOUT_LOOKBACK_DAYS) return [];
            return [
              {
                id: row.id,
                type: row.type,
                date: row.date,
                durationMinutes: row.duration ?? null,
                daysBefore,
              },
            ];
          }),
        })),
      };
    },
  };
}

export type AiPainEntry = {
  region: string;
  rating: number;
  type: PainType | null;
  loggedAt: string;
  localDate: string;
};

/**
 * The member's own pain entries in a local-date range for the Coach (#442):
 * nothing unless the pain log is on and its AI switch is on. Notes are never
 * read. Newest first, at most `limit`.
 */
export async function listAiPainEntries(
  db: Database,
  scope: PainScope,
  range: { from: string; to: string; limit: number },
): Promise<AiPainEntry[]> {
  const rows = await db
    .select({
      region: painEntry.region,
      rating: painEntry.rating,
      type: painEntry.type,
      loggedAt: painEntry.loggedAt,
      localDate: painEntry.localDate,
    })
    .from(painEntry)
    .innerJoin(painPreference, eq(painPreference.userId, painEntry.userId))
    .where(
      and(
        own(scope),
        eq(painPreference.enabled, true),
        eq(painPreference.aiVisible, true),
        between(painEntry.localDate, range.from, range.to),
      ),
    )
    .orderBy(desc(painEntry.loggedAt), desc(painEntry.id))
    .limit(range.limit);
  return rows.map((row) => ({
    region: row.region,
    rating: row.rating,
    type: (row.type as PainType | null) ?? null,
    loggedAt: row.loggedAt.toISOString(),
    localDate: row.localDate,
  }));
}
