import { createHash } from "node:crypto";

import { writeAuditLog } from "@openvalens/audit-security";
import type { Database } from "@openvalens/db";
import { aiAppEntry, aiAppGrant, aiAppWrite } from "@openvalens/db/schema/ai-apps";
import { createStructuredLogger, type StructuredLogger } from "@openvalens/observability";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

import type { McpConfig } from "./config";
import { ToolInputError } from "./format";
import type { AiAppGrantPrincipal } from "./grants";

/**
 * AI app writes (Issue #439, M2a, extended in M2b): the foundation every write
 * tool runs on.
 *
 * - **Idempotency.** Every write call carries a `mutationId`. Its receipt
 *   (`ai_app_write`, keyed by grant and mutation id) follows the plain-water
 *   receipts (#83): under one advisory lock, a retry with the same id and the
 *   same request replays the saved outcome, the same id with another request
 *   is refused. Each entry also gets a key that is the same on every retry
 *   (grant, mutation id, position), and the domain write path takes it as its
 *   own client mutation id or dedupe hash, so even a retry after a crash
 *   half-way through never writes an entry twice.
 * - **Source and ownership.** Every entry is recorded in `ai_app_entry` with
 *   the grant that wrote it, as soon as its domain write returns. That is the
 *   "via <app>" tag (the grant's label is the app's name), the list an app may
 *   delete from (only its own grant's entries, never the member's or another
 *   app's), and what "Delete everything this app wrote" removes. Revoking a
 *   grant keeps them.
 * - **Limits.** At most `entriesPerCall` entries per call and `entriesPerDay`
 *   added per grant in any 24 hours (env). A started call counts against the
 *   day even if it fails.
 * - **Never device data.** The domain writers write the member's own manual
 *   entries only. They never merge into or overwrite a device reading; an
 *   entry near one is flagged `possibleDuplicate` and device data wins in the
 *   daily totals.
 *
 * Domain writes go through {@link McpWriteTargets}, injected by the server:
 * the same write paths the app's own quick log uses. This package never
 * touches a domain table itself. Usage records (`ai_app_call`) still never hold
 * arguments or results; receipts hold a fingerprint and entry ids only.
 */

export type AiWriteScope = { organizationId: string; userId: string };

/** Who wrote an entry: the grant, and the app's name as the member sees it. */
export type AiWriteSource = { grantId: string; label: string };

export type AiWriteTargetTable =
  | "metric_sample"
  | "plain_water_entry"
  | "supplement_intake"
  // M2b
  | "workout"
  | "health_event"
  | "custom_tracker_entry"
  | "pain_entry";

/** The domain rows one entry made. */
export type AiWrittenEntry = {
  kind: string;
  targetTable: AiWriteTargetTable;
  /** Integer-keyed rows (metric samples, water, intakes, workouts, sleep nights). */
  targetIds: number[];
  /** UUID-keyed rows (custom tracker entries, pain entries). */
  targetUuids?: string[];
  /**
   * Device data of the same kind overlaps (a reading within ten minutes, a
   * device night, a tracker entry imported from a phone platform); both are
   * kept and the device data counts.
   */
  possibleDuplicate: boolean;
};

/** The domain rows of one recorded entry, as `remove` gets them. */
export type AiWrittenTarget = {
  kind: string;
  targetTable: AiWriteTargetTable;
  targetIds: readonly number[];
  targetUuids: readonly string[];
};

/** What a domain writer gets for one entry. */
export type AiWriteEntryContext = {
  scope: AiWriteScope;
  source: AiWriteSource;
  timeZone: string;
  now: Date;
  /**
   * Stable key of this one entry (grant, mutation id, position), the same on
   * every retry: the domain path uses it as its client mutation id or dedupe
   * hash so a retried entry is never written twice.
   */
  entryKey: string;
  correlationId?: string;
};

export type AiWriteBatchContext = {
  scope: AiWriteScope;
  timeZone: string;
  now: Date;
};

/**
 * One domain's writer. `prepare` checks every entry of a call before anything
 * is written (range, unit, the member's own supplement, logging switched on)
 * and throws a {@link ToolInputError} naming the first bad entry; `write`
 * saves one prepared entry.
 */
