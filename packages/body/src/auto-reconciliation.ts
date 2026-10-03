import type { Database } from "@openvalens/db";
import { dailyWeight, dailyWeightOverride, weightEvent } from "@openvalens/db/schema/body";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { resolveCanonicalWeight, type CanonicalWeightAutoEvent } from "./canonical-weight";

/**
 * Auto-source reconciliation (Issue #21, second half).
 *
 * Mirrors `anchovy/apps/web/src/lib/integrations/health-connect/ingest.ts`
 * `ingestAutoWeightEventForDay`: insert the raw `weight_event` row, then if no
 * active numeric `daily_weight_override` exists, recompute the day's canonical
 * row via {@link resolveCanonicalWeight} and upsert `daily_weight` with
 * `source = 'auto'` and `resolvedFromEventId` pointing at the winning event.
 *
 * No PHI is logged; org/user are taken exclusively from the caller's authz
 * context (the procedure wrapper enforces this).
 */
export type IngestAutoWeightEventInput = {
  organizationId: string;
  userId: string;
  date: string;
  measuredAt: string;
  weightKg: number;
  sourceDetail: string;
  metadataJson: Record<string, unknown>;
};

export type AutoWeightEventInsertInput = {
  organizationId: string;
  userId: string;
  source: "auto";
  date: string;
  measuredAt: string;
  weightKg: number;
  sourceDetail: string;
  metadataJson: Record<string, unknown>;
};

export type AutoWeightEventDependencies = {
  /** Insert a raw `weight_event` row and return its generated id. */
  insertAutoWeightEvent: (input: AutoWeightEventInsertInput) => Promise<{ id: number }>;
  /**
   * Returns the active numeric override for the (org, user, date) triple, or
   * `null` when none is active. An active override suppresses reconciliation.
   */
  getActiveOverride: (input: {
    organizationId: string;
    userId: string;
    date: string;
  }) => Promise<{ id: number } | null>;
  /** Same-day auto events ordered for canonical resolution. */
  listAutoWeightEvents: (input: {
    organizationId: string;
    userId: string;
    date: string;
  }) => Promise<Array<{ id: number; measuredAt: string; weightKg: number }>>;
  /** Remove the derived `source = 'auto'` row when no active auto event remains. */
  deleteAutoDailyWeight: (input: {
    organizationId: string;
    userId: string;
    date: string;
  }) => Promise<void>;
  /** Upsert the materialized `daily_weight` row with the winning auto event. */
  upsertAutoDailyWeight: (input: {
    organizationId: string;
    userId: string;
    date: string;
    weightKg: number;
    resolvedFromEventId: number;
  }) => Promise<void>;
};

export type IngestAutoWeightEventResult = {
  eventId: number;
  /** True when the canonical `daily_weight` row was (re)computed for this call. */
  reconciled: boolean;
};

export async function ingestAutoWeightEvent(
  input: IngestAutoWeightEventInput,
  dependencies: AutoWeightEventDependencies,
): Promise<IngestAutoWeightEventResult> {
  const { id: eventId } = await dependencies.insertAutoWeightEvent({
    organizationId: input.organizationId,
    userId: input.userId,
    source: "auto",
    date: input.date,
    measuredAt: input.measuredAt,
    weightKg: input.weightKg,
    sourceDetail: input.sourceDetail,
    metadataJson: input.metadataJson,
  });

  const { reconciled } = await reconcileAutoDailyWeight(input, dependencies);
  return { eventId, reconciled };
}

/**
 * Recompute one day's canonical `daily_weight` from its active auto events,
 * unless an active override owns the day. With `removeWhenEmpty` (the
 * supersession path), a day whose auto events were all superseded loses its
 * derived auto row; the events themselves stay.
 */
export async function reconcileAutoDailyWeight(
  input: { organizationId: string; userId: string; date: string; removeWhenEmpty?: boolean },
  dependencies: Pick<
    AutoWeightEventDependencies,
    "getActiveOverride" | "listAutoWeightEvents" | "upsertAutoDailyWeight" | "deleteAutoDailyWeight"
  >,
): Promise<{ reconciled: boolean }> {
  const day = { organizationId: input.organizationId, userId: input.userId, date: input.date };
  if (await dependencies.getActiveOverride(day)) return { reconciled: false };

  const autoEvents = await dependencies.listAutoWeightEvents(day);
  if (autoEvents.length === 0) {
    if (input.removeWhenEmpty) await dependencies.deleteAutoDailyWeight(day);
    return { reconciled: false };
  }
  const resolution = resolveCanonicalWeight({
    autoEvents: autoEvents as ReadonlyArray<CanonicalWeightAutoEvent>,
    override: null,
  });
  if (!resolution || resolution.source !== "auto" || resolution.resolvedFromEventId === null)
    return { reconciled: false };

  await dependencies.upsertAutoDailyWeight({
    ...day,
    weightKg: resolution.weightKg,
    resolvedFromEventId: resolution.resolvedFromEventId,
  });
  return { reconciled: true };
}

