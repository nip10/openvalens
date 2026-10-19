import { createHash } from "node:crypto";

import type { Database } from "@openvalens/db";
import {
  plainWaterEntry,
  plainWaterMutation,
  plainWaterPreference,
} from "@openvalens/db/schema/nutrition";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";

import { NutritionError } from "./errors";
import { isLocalDate, isValidTimeZone } from "./local-day";
import type { NutritionScope } from "./repository";

export type WaterUnit = "ml" | "l" | "fl_oz";
export type WaterInput = {
  quantity: number;
  unit: WaterUnit;
  observedAt: Date;
  timeZone: string;
  clientMutationId: string;
};
export type WaterEntry = typeof plainWaterEntry.$inferSelect;
export type WaterMutationOutcome =
  | { outcome: "applied" | "replayed"; entry: WaterEntry }
  | { outcome: "conflict"; entry: WaterEntry };

const mlFactor: Record<WaterUnit, number> = { ml: 1, l: 1000, fl_oz: 29.5735295625 };
const MAX_QUANTITY_ML = 10_000_000; // technical storage limit, not a recommended amount
const canonicalFingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function assertMutationId(value: string) {
  if (typeof value !== "string" || value.length < 1 || value.length > 64)
    throw new NutritionError("INVALID_INPUT", "Client mutation id is invalid");
  return value;
}

function normalize(input: WaterInput) {
  if (
    !Object.hasOwn(mlFactor, input.unit) ||
    !Number.isFinite(input.quantity) ||
    input.quantity <= 0 ||
    !Number.isFinite(input.quantity * mlFactor[input.unit]) ||
    input.quantity * mlFactor[input.unit] >= MAX_QUANTITY_ML
  )
    throw new NutritionError("INVALID_INPUT", "Water quantity or unit is invalid");
  if (
    !(input.observedAt instanceof Date) ||
    !Number.isFinite(input.observedAt.getTime()) ||
    !isValidTimeZone(input.timeZone)
  )
    throw new NutritionError("INVALID_INPUT", "Water time or time zone is invalid");
  assertMutationId(input.clientMutationId);
  return {
    quantityMl: input.quantity * mlFactor[input.unit],
    observedAt: input.observedAt,
    timeZone: input.timeZone,
  };
}

function reviveEntry(entry: WaterEntry): WaterEntry {
  return {
    ...entry,
    observedAt: new Date(entry.observedAt),
    deletedAt: entry.deletedAt ? new Date(entry.deletedAt) : null,
    createdAt: new Date(entry.createdAt),
    updatedAt: new Date(entry.updatedAt),
  };
}

function validGoal(value: number | null | undefined) {
  return value == null || (Number.isFinite(value) && value > 0 && value < MAX_QUANTITY_ML);
}