export type AiDomainWriter<Input> = {
  prepare: (context: AiWriteBatchContext, entries: readonly Input[]) => Promise<unknown[]>;
  write: (context: AiWriteEntryContext, prepared: unknown) => Promise<AiWrittenEntry>;
};

export type WaterEntryInput = { at: string; amount: number; unit: "ml" | "l" | "fl_oz" };

export const BODY_ENTRY_KINDS = [
  "weight",
  "body_fat",
  "muscle_mass",
  "bone_mass",
  "body_water",
] as const;
export type BodyEntryKind = (typeof BODY_ENTRY_KINDS)[number];
export type BodyEntryInput = {
  at: string;
  kind: BodyEntryKind;
  value: number;
  /** `kg` or `lb` for the masses; `%` for body fat and body water. */
  unit?: "kg" | "lb" | "%";
};

export const VITAL_ENTRY_KINDS = [
  "blood_pressure",
  "heart_rate",
  "resting_heart_rate",
  "oxygen_saturation",
  "respiratory_rate",
] as const;
export type VitalEntryKind = (typeof VITAL_ENTRY_KINDS)[number];
export type VitalEntryInput = {
  at: string;
  kind: VitalEntryKind;
  value?: number;
  systolic?: number;
  diastolic?: number;
  pulse?: number;
};

export type SupplementEntryInput = { at: string; supplement: string; dose?: string };

// ─── M2b ──────────────────────────────────────────────────────

/** The app's workout types (`@openvalens/plans` `WORKOUT_TYPES`). */
export const WORKOUT_ENTRY_TYPES = [
  "weights",
  "running",
  "cycling",
  "swimming",
  "tennis",
  "other",
] as const;
/** Talk-test intensity (#99). */
export const WORKOUT_ENTRY_INTENSITIES = ["light", "moderate", "vigorous"] as const;

export type WorkoutSetEntryInput = {
  reps: number;
  weight?: number;
  /** Unit of `weight`, default kg. */
  unit?: "kg" | "lb";
  rpe?: number;
};
export type WorkoutExerciseEntryInput = {
  /** A catalog id from `exercises.search`. Missing means not in the catalog: refused (M2c). */
  exerciseId?: number;
  /** Only to name an exercise that is not in the catalog, which is refused for now. */
  name?: string;
  sets?: WorkoutSetEntryInput[];
};
export type WorkoutEntryInput = {
  /** The session's day in the member's time zone (YYYY-MM-DD). */
  date: string;
  type: (typeof WORKOUT_ENTRY_TYPES)[number];
  durationMinutes?: number;
  intensity?: (typeof WORKOUT_ENTRY_INTENSITIES)[number];
  /** Session effort, CR-10 (0-10). */
  effort?: number;
  notes?: string;
  exercises?: WorkoutExerciseEntryInput[];
};

export type SleepEntryInput = { startAt: string; endAt: string; quality?: number };

export type TrackerEntryInput = {
  at: string;
  trackerId: string;
  /** number: the value; scale: 1-5; yes_no: true or false; duration: minutes. */
  value: number | boolean;
  note?: string;
};

export type PainEntryInput = {
  at: string;
  region: string;
  rating: number;
  type?: string;
  note?: string;
};

/** The domain write paths, injected by the server (the app's own quick-log paths). */
export type McpWriteTargets = {
  water: AiDomainWriter<WaterEntryInput>;
  body: AiDomainWriter<BodyEntryInput>;
  vitals: AiDomainWriter<VitalEntryInput>;
  supplements: AiDomainWriter<SupplementEntryInput>;
  workouts: AiDomainWriter<WorkoutEntryInput>;
  sleep: AiDomainWriter<SleepEntryInput>;
  trackers: AiDomainWriter<TrackerEntryInput>;
  pain: AiDomainWriter<PainEntryInput>;
  /**
   * Deletes the domain rows of one entry an AI app wrote. `gone` when they
   * were already deleted (by the member, or an earlier retry).
   */
  remove: (
    context: {
      scope: AiWriteScope;
      entryKey: string;
      correlationId?: string;
      source: AiWriteSource;
    },
    entry: AiWrittenTarget,
  ) => Promise<"deleted" | "gone">;
};

