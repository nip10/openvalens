import type { Database } from "@openvalens/db";
import { cycleImport, cyclePeriod, cyclePreference } from "@openvalens/db/schema/cycle";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { CYCLE_COPY, estimateCycles, isCalendarDate, type CycleEstimates } from "./cycle-estimates";

/**
 * Optional cycle logging (Issue #91): consent, manual periods, reversible
 * imports and "turn off and erase". Every call is scoped to the member; a
 * member who has not opted in sees nothing and can write nothing. Nothing
 * here logs, and nothing reads or writes nutrition targets.
 */

export const CYCLE_FLOWS = ["spotting", "light", "medium", "heavy"] as const;
export const CYCLE_IMPORT_SOURCES = ["health_connect", "healthkit"] as const;
/** Technical bounds, not clinical ranges. */
const MAX_PERIOD_DAYS = 20;
const MAX_IMPORT_PERIODS = 500;

const calendarDate = z.string().refine(isCalendarDate, { message: "Use a YYYY-MM-DD date." });
const periodShape = z.strictObject({
  startDate: calendarDate,
  endDate: calendarDate.nullable().optional(),
  flow: z.enum(CYCLE_FLOWS).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});
function boundedPeriod<T extends { startDate: string; endDate?: string | null }>(value: T) {
  if (!value.endDate) return true;
  const days = (Date.parse(value.endDate) - Date.parse(value.startDate)) / 86_400_000;
  return days >= 0 && days < MAX_PERIOD_DAYS;
}
const periodRule = {
  message: `The end date must be on or after the start date, within ${MAX_PERIOD_DAYS} days.`,
  path: ["endDate"],
};

export const cyclePeriodInput = periodShape.refine(boundedPeriod, periodRule);
export const cyclePeriodUpdateInput = z.strictObject({ id: z.uuid(), period: cyclePeriodInput });
export const cyclePeriodIdInput = z.strictObject({ id: z.uuid() });
export const cycleEnableInput = z.strictObject({
  /** The member read and accepted the separate cycle consent. */
  consent: z.literal(true),
  consentVersion: z.literal(CYCLE_COPY.consentVersion),
});
export const cycleSettingsInput = z.strictObject({ noNaturalCycle: z.boolean() });
export const cycleEraseInput = z.strictObject({ confirm: z.literal(true) });
export const cycleImportInput = z.strictObject({
  source: z.enum(CYCLE_IMPORT_SOURCES),
  periods: z
    .array(
      z
        .strictObject({
          sourceRecordId: z.string().min(1).max(200),
          startDate: calendarDate,
          endDate: calendarDate.nullable().optional(),
          flow: z.enum(CYCLE_FLOWS).nullable().optional(),
        })
        .refine(boundedPeriod, periodRule),
    )
    .min(1)
    .max(MAX_IMPORT_PERIODS),
});
export const cycleImportIdInput = z.strictObject({ importId: z.uuid() });
export const cycleEstimatesInput = z.strictObject({ today: calendarDate });

export type CycleSettings = {
  enabled: boolean;
  noNaturalCycle: boolean;
  consentVersion: string | null;
};
export type CyclePeriodRecord = {
  id: string;
  startDate: string;
  endDate: string | null;
  flow: (typeof CYCLE_FLOWS)[number] | null;
  notes: string | null;
  source: "manual" | (typeof CYCLE_IMPORT_SOURCES)[number];
  importId: string | null;
};
export type CycleImportRecord = {
  id: string;
  source: (typeof CYCLE_IMPORT_SOURCES)[number];
  periodCount: number;
  importedAt: string;
};

type Scope = { organizationId: string; userId: string };

function project(row: typeof cyclePeriod.$inferSelect): CyclePeriodRecord {
  return {
    id: row.id,
    startDate: row.startDate,
    endDate: row.endDate,
    flow: row.flow as CyclePeriodRecord["flow"],
    notes: row.notes,
    source: row.source as CyclePeriodRecord["source"],
    importId: row.importId,
  };
}