export function createPlainWaterDiary(db: Database) {
  const scopeWhere = (scope: NutritionScope) =>
    and(
      eq(plainWaterEntry.organizationId, scope.organizationId),
      eq(plainWaterEntry.userId, scope.userId),
    );
  const preferenceWhere = (scope: NutritionScope) =>
    and(
      eq(plainWaterPreference.organizationId, scope.organizationId),
      eq(plainWaterPreference.userId, scope.userId),
    );

  async function lockMutation(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    scope: NutritionScope,
    id: string,
  ) {
    // The stable hash only serializes the same member's receipt namespace. It
    // contains no health values and collision merely serializes unrelated work.
    const lockKey = `${scope.organizationId}:${scope.userId}:${id}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 83))`);
  }

  async function replay<T extends WaterMutationOutcome>(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    scope: NutritionScope,
    id: string,
    kind: "add" | "edit" | "delete",
    fingerprint: string,
  ): Promise<T | null> {
    const [receipt] = await tx
      .select()
      .from(plainWaterMutation)
      .where(
        and(
          eq(plainWaterMutation.organizationId, scope.organizationId),
          eq(plainWaterMutation.userId, scope.userId),
          eq(plainWaterMutation.clientMutationId, id),
        ),
      );
    if (!receipt) return null;
    if (receipt.kind !== kind || receipt.fingerprint !== fingerprint)
      throw new NutritionError("INVALID_INPUT", "Client mutation id was already used");
    const saved = receipt.outcome as T;
    return { ...saved, entry: reviveEntry(saved.entry) } as T;
  }

  async function saveReceipt(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    scope: NutritionScope,
    id: string,
    kind: "add" | "edit" | "delete",
    fingerprint: string,
    result: WaterMutationOutcome,
  ) {
    await tx.insert(plainWaterMutation).values({
      ...scope,
      clientMutationId: id,
      kind,
      fingerprint,
      entryId: result.entry.id,
      outcome: result,
    });
  }

  async function isEnabled(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    scope: NutritionScope,
  ) {
    const [preference] = await tx
      .select({ enabled: plainWaterPreference.enabled })
      .from(plainWaterPreference)
      .where(preferenceWhere(scope));
    return preference?.enabled === true;
  }

  function requireEnabled(enabled: boolean) {
    if (!enabled)
      throw new NutritionError(
        "INVALID_INPUT",
        "Enable plain-water logging before using its entries",
      );
  }

  return {
    async getPreference(scope: NutritionScope) {
      const [preference] = await db
        .select({
          enabled: plainWaterPreference.enabled,
          personalGoalMl: plainWaterPreference.personalGoalMl,
        })
        .from(plainWaterPreference)
        .where(preferenceWhere(scope));
      return {
        enabled: preference?.enabled ?? false,
        personalGoalMl: preference?.personalGoalMl ?? null,
      };
    },
    async add(scope: NutritionScope, input: WaterInput): Promise<WaterMutationOutcome> {
      const value = normalize(input);
      const id = assertMutationId(input.clientMutationId);
      const fingerprint = canonicalFingerprint({ kind: "add", value });
      return db.transaction(async (tx) => {
        await lockMutation(tx, scope, id);
        const previous = await replay<WaterMutationOutcome>(tx, scope, id, "add", fingerprint);
        if (previous)
          return previous.outcome === "conflict" ? previous : { ...previous, outcome: "replayed" };
        requireEnabled(await isEnabled(tx, scope));
        const [entry] = await tx
          .insert(plainWaterEntry)
          .values({ ...scope, ...value, clientMutationId: id })
          .returning();
        if (!entry) throw new Error("Water entry insert returned no row");
        const result = { outcome: "applied" as const, entry };
        await saveReceipt(tx, scope, id, "add", fingerprint, result);
        return result;
      });
    },

    async change(
      scope: NutritionScope,
      input: {
        id: number;
        clientMutationId: string;
        expectedRevision: number;
        deleted?: boolean;
        quantity?: number;
        unit?: WaterUnit;
        observedAt?: Date;
        timeZone?: string;
      },
    ): Promise<WaterMutationOutcome> {
      if (
        !Number.isSafeInteger(input.id) ||
        input.id < 1 ||
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 1
      )
        throw new NutritionError("INVALID_INPUT", "Water change is invalid");
      const id = assertMutationId(input.clientMutationId);
      if (
        input.deleted &&
        (input.quantity !== undefined ||
          input.unit !== undefined ||
          input.observedAt ||
          input.timeZone)
      )
        throw new NutritionError("INVALID_INPUT", "Delete cannot include edited values");
      if (!input.deleted && (input.quantity === undefined) !== (input.unit === undefined))
        throw new NutritionError("INVALID_INPUT", "Quantity and unit must be provided together");
      return db.transaction(async (tx) => {
        await lockMutation(tx, scope, id);
        const kind = input.deleted ? "delete" : "edit";
        const fingerprint = canonicalFingerprint({
          kind,
          entryId: input.id,
          expectedRevision: input.expectedRevision,
          quantity: input.quantity,
          unit: input.unit,
          observedAt: input.observedAt?.toISOString(),
          timeZone: input.timeZone,
        });
        const previous = await replay<WaterMutationOutcome>(tx, scope, id, kind, fingerprint);
        if (previous)
          return previous.outcome === "conflict" ? previous : { ...previous, outcome: "replayed" };

        // Owners may delete their own records even after opting out. Listing
        // and editing remain hidden/disabled; this is a data-control operation.
        if (!input.deleted) requireEnabled(await isEnabled(tx, scope));
        const where = and(scopeWhere(scope), eq(plainWaterEntry.id, input.id));
        const [current] = await tx.select().from(plainWaterEntry).where(where).for("update");
        if (!current) throw new NutritionError("NOT_FOUND", "Water entry not found");
        if (current.deletedAt && !input.deleted)
          throw new NutritionError("NOT_FOUND", "Water entry not found");
        if (current.revision !== input.expectedRevision) {
          const conflict = { outcome: "conflict" as const, entry: current };
          await saveReceipt(tx, scope, id, kind, fingerprint, conflict);
          return conflict;
        }
        const changes: Partial<typeof plainWaterEntry.$inferInsert> = {
          revision: current.revision + 1,
          updatedAt: new Date(),
        };
        if (input.deleted) changes.deletedAt = new Date();
        if (input.quantity !== undefined && input.unit !== undefined) {
          const normalized = normalize({
            quantity: input.quantity,
            unit: input.unit,
            observedAt: input.observedAt ?? current.observedAt,
            timeZone: input.timeZone ?? current.timeZone,
            clientMutationId: id,
          });
          changes.quantityMl = normalized.quantityMl;
          changes.observedAt = normalized.observedAt;
          changes.timeZone = normalized.timeZone;
        } else if (input.observedAt !== undefined || input.timeZone !== undefined) {
          const normalized = normalize({
            quantity: current.quantityMl,
            unit: "ml",
            observedAt: input.observedAt ?? current.observedAt,
            timeZone: input.timeZone ?? current.timeZone,
            clientMutationId: id,
          });
          changes.observedAt = normalized.observedAt;
          changes.timeZone = normalized.timeZone;
        }
        const [entry] = await tx.update(plainWaterEntry).set(changes).where(where).returning();
        if (!entry) throw new NutritionError("NOT_FOUND", "Water entry not found");
        const result = { outcome: "applied" as const, entry };
        await saveReceipt(tx, scope, id, kind, fingerprint, result);
        return result;
      });
    },

    async getDay(scope: NutritionScope, date: string, timeZone: string) {
      if (!isLocalDate(date) || !isValidTimeZone(timeZone))
        throw new NutritionError("INVALID_INPUT", "Date or time zone is invalid");
      const start = firstInstantOfLocalDate(date, timeZone);
      const nextDate = new Date(`${date}T00:00:00.000Z`);
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      const end = firstInstantOfLocalDate(nextDate.toISOString().slice(0, 10), timeZone);
      const [preference] = await db
        .select({
          enabled: plainWaterPreference.enabled,
          personalGoalMl: plainWaterPreference.personalGoalMl,
        })
        .from(plainWaterPreference)
        .where(preferenceWhere(scope));
      if (!preference?.enabled)
        return {
          date,
          timeZone,
          label: "Plain water subtotal",
          enabled: false,
          quantityMl: null,
          entries: [],
          personalGoalMl: null,
        };
      const entries =
        start.getTime() === end.getTime()
          ? []
          : await db
              .select()
              .from(plainWaterEntry)
              .where(
                and(
                  eq(plainWaterEntry.organizationId, scope.organizationId),
                  eq(plainWaterEntry.userId, scope.userId),
                  gte(plainWaterEntry.observedAt, start),
                  lt(plainWaterEntry.observedAt, end),
                  isNull(plainWaterEntry.deletedAt),
                ),
              );
      return {
        date,
        timeZone,
        label: "Plain water subtotal",
        enabled: true,
        quantityMl: entries.reduce((sum, row) => sum + row.quantityMl, 0),
        entries,
        personalGoalMl: preference.personalGoalMl,
      };
    },

    async setPreference(
      scope: NutritionScope,
      input: { enabled?: boolean; personalGoalMl?: number | null },
    ) {
      if (input.personalGoalMl !== undefined && !validGoal(input.personalGoalMl))
        throw new NutritionError("INVALID_INPUT", "Personal goal is invalid");
      const [current] = await db.select().from(plainWaterPreference).where(preferenceWhere(scope));
      const [row] = await db
        .insert(plainWaterPreference)
        .values({
          ...scope,
          enabled: input.enabled ?? current?.enabled ?? false,
          personalGoalMl:
            input.personalGoalMl === undefined
              ? (current?.personalGoalMl ?? null)
              : input.personalGoalMl,
        })
        .onConflictDoUpdate({
          target: [plainWaterPreference.organizationId, plainWaterPreference.userId],
          set: {
            ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
            ...(input.personalGoalMl === undefined ? {} : { personalGoalMl: input.personalGoalMl }),
            updatedAt: new Date(),
          },
        })
        .returning();
      return row;
    },
  };
}

/** Locate the first actual instant on/after a local calendar date. This uses
 * a date-boundary binary search, not a guessed zone offset. It therefore
 * yields 23/25-hour days and an empty interval for a skipped civil date. */
function firstInstantOfLocalDate(date: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const utcMidnight = Date.UTC(year!, month! - 1, day!);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const localDate = (instant: number) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(instant).map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  let low = utcMidnight - 3 * 86_400_000;
  let high = utcMidnight + 3 * 86_400_000;
  if (localDate(low) >= date || localDate(high) < date)
    throw new NutritionError("INVALID_INPUT", "Date is outside supported time-zone range");
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (localDate(mid) >= date) high = mid;
    else low = mid;
  }
  return new Date(high);
}