export type AiWriteDomain =
  | "water"
  | "body"
  | "vitals"
  | "supplements"
  | "workouts"
  | "sleep"
  | "trackers"
  | "pain";

/** The entry kinds each write domain (and so each write scope) covers. */
export const WRITE_DOMAIN_KINDS: Record<AiWriteDomain, readonly string[]> = {
  water: ["water"],
  body: BODY_ENTRY_KINDS,
  vitals: VITAL_ENTRY_KINDS,
  supplements: ["supplement_intake"],
  workouts: ["workout"],
  sleep: ["sleep_session"],
  trackers: ["tracker_entry"],
  pain: ["pain_entry"],
};

/** Too many entries for one grant today. */
export class AiWriteLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "AiWriteLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type AiLogResult = {
  replayed: boolean;
  /** "via <app>": how the app's entries are labelled in OpenValens. */
  source: string;
  entries: Array<{ index: number; entryId: string; kind: string; possibleDuplicate: boolean }>;
};

export type AiDeleteResult = {
  replayed: boolean;
  entries: Array<{ entryId: string; status: "deleted" | "not_found" }>;
};

export type AiAppWritesOptions = {
  db: Database;
  targets: McpWriteTargets;
  limits: McpConfig["writeLimits"];
  now?: () => Date;
  logger?: StructuredLogger;
};

const DAY_MS = 86_400_000;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Stable JSON: object keys sorted, so the same request always has one fingerprint. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function writeFingerprint(tool: string, request: unknown): string {
  return sha256(`${tool}\n${canonical(request)}`);
}

/** The stable key of one entry of one call: hashed, so it holds no ids in clear. */
export function entryKeyOf(grantId: string, mutationId: string, index: number): string {
  return sha256(`ai-app-entry:${grantId}:${mutationId}:${index}`);
}