/**
 * Concrete service factory backed by Drizzle. The procedure wrapper supplies
 * `db` so each request runs against the caller's transaction pool.
 */
/** A database handle or a transaction. */
type DbLike = Pick<Database, "select" | "insert" | "update" | "delete">;

export function createAutoReconciliationService(db: DbLike) {
  const dependencies: AutoWeightEventDependencies = {
    async insertAutoWeightEvent(autoInput) {
      const [row] = await db
        .insert(weightEvent)
        .values({
          organizationId: autoInput.organizationId,
          userId: autoInput.userId,
          source: "auto",
          date: autoInput.date,
          measuredAt: autoInput.measuredAt,
          weightKg: autoInput.weightKg,
          confidence: null,
          // `sourceDetail` is folded into the metadata envelope; the
          // `weight_event` table has no dedicated column.
          metadataJson: {
            sourceDetail: autoInput.sourceDetail,
            ...autoInput.metadataJson,
          },
        })
        .returning({ id: weightEvent.id });
      if (!row) throw new Error("Auto weight event insert did not return a row");
      return { id: row.id };
    },

    async getActiveOverride(query) {
      const rows = await db
        .select({ id: dailyWeightOverride.id })
        .from(dailyWeightOverride)
        .where(
          and(
            eq(dailyWeightOverride.organizationId, query.organizationId),
            eq(dailyWeightOverride.userId, query.userId),
            eq(dailyWeightOverride.date, query.date),
            isNull(dailyWeightOverride.revokedAt),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async listAutoWeightEvents(query) {
      return db
        .select({
          id: weightEvent.id,
          measuredAt: weightEvent.measuredAt,
          weightKg: weightEvent.weightKg,
        })
        .from(weightEvent)
        .where(
          and(
            eq(weightEvent.organizationId, query.organizationId),
            eq(weightEvent.userId, query.userId),
            eq(weightEvent.source, "auto"),
            eq(weightEvent.date, query.date),
            isNull(weightEvent.supersededAt),
          ),
        )
        .orderBy(desc(weightEvent.measuredAt), desc(weightEvent.id));
    },

    async upsertAutoDailyWeight(upsert) {
      await db
        .insert(dailyWeight)
        .values({
          organizationId: upsert.organizationId,
          userId: upsert.userId,
          date: upsert.date,
          weightKg: upsert.weightKg,
          source: "auto",
          resolvedFromEventId: upsert.resolvedFromEventId,
        })
        .onConflictDoUpdate({
          target: [dailyWeight.organizationId, dailyWeight.userId, dailyWeight.date],
          set: {
            weightKg: upsert.weightKg,
            source: "auto",
            resolvedFromEventId: upsert.resolvedFromEventId,
            updatedAt: new Date().toISOString(),
          },
        });
    },

    async deleteAutoDailyWeight(day) {
      await db
        .delete(dailyWeight)
        .where(
          and(
            eq(dailyWeight.organizationId, day.organizationId),
            eq(dailyWeight.userId, day.userId),
            eq(dailyWeight.date, day.date),
            eq(dailyWeight.source, "auto"),
          ),
        );
    },
  };

  return {
    async ingestAutoWeightEvent(
      input: IngestAutoWeightEventInput,
    ): Promise<IngestAutoWeightEventResult> {
      return ingestAutoWeightEvent(input, dependencies);
    },

    reconcileDay(day: { organizationId: string; userId: string; date: string }) {
      return reconcileAutoDailyWeight(day, dependencies);
    },

    /**
     * Supersede the auto weight events derived from the given canonical
     * `metric_sample` rows (mobile deletions and edits, #44), then recompute
     * each affected day.
     */
    async supersedeForMetricSamples(input: {
      organizationId: string;
      metricSampleIds: number[];
      supersededAt: Date;
    }): Promise<number> {
      if (input.metricSampleIds.length === 0) return 0;
      const affected = await db
        .update(weightEvent)
        .set({ supersededAt: input.supersededAt.toISOString() })
        .where(
          and(
            eq(weightEvent.organizationId, input.organizationId),
            eq(weightEvent.source, "auto"),
            isNull(weightEvent.supersededAt),
            inArray(
              sql`(${weightEvent.metadataJson}->>'metricSampleId')::int`,
              input.metricSampleIds,
            ),
          ),
        )
        .returning({ userId: weightEvent.userId, date: weightEvent.date });
      const days = new Map(affected.map((row) => [`${row.userId}|${row.date}`, row]));
      for (const row of days.values())
        await reconcileAutoDailyWeight(
          {
            organizationId: input.organizationId,
            userId: row.userId,
            date: row.date,
            removeWhenEmpty: true,
          },
          dependencies,
        );
      return affected.length;
    },

    /**
     * Org-scoped `weight_event` history, ordered newest-first. Used by
     * `body.listWeightHistory` to surface ingested samples.
     */
    async listWeightHistory(organizationId: string, limit: number) {
      return db
        .select()
        .from(weightEvent)
        .where(eq(weightEvent.organizationId, organizationId))
        .orderBy(desc(weightEvent.measuredAt), desc(weightEvent.id))
        .limit(limit);
    },
  };
}