const OFF: CycleSettings = Object.freeze({
  enabled: false,
  noNaturalCycle: false,
  consentVersion: null,
});

export function createCycleService(input: { db: Database; now?: () => Date }) {
  const { db } = input;
  const now = input.now ?? (() => new Date());
  const mine = (scope: Scope) =>
    and(eq(cyclePeriod.organizationId, scope.organizationId), eq(cyclePeriod.userId, scope.userId));

  async function settings(userId: string): Promise<CycleSettings> {
    const [row] = await db.select().from(cyclePreference).where(eq(cyclePreference.userId, userId));
    if (!row?.enabled) return { ...OFF };
    return {
      enabled: true,
      noNaturalCycle: row.noNaturalCycle,
      consentVersion: row.consentVersion,
    };
  }
  const enabled = async (userId: string) => (await settings(userId)).enabled;

  return Object.freeze({
    settings,

    async enable(userId: string, consentVersion: string): Promise<CycleSettings> {
      await db
        .insert(cyclePreference)
        .values({ userId, enabled: true, consentVersion, consentedAt: now(), updatedAt: now() })
        .onConflictDoUpdate({
          target: cyclePreference.userId,
          set: { enabled: true, consentVersion, consentedAt: now(), updatedAt: now() },
        });
      return settings(userId);
    },

    async updateSettings(userId: string, noNaturalCycle: boolean): Promise<CycleSettings | null> {
      const rows = await db
        .update(cyclePreference)
        .set({ noNaturalCycle, updatedAt: now() })
        .where(and(eq(cyclePreference.userId, userId), eq(cyclePreference.enabled, true)))
        .returning({ userId: cyclePreference.userId });
      return rows.length ? settings(userId) : null;
    },

    /**
     * Turns cycle logging off and erases every cycle row the member has, in
     * every workspace, in one transaction. The consent is withdrawn too.
     */
    async turnOffAndErase(userId: string): Promise<{ periods: number; imports: number }> {
      return db.transaction(async (tx) => {
        const periods = await tx
          .delete(cyclePeriod)
          .where(eq(cyclePeriod.userId, userId))
          .returning({ id: cyclePeriod.id });
        const imports = await tx
          .delete(cycleImport)
          .where(eq(cycleImport.userId, userId))
          .returning({ id: cycleImport.id });
        await tx.delete(cyclePreference).where(eq(cyclePreference.userId, userId));
        return { periods: periods.length, imports: imports.length };
      });
    },

    async list(scope: Scope): Promise<CyclePeriodRecord[]> {
      if (!(await enabled(scope.userId))) return [];
      const rows = await db
        .select()
        .from(cyclePeriod)
        .where(mine(scope))
        .orderBy(desc(cyclePeriod.startDate), desc(cyclePeriod.createdAt))
        .limit(1000);
      return rows.map(project);
    },

    async create(
      scope: Scope,
      period: z.infer<typeof cyclePeriodInput>,
    ): Promise<CyclePeriodRecord | null> {
      if (!(await enabled(scope.userId))) return null;
      const [row] = await db
        .insert(cyclePeriod)
        .values({
          ...scope,
          startDate: period.startDate,
          endDate: period.endDate ?? null,
          flow: period.flow ?? null,
          notes: period.notes || null,
          source: "manual",
          createdAt: now(),
          updatedAt: now(),
        })
        .returning();
      return project(row!);
    },

    async update(
      scope: Scope,
      id: string,
      period: z.infer<typeof cyclePeriodInput>,
    ): Promise<CyclePeriodRecord | null> {
      if (!(await enabled(scope.userId))) return null;
      const [row] = await db
        .update(cyclePeriod)
        .set({
          startDate: period.startDate,
          endDate: period.endDate ?? null,
          flow: period.flow ?? null,
          notes: period.notes || null,
          updatedAt: now(),
        })
        .where(and(eq(cyclePeriod.id, id), mine(scope)))
        .returning();
      return row ? project(row) : null;
    },

    async remove(scope: Scope, id: string): Promise<boolean> {
      if (!(await enabled(scope.userId))) return false;
      const rows = await db
        .delete(cyclePeriod)
        .where(and(eq(cyclePeriod.id, id), mine(scope)))
        .returning({ id: cyclePeriod.id });
      return rows.length === 1;
    },

    /**
     * Imports platform periods as one undoable run. Records already imported
     * (same source and record id) are skipped, so re-running an import is
     * harmless. Returns null while cycle logging is off.
     */
    async importPeriods(
      scope: Scope,
      payload: z.infer<typeof cycleImportInput>,
    ): Promise<{ importId: string | null; imported: number; skipped: number } | null> {
      if (!(await enabled(scope.userId))) return null;
      return db.transaction(async (tx) => {
        const ids = payload.periods.map((period) => period.sourceRecordId);
        const existing = await tx
          .select({ sourceRecordId: cyclePeriod.sourceRecordId })
          .from(cyclePeriod)
          .where(
            and(
              mine(scope),
              eq(cyclePeriod.source, payload.source),
              inArray(cyclePeriod.sourceRecordId, ids),
            ),
          );
        const known = new Set(existing.map((row) => row.sourceRecordId));
        const fresh = [
          ...new Map(
            payload.periods
              .filter((period) => !known.has(period.sourceRecordId))
              .map((period) => [period.sourceRecordId, period]),
          ).values(),
        ];
        if (!fresh.length) return { importId: null, imported: 0, skipped: payload.periods.length };
        const [run] = await tx
          .insert(cycleImport)
          .values({
            ...scope,
            source: payload.source,
            periodCount: fresh.length,
            importedAt: now(),
          })
          .returning({ id: cycleImport.id });
        await tx.insert(cyclePeriod).values(
          fresh.map((period) => ({
            ...scope,
            startDate: period.startDate,
            endDate: period.endDate ?? null,
            flow: period.flow ?? null,
            source: payload.source,
            sourceRecordId: period.sourceRecordId,
            importId: run!.id,
            createdAt: now(),
            updatedAt: now(),
          })),
        );
        return {
          importId: run!.id,
          imported: fresh.length,
          skipped: payload.periods.length - fresh.length,
        };
      });
    },

    async imports(scope: Scope): Promise<CycleImportRecord[]> {
      if (!(await enabled(scope.userId))) return [];
      const rows = await db
        .select()
        .from(cycleImport)
        .where(
          and(
            eq(cycleImport.organizationId, scope.organizationId),
            eq(cycleImport.userId, scope.userId),
          ),
        )
        .orderBy(desc(cycleImport.importedAt))
        .limit(100);
      return rows.map((row) => ({
        id: row.id,
        source: row.source as CycleImportRecord["source"],
        periodCount: row.periodCount,
        importedAt: row.importedAt.toISOString(),
      }));
    },

    /** Removes one import run and every period it added; manual rows are untouched. */
    async undoImport(scope: Scope, importId: string): Promise<number | null> {
      if (!(await enabled(scope.userId))) return null;
      return db.transaction(async (tx) => {
        const removed = await tx
          .delete(cyclePeriod)
          .where(and(mine(scope), eq(cyclePeriod.importId, importId)))
          .returning({ id: cyclePeriod.id });
        const runs = await tx
          .delete(cycleImport)
          .where(
            and(
              eq(cycleImport.id, importId),
              eq(cycleImport.organizationId, scope.organizationId),
              eq(cycleImport.userId, scope.userId),
            ),
          )
          .returning({ id: cycleImport.id });
        return runs.length ? removed.length : null;
      });
    },

    async estimates(scope: Scope, today: string): Promise<CycleEstimates | null> {
      const current = await settings(scope.userId);
      if (!current.enabled) return null;
      const rows = await db
        .select({ startDate: cyclePeriod.startDate, endDate: cyclePeriod.endDate })
        .from(cyclePeriod)
        .where(mine(scope))
        .orderBy(asc(cyclePeriod.startDate));
      return estimateCycles({ periods: rows, today, noNaturalCycle: current.noNaturalCycle });
    },
  });
}

export type CycleService = ReturnType<typeof createCycleService>;