/** "via Claude". */
export function sourceLabel(label: string): string {
  return `via ${label}`;
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createAiAppWrites(options: AiAppWritesOptions) {
  const { db, targets, limits } = options;
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? createStructuredLogger({ level: "info" });

  async function lockGrant(tx: Tx, grantId: string) {
    // Serializes one grant's receipts and daily count. The key is a grant id
    // from the database, never caller input.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`ai-app-write:${grantId}`}, 439))`,
    );
  }

  /**
   * Starts (or resumes, or replays) one write call. Returns the receipt id
   * and, for a finished call, its saved outcome.
   */
  async function begin(input: {
    principal: AiAppGrantPrincipal;
    tool: string;
    mutationId: string;
    fingerprint: string;
    entryCount: number;
  }): Promise<{ writeId: string; outcome: unknown | null }> {
    const at = now();
    return db.transaction(async (tx) => {
      await lockGrant(tx, input.principal.grantId);
      const [existing] = await tx
        .select()
        .from(aiAppWrite)
        .where(
          and(
            eq(aiAppWrite.grantId, input.principal.grantId),
            eq(aiAppWrite.mutationId, input.mutationId),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.tool !== input.tool || existing.fingerprint !== input.fingerprint) {
          throw new ToolInputError(
            "This mutationId was already used for a different request. Use a new mutationId for a new write.",
          );
        }
        return {
          writeId: existing.id,
          outcome: existing.status === "done" ? existing.outcome : null,
        };
      }
      if (input.entryCount > 0) {
        const since = new Date(at.getTime() - DAY_MS);
        const [used] = await tx
          .select({
            total: sql<number>`coalesce(sum(${aiAppWrite.entryCount}), 0)::int`,
            oldest: sql<Date | null>`min(${aiAppWrite.createdAt})`,
          })
          .from(aiAppWrite)
          .where(
            and(eq(aiAppWrite.grantId, input.principal.grantId), gt(aiAppWrite.createdAt, since)),
          );
        const total = Number(used?.total ?? 0);
        if (total + input.entryCount > limits.entriesPerDay) {
          const oldest = used?.oldest ? new Date(used.oldest) : at;
          const retryAfter = Math.max(
            60,
            Math.ceil((oldest.getTime() + DAY_MS - at.getTime()) / 1000),
          );
          throw new AiWriteLimitError(
            `This app can add at most ${limits.entriesPerDay} entries a day; ${Math.max(0, limits.entriesPerDay - total)} are left now. Larger imports go through the app's own import screens.`,
            retryAfter,
          );
        }
      }
      const [created] = await tx
        .insert(aiAppWrite)
        .values({
          grantId: input.principal.grantId,
          organizationId: input.principal.organizationId,
          userId: input.principal.userId,
          mutationId: input.mutationId,
          tool: input.tool,
          fingerprint: input.fingerprint,
          entryCount: input.entryCount,
          status: "pending",
          createdAt: at,
        })
        .returning({ id: aiAppWrite.id });
      if (!created) throw new Error("ai_app_write insert returned no row");
      return { writeId: created.id, outcome: null };
    });
  }

  /** A finished call's outcome, or `null`; refuses a reused id with another request. */
  async function savedOutcome(input: {
    principal: AiAppGrantPrincipal;
    tool: string;
    mutationId: string;
    fingerprint: string;
  }): Promise<unknown | null> {
    const [existing] = await db
      .select({
        tool: aiAppWrite.tool,
        fingerprint: aiAppWrite.fingerprint,
        status: aiAppWrite.status,
        outcome: aiAppWrite.outcome,
      })
      .from(aiAppWrite)
      .where(
        and(
          eq(aiAppWrite.grantId, input.principal.grantId),
          eq(aiAppWrite.mutationId, input.mutationId),
        ),
      )
      .limit(1);
    if (!existing) return null;
    if (existing.tool !== input.tool || existing.fingerprint !== input.fingerprint) {
      throw new ToolInputError(
        "This mutationId was already used for a different request. Use a new mutationId for a new write.",
      );
    }
    return existing.status === "done" ? existing.outcome : null;
  }

  async function complete(writeId: string, outcome: unknown): Promise<void> {
    await db
      .update(aiAppWrite)
      .set({ status: "done", outcome, completedAt: now() })
      .where(eq(aiAppWrite.id, writeId));
  }

  /** Records one written entry; on a resumed call returns the id it already has. */
  async function recordEntry(input: {
    principal: AiAppGrantPrincipal;
    writeId: string;
    index: number;
    written: AiWrittenEntry;
  }): Promise<string> {
    const [inserted] = await db
      .insert(aiAppEntry)
      .values({
        grantId: input.principal.grantId,
        organizationId: input.principal.organizationId,
        userId: input.principal.userId,
        writeId: input.writeId,
        itemIndex: input.index,
        kind: input.written.kind,
        targetTable: input.written.targetTable,
        targetIds: [...input.written.targetIds],
        targetUuids: [...(input.written.targetUuids ?? [])],
        possibleDuplicate: input.written.possibleDuplicate,
        createdAt: now(),
      })
      .onConflictDoNothing({ target: [aiAppEntry.writeId, aiAppEntry.itemIndex] })
      .returning({ id: aiAppEntry.id });
    if (inserted) return inserted.id;
    const [existing] = await db
      .select({ id: aiAppEntry.id })
      .from(aiAppEntry)
      .where(and(eq(aiAppEntry.writeId, input.writeId), eq(aiAppEntry.itemIndex, input.index)))
      .limit(1);
    if (!existing) throw new Error("ai_app_entry neither inserted nor found");
    return existing.id;
  }

  function writerOf(domain: AiWriteDomain): AiDomainWriter<unknown> {
    return targets[domain] as AiDomainWriter<unknown>;
  }

  function checkCallSize(count: number) {
    if (count < 1) throw new ToolInputError("Send at least one entry.");
    if (count > limits.entriesPerCall) {
      throw new ToolInputError(
        `Send at most ${limits.entriesPerCall} entries per call. Split larger batches into several calls, each with its own mutationId.`,
      );
    }
  }

  async function audit(
    principal: AiAppGrantPrincipal,
    eventType: "RECORD_CREATED" | "RECORD_DELETED",
    entry: {
      targetTable: string;
      targetIds: readonly number[];
      targetUuids?: readonly string[];
    },
    correlationId: string | undefined,
  ) {
    for (const id of [...entry.targetIds, ...(entry.targetUuids ?? [])]) {
      await writeAuditLog({
        db,
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        eventType,
        targetType: entry.targetTable,
        targetId: String(id),
        correlationId,
        metadata: {
          resource: "records",
          action: "write",
          via: "ai_app",
          grantId: principal.grantId,
        },
      });
    }
  }

  /**
   * Adds the entries of one `<domain>.log` call. All entries are checked
   * before the first is written. Replays a finished call with the same
   * mutation id; resumes an unfinished one without writing an entry twice.
   */
  async function log(input: {
    principal: AiAppGrantPrincipal;
    domain: AiWriteDomain;
    tool: string;
    mutationId: string;
    entries: readonly unknown[];
    timeZone: string;
    correlationId?: string;
  }): Promise<AiLogResult> {
    checkCallSize(input.entries.length);
    const writer = writerOf(input.domain);
    const at = now();
    const scope = {
      organizationId: input.principal.organizationId,
      userId: input.principal.userId,
    };
    const fingerprint = writeFingerprint(input.tool, input.entries);
    const receipt = {
      principal: input.principal,
      tool: input.tool,
      mutationId: input.mutationId,
      fingerprint,
    };
    // A finished call replays as it was, even if its checks would fail now.
    const finished = await savedOutcome(receipt);
    if (finished) return { ...(finished as AiLogResult), replayed: true };
    // Checked before the receipt is taken: a refused call uses no daily share.
    const prepared = await writer.prepare(
      { scope, timeZone: input.timeZone, now: at },
      input.entries,
    );
    const started = await begin({ ...receipt, entryCount: input.entries.length });
    if (started.outcome) return { ...(started.outcome as AiLogResult), replayed: true };
    const source = { grantId: input.principal.grantId, label: input.principal.label };
    const results: AiLogResult["entries"] = [];
    for (const [index, entry] of prepared.entries()) {
      const written = await writer.write(
        {
          scope,
          source,
          timeZone: input.timeZone,
          now: at,
          entryKey: entryKeyOf(input.principal.grantId, input.mutationId, index),
          correlationId: input.correlationId,
        },
        entry,
      );
      const entryId = await recordEntry({
        principal: input.principal,
        writeId: started.writeId,
        index,
        written,
      });
      await audit(input.principal, "RECORD_CREATED", written, input.correlationId);
      results.push({
        index,
        entryId,
        kind: written.kind,
        possibleDuplicate: written.possibleDuplicate,
      });
    }
    const outcome: AiLogResult = {
      replayed: false,
      source: sourceLabel(input.principal.label),
      entries: results,
    };
    await complete(started.writeId, outcome);
    logger.info("ai_apps.write.applied", {
      correlationId: input.correlationId,
      grantId: input.principal.grantId,
      tool: input.tool,
      entryCount: results.length,
    });
    return outcome;
  }

  /** Deletes the domain rows of owned entries and their ownership rows. */
  async function removeEntries(
    principal: Pick<AiAppGrantPrincipal, "grantId" | "organizationId" | "userId" | "label">,
    rows: Array<typeof aiAppEntry.$inferSelect>,
    correlationId: string | undefined,
  ): Promise<number> {
    let removed = 0;
    for (const row of rows) {
      const outcome = await targets.remove(
        {
          scope: { organizationId: row.organizationId, userId: row.userId },
          source: { grantId: row.grantId, label: principal.label },
          entryKey: sha256(`ai-app-delete:${row.id}`),
          correlationId,
        },
        {
          kind: row.kind,
          targetTable: row.targetTable as AiWriteTargetTable,
          targetIds: row.targetIds,
          targetUuids: row.targetUuids,
        },
      );
      if (outcome === "deleted") {
        removed += 1;
        await audit(
          principal as AiAppGrantPrincipal,
          "RECORD_DELETED",
          { targetTable: row.targetTable, targetIds: row.targetIds, targetUuids: row.targetUuids },
          correlationId,
        );
      }
      await db.delete(aiAppEntry).where(eq(aiAppEntry.id, row.id));
    }
    return removed;
  }

  /**
   * Deletes entries this grant wrote in this domain. Entry ids the grant did
   * not write (the member's own, another app's, or unknown) are answered
   * `not_found` and never touched.
   */
  async function remove(input: {
    principal: AiAppGrantPrincipal;
    domain: AiWriteDomain;
    tool: string;
    mutationId: string;
    entryIds: readonly string[];
    correlationId?: string;
  }): Promise<AiDeleteResult> {
    checkCallSize(input.entryIds.length);
    const entryIds = [...new Set(input.entryIds)];
    const started = await begin({
      principal: input.principal,
      tool: input.tool,
      mutationId: input.mutationId,
      fingerprint: writeFingerprint(input.tool, entryIds),
      entryCount: 0,
    });
    if (started.outcome) return { ...(started.outcome as AiDeleteResult), replayed: true };
    const owned = await db
      .select()
      .from(aiAppEntry)
      .where(
        and(
          eq(aiAppEntry.grantId, input.principal.grantId),
          eq(aiAppEntry.organizationId, input.principal.organizationId),
          eq(aiAppEntry.userId, input.principal.userId),
          inArray(aiAppEntry.id, entryIds),
          inArray(aiAppEntry.kind, [...WRITE_DOMAIN_KINDS[input.domain]]),
        ),
      );
    await removeEntries(input.principal, owned, input.correlationId);
    const ownedIds = new Set(owned.map((row) => row.id));
    const outcome: AiDeleteResult = {
      replayed: false,
      entries: entryIds.map((entryId) => ({
        entryId,
        status: ownedIds.has(entryId) ? "deleted" : "not_found",
      })),
    };
    await complete(started.writeId, outcome);
    return outcome;
  }

  /**
   * "Delete everything this app wrote": every entry one of the member's grants
   * wrote in this workspace, revoked or not. Returns how many entries were
   * deleted; `null` when the grant is not the member's.
   */
  async function deleteEverythingWritten(input: {
    userId: string;
    organizationId: string;
    grantId: string;
    correlationId?: string;
  }): Promise<{ deleted: number } | null> {
    const [grant] = await db
      .select({ id: aiAppGrant.id, label: aiAppGrant.label })
      .from(aiAppGrant)
      .where(
        and(
          eq(aiAppGrant.id, input.grantId),
          eq(aiAppGrant.userId, input.userId),
          eq(aiAppGrant.organizationId, input.organizationId),
        ),
      )
      .limit(1);
    if (!grant) return null;
    const principal = {
      grantId: grant.id,
      organizationId: input.organizationId,
      userId: input.userId,
      label: grant.label,
    };
    let entries = 0;
    let deleted = 0;
    for (;;) {
      const rows = await db
        .select()
        .from(aiAppEntry)
        .where(
          and(
            eq(aiAppEntry.grantId, grant.id),
            eq(aiAppEntry.organizationId, input.organizationId),
            eq(aiAppEntry.userId, input.userId),
          ),
        )
        .orderBy(asc(aiAppEntry.createdAt), asc(aiAppEntry.id))
        .limit(200);
      if (rows.length === 0) break;
      entries += rows.length;
      deleted += await removeEntries(principal, rows, input.correlationId);
    }
    await writeAuditLog({
      db,
      organizationId: input.organizationId,
      actorUserId: input.userId,
      eventType: "AI_APP_WRITES_DELETED",
      targetType: "ai_app_grant",
      targetId: grant.id,
      correlationId: input.correlationId,
      metadata: { entryCount: entries, deletedCount: deleted },
    });
    logger.info("ai_apps.writes.deleted", {
      correlationId: input.correlationId,
      organizationId: input.organizationId,
      grantId: grant.id,
      entryCount: entries,
    });
    return { deleted: entries };
  }

  /** How many entries each of the member's grants in this workspace has written and kept. */
  async function entryCounts(input: {
    userId: string;
    organizationId: string;
  }): Promise<Map<string, number>> {
    const rows = await db
      .select({ grantId: aiAppEntry.grantId, count: sql<number>`count(*)::int` })
      .from(aiAppEntry)
      .where(
        and(
          eq(aiAppEntry.userId, input.userId),
          eq(aiAppEntry.organizationId, input.organizationId),
        ),
      )
      .groupBy(aiAppEntry.grantId);
    return new Map(rows.map((row) => [row.grantId, Number(row.count)]));
  }

  return Object.freeze({ log, remove, deleteEverythingWritten, entryCounts, limits });
}

export type AiAppWrites = ReturnType<typeof createAiAppWrites>;
