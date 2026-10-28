import type { Database } from "@openvalens/db";
import {
  nutritionDiaryDay,
  nutritionDiaryMutation,
  nutritionFavoriteFood,
  nutritionMeal,
  nutritionFoodSnapshot,
  nutritionMealEntry,
  nutritionDiaryBatch,
  nutritionTemplate,
  nutritionTemplateRevision,
} from "@openvalens/db/schema/nutrition";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { createHash } from "node:crypto";

import { createCustomFoods, type CreateCustomFoodInput } from "./custom-foods";
import { NutritionError } from "./errors";
import type { FoodLookupProvider } from "./food-lookup";
import { createFoodSearch, foodResultToLogFood } from "./food-search";
import { isLocalDate, isValidTimeZone, MEAL_SLOTS, type MealSlot } from "./local-day";
import {
  computeNutrientFactor,
  nutrientsOf,
  type AmountUnit,
  type NutrientBasis,
  type NutrientValues,
} from "./nutrients";
import {
  createNutritionRepository,
  ensureMeal,
  selectEntry,
  type DiaryEntry,
  type FoodSnapshot,
  type LogEntryInput,
  type LogEntryResult,
  type NutritionScope,
  type Tx,
} from "./repository";
import { sourceQualifiedId } from "./snapshot";
import { summarizeEntries, type NutrientSummary } from "./totals";

/**
 * Meal diary service (Issue #77) on top of the #74 repository. Adds the
 * explicit "day complete" marker, recents/favourites, copy-day, and
 * idempotent, conflict-aware edits for offline replay:
 *
 * - Every write carries a client mutation id. Logging dedupes on the entry's
 *   own `client_mutation_id`; edit/delete/restore record the id in
 *   `nutrition_diary_mutation`, so a replay returns `replayed` with the
 *   entry's current state and never applies the change twice.
 * - Edit/delete/restore send the `revision` the client last saw. A different
 *   server revision returns `conflict` with the server's state; nothing is
 *   overwritten until the member chooses (resend with the new revision, or
 *   keep the server's version).
 *
 * Every method takes the session-derived `NutritionScope`; rows outside it
 * behave as missing. Nothing here logs values.
 */

export type DiaryDayStatus = "unmarked" | "complete";

export type DiaryDay = {
  localDate: string;
  /** `unmarked` covers both "never marked" and "marker cleared": never zero intake. */
  status: DiaryDayStatus;
  completedAt: Date | null;
  entries: DiaryEntry[];
  /** Server-computed totals and per-nutrient coverage over `entries` (#79). */
  summary: NutrientSummary;
};

/** How a client picks a food to log. */
export type DiaryFoodRef =
  | Exclude<LogEntryInput["food"], { kind: "external" }>
  | { kind: "external"; snapshot: Extract<LogEntryInput["food"], { kind: "external" }>["snapshot"] }
  /**
   * A food by source-qualified id (`custom:42`, `fdc:123`, `off:301...`),
   * resolved server-side through #69 food search; the client never supplies
   * its nutrient values.
   */
  | { kind: "catalog"; id: string };

export type DiaryLogInput = Omit<LogEntryInput, "food" | "clientMutationId"> & {
  food: DiaryFoodRef;
  clientMutationId: string;
};

export type EntryOutcome =
  | { outcome: "applied" | "replayed"; entry: DiaryEntry }
  /** The server changed since `expectedRevision`; `server` is its current state. */
  | { outcome: "conflict"; server: DiaryEntry };

export type EntryChangeInput = {
  entryId: number;
  clientMutationId: string;
  /** Revision the client last saw; `null`/omitted applies without a conflict check. */
  expectedRevision?: number | null;
};

export type UpdateEntryInput = EntryChangeInput & {
  amount: number;
  unit: AmountUnit;
  /** Move the entry to another local day and its own zone snapshot. */
  slot?: MealSlot;
  localDate?: string;
  timeZone?: string;
};

export type CopyDayInput = {
  fromDate: string;
  toDate: string;
  timeZone: string;
  /** Entries to copy (all active entries of `fromDate` when omitted). */
  entryIds?: number[];
  entries?: {
    itemKey: string;
    snapshotId: number;
    amount: number;
    unit: AmountUnit;
    slot: MealSlot;
  }[];
  targetSlot?: MealSlot;
  /** Each copy gets `${clientMutationId}:${sourceEntryId}`, so replays copy nothing twice. */
  clientMutationId: string;
};

export type LogTemplateInput = {
  clientMutationId: string;
  templateId: number;
  templateRevision: number;
  localDate: string;
  timeZone: string;
  slot: MealSlot;
  servings?: number;
};

/** A food the member can log again without searching. */
export type FoodChoice = {
  ref: { kind: "snapshot"; snapshotId: number } | { kind: "custom"; foodId: number };
  source: FoodSnapshot["source"];
  sourceQualifiedId: string | null;
  attribution: string | null;
  name: string;
  brand: string | null;
  basis: NutrientBasis;
  nutrientsPerBasis: NutrientValues;
  /** Recents only: when this food was last logged. */
  lastLoggedAt: Date | null;
  lastAmount: number | null;
  lastUnit: AmountUnit | null;
  lastSlot: MealSlot | null;
};

export type DiaryFoods = {
  recents: FoodChoice[];
  favorites: FoodChoice[];
  customFoods: FoodChoice[];
};

const RECENT_LIMIT = 20;
const MAX_CLIENT_MUTATION_ID = 64;

function assertMutationId(value: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_CLIENT_MUTATION_ID)
    throw new NutritionError("INVALID_INPUT", "Client mutation id must be 1 to 64 characters");
  return value;
}

function assertDate(value: string): string {
  if (!isLocalDate(value))
    throw new NutritionError("INVALID_INPUT", "Local date must be a YYYY-MM-DD calendar date");
  return value;
}

function basisOf(row: NutrientBasis): NutrientBasis {
  return {
    nutrientBasisAmount: row.nutrientBasisAmount,
    nutrientBasisUnit: row.nutrientBasisUnit,
    servingSizeAmount: row.servingSizeAmount,
    servingSizeUnit: row.servingSizeUnit,
    servingLabel: row.servingLabel,
  };
}

type LastPortion = {
  lastLoggedAt: Date;
  lastAmount: number;
  lastUnit: AmountUnit;
  lastSlot: MealSlot;
  entryId: number;
};

function snapshotChoice(snapshot: FoodSnapshot, last: LastPortion | null): FoodChoice {
  return {
    ref: { kind: "snapshot", snapshotId: snapshot.id },
    source: snapshot.source,
    sourceQualifiedId:
      snapshot.sourceFoodId === null
        ? null
        : sourceQualifiedId(snapshot.source, snapshot.sourceFoodId),
    attribution: snapshot.attribution,
    name: snapshot.name,
    brand: snapshot.brand,
    basis: basisOf(snapshot),
    nutrientsPerBasis: nutrientsOf(snapshot),
    lastLoggedAt: last?.lastLoggedAt ?? null,
    lastAmount: last?.lastAmount ?? null,
    lastUnit: last?.lastUnit ?? null,
    lastSlot: last?.lastSlot ?? null,
  };
}

const ownEntry = (scope: NutritionScope, entryId: number) =>
  and(
    eq(nutritionMealEntry.organizationId, scope.organizationId),
    eq(nutritionMealEntry.userId, scope.userId),
    eq(nutritionMealEntry.id, entryId),
  );

export type NutritionDiaryOptions = {
  /** Optional live barcode lookup (#69), used when an `off:` id is not mirrored. */
  liveLookup?: FoodLookupProvider | null;
};

export function createNutritionDiary(db: Database, options: NutritionDiaryOptions = {}) {
  const repo = createNutritionRepository(db);
  const foodSearch = createFoodSearch(db, { liveLookup: options.liveLookup ?? null });
  const customFoods = createCustomFoods(db);

  /** Current state of an entry (deleted or not) inside `scope`, locked for the transaction. */
  async function lockEntry(tx: Tx, scope: NutritionScope, entryId: number) {
    await tx
      .select({ id: nutritionMealEntry.id })
      .from(nutritionMealEntry)
      .where(ownEntry(scope, entryId))
      .for("update");
    return selectEntry(tx, scope, eq(nutritionMealEntry.id, entryId));
  }

  /** The entry a previously applied mutation id touched, or `null` for a new id. */
  async function replayOf(tx: Tx, scope: NutritionScope, clientMutationId: string) {
    const [row] = await tx
      .select({ entryId: nutritionDiaryMutation.entryId })
      .from(nutritionDiaryMutation)
      .where(
        and(
          eq(nutritionDiaryMutation.organizationId, scope.organizationId),
          eq(nutritionDiaryMutation.userId, scope.userId),
          eq(nutritionDiaryMutation.clientMutationId, clientMutationId),
        ),
      );
    if (!row) return null;
    const entry = await selectEntry(tx, scope, eq(nutritionMealEntry.id, row.entryId));
    if (!entry) throw new NutritionError("NOT_FOUND", "Meal entry not found");
    return entry;
  }

  /**
   * Shared shape of edit/delete/restore: replay check, lock, conflict check,
   * apply, record the mutation id — all in one transaction.
   */
  async function change(
    scope: NutritionScope,
    input: EntryChangeInput,
    kind: "update" | "delete" | "restore",
    apply: (tx: Tx, current: DiaryEntry) => Promise<"changed" | "unchanged" | "conflict">,
  ): Promise<EntryOutcome> {
    const clientMutationId = assertMutationId(input.clientMutationId);
    return db.transaction(async (tx) => {
      const replay = await replayOf(tx, scope, clientMutationId);
      if (replay) return { outcome: "replayed", entry: replay };
      const current = await lockEntry(tx, scope, input.entryId);
      if (!current) throw new NutritionError("NOT_FOUND", "Meal entry not found");
      const stale =
        input.expectedRevision !== undefined &&
        input.expectedRevision !== null &&
        input.expectedRevision !== current.revision;
      const result = stale ? "conflict" : await apply(tx, current);
      if (result === "conflict") return { outcome: "conflict", server: current };
      await tx.insert(nutritionDiaryMutation).values({
        ...scope,
        clientMutationId,
        kind,
        entryId: current.id,
      });
      const entry = await selectEntry(tx, scope, eq(nutritionMealEntry.id, current.id));
      if (!entry) throw new NutritionError("NOT_FOUND", "Meal entry not found");
      return { outcome: "applied", entry };
    });
  }

  /**
   * Snapshots are organization-wide rows; a member may only reuse one they
   * logged themselves, so another member's private foods stay invisible.
   */
  async function assertOwnSnapshot(scope: NutritionScope, snapshotId: number) {
    const [logged] = await db
      .select({ id: nutritionMealEntry.id })
      .from(nutritionMealEntry)
      .where(
        and(
          eq(nutritionMealEntry.organizationId, scope.organizationId),
          eq(nutritionMealEntry.userId, scope.userId),
          eq(nutritionMealEntry.snapshotId, snapshotId),
        ),
      )
      .limit(1);
    if (!logged) {
      const [revision] = await db
        .select({ id: nutritionTemplateRevision.id })
        .from(nutritionTemplateRevision)
        .where(
          and(
            eq(nutritionTemplateRevision.organizationId, scope.organizationId),
            eq(nutritionTemplateRevision.userId, scope.userId),
            sql`${nutritionTemplateRevision.ingredients} @> ${JSON.stringify([{ snapshotId }])}::jsonb`,
          ),
        )
        .limit(1);
      if (!revision) throw new NutritionError("NOT_FOUND", "Food snapshot not found");
    }
  }

  const bump = () => ({
    revision: sql`${nutritionMealEntry.revision} + 1`,
    updatedAt: new Date(),
  });

  return {
    /** Active entries and the explicit day marker for one local day. */
    async getDay(scope: NutritionScope, localDate: string): Promise<DiaryDay> {
      assertDate(localDate);
      const [entries, [day]] = await Promise.all([
        repo.listDayEntries(scope, localDate),
        db
          .select({ completedAt: nutritionDiaryDay.completedAt })
          .from(nutritionDiaryDay)
          .where(
            and(
              eq(nutritionDiaryDay.organizationId, scope.organizationId),
              eq(nutritionDiaryDay.userId, scope.userId),
              eq(nutritionDiaryDay.localDate, localDate),
            ),
          ),
      ]);
      const completedAt = day?.completedAt ?? null;
      return {
        localDate,
        status: completedAt ? "complete" : "unmarked",
        completedAt,
        entries,
        summary: summarizeEntries(
          entries.map((entry) => ({ nutrients: entry.nutrients, source: entry.food.source })),
        ),
      };
    },

    /**
     * Logs one food. Catalog foods are resolved from #72 and copied into a
     * snapshot; a replayed `clientMutationId` returns the original entry.
     */
    async logEntry(scope: NutritionScope, input: DiaryLogInput): Promise<LogEntryResult> {
      const clientMutationId = assertMutationId(input.clientMutationId);
      let food: LogEntryInput["food"];
      if (input.food.kind === "catalog") {
        const found = await foodSearch.getFood(scope, input.food.id);
        if (!found) throw new NutritionError("NOT_FOUND", "Food not found");
        food = foodResultToLogFood(found);
      } else {
        if (input.food.kind === "snapshot") await assertOwnSnapshot(scope, input.food.snapshotId);
        food = input.food;
      }
      return repo.logEntry(scope, { ...input, food, clientMutationId });
    },

    /** Changes amount/unit (and optionally the slot on the same day). */
    async updateEntry(scope: NutritionScope, input: UpdateEntryInput): Promise<EntryOutcome> {
      if (input.slot !== undefined && !MEAL_SLOTS.includes(input.slot))
        throw new NutritionError("INVALID_INPUT", "Unsupported meal slot");
      if ((input.localDate === undefined) !== (input.timeZone === undefined))
        throw new NutritionError(
          "INVALID_INPUT",
          "Local date and time zone must be supplied together",
        );
      if (input.localDate !== undefined) assertDate(input.localDate);
      if (input.timeZone !== undefined && !isValidTimeZone(input.timeZone))
        throw new NutritionError("INVALID_INPUT", "Unknown time zone");
      return change(scope, input, "update", async (tx, current) => {
        // Editing a deleted entry would silently resurrect it: ask instead.
        if (current.deletedAt) return "conflict";
        const nutrientFactor = computeNutrientFactor(current.food.basis, input.amount, input.unit);
        let mealId = current.mealId;
        const nextDate = input.localDate ?? current.localDate;
        const nextZone = input.timeZone ?? current.timeZone;
        const nextSlot = input.slot ?? current.slot;
        if (
          nextDate !== current.localDate ||
          nextZone !== current.timeZone ||
          nextSlot !== current.slot
        ) {
          const meal = await ensureMeal(tx, scope, {
            localDate: nextDate,
            timeZone: nextZone,
            slot: nextSlot,
          });
          mealId = meal.id;
        }
        await tx
          .update(nutritionMealEntry)
          .set({
            amount: input.amount,
            unit: input.unit,
            timeZone: input.timeZone ?? current.timeZone,
            nutrientFactor,
            mealId,
            ...bump(),
          })
          .where(ownEntry(scope, current.id));
        return "changed";
      });
    },

    /** Soft-deletes an entry. Deleting an already deleted entry is a no-op. */
    async deleteEntry(scope: NutritionScope, input: EntryChangeInput): Promise<EntryOutcome> {
      return change(scope, input, "delete", async (tx, current) => {
        if (current.deletedAt) return "unchanged";
        await tx
          .update(nutritionMealEntry)
          .set({ deletedAt: new Date(), ...bump() })
          .where(ownEntry(scope, current.id));
        return "changed";
      });
    },

    /** Undo for `deleteEntry`. Restoring an active entry is a no-op. */
    async restoreEntry(scope: NutritionScope, input: EntryChangeInput): Promise<EntryOutcome> {
      return change(scope, input, "restore", async (tx, current) => {
        if (!current.deletedAt) return "unchanged";
        await tx
          .update(nutritionMealEntry)
          .set({ deletedAt: null, ...bump() })
          .where(ownEntry(scope, current.id));
        return "changed";
      });
    },

    /**
     * Sets or clears the explicit "day complete" marker. Setting a value is
     * idempotent, so replays need no ledger.
     */
    async setDayStatus(
      scope: NutritionScope,
      input: { localDate: string; complete: boolean },
    ): Promise<{ localDate: string; status: DiaryDayStatus; completedAt: Date | null }> {
      assertDate(input.localDate);
      const now = new Date();
      const [row] = await db
        .insert(nutritionDiaryDay)
        .values({ ...scope, localDate: input.localDate, completedAt: input.complete ? now : null })
        .onConflictDoUpdate({
          target: [
            nutritionDiaryDay.organizationId,
            nutritionDiaryDay.userId,
            nutritionDiaryDay.localDate,
          ],
          set: {
            // Keep the first completion time when a replay marks it again.
            completedAt: input.complete
              ? sql`coalesce(${nutritionDiaryDay.completedAt}, ${now})`
              : null,
            updatedAt: now,
          },
        })
        .returning({ completedAt: nutritionDiaryDay.completedAt });
      const completedAt = row?.completedAt ?? null;
      return {
        localDate: input.localDate,
        status: completedAt ? "complete" : "unmarked",
        completedAt,
      };
    },

    /**
     * Copies entries from one local day into the same slots on another, as
     * new `copied` entries pointing at the same snapshots.
     */
    async copyDay(
      scope: NutritionScope,
      input: CopyDayInput,
    ): Promise<{ entries: DiaryEntry[]; created: number }> {
      const clientMutationId = assertMutationId(input.clientMutationId);
      assertDate(input.fromDate);
      assertDate(input.toDate);
      if (input.fromDate === input.toDate && !input.targetSlot)
        throw new NutritionError("INVALID_INPUT", "Choose a different meal slot");
      if (input.entryIds && input.entries)
        throw new NutritionError(
          "INVALID_INPUT",
          "Choose source entry IDs or frozen entries, not both",
        );
      if (!isValidTimeZone(input.timeZone))
        throw new NutritionError("INVALID_INPUT", "Unknown time zone");
      if (
        input.entries &&
        new Set(input.entries.map((item) => item.itemKey)).size !== input.entries.length
      )
        throw new NutritionError("INVALID_INPUT", "Item keys must be unique");
      const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      return db.transaction(async (tx) => {
        const [receipt] = await tx
          .select()
          .from(nutritionDiaryBatch)
          .where(
            and(
              eq(nutritionDiaryBatch.organizationId, scope.organizationId),
              eq(nutritionDiaryBatch.userId, scope.userId),
              eq(nutritionDiaryBatch.clientMutationId, clientMutationId),
            ),
          )
          .for("update");
        if (receipt) {
          if (receipt.operation !== "copyDay" || receipt.fingerprint !== fingerprint)
            throw new NutritionError(
              "INVALID_INPUT",
              "Mutation id was reused with different input",
            );
          const entries: DiaryEntry[] = [];
          for (const id of receipt.entryIds) {
            const entry = await selectEntry(tx, scope, eq(nutritionMealEntry.id, id));
            if (entry) entries.push(entry);
          }
          return { entries, created: 0 };
        }
        const source = input.entries ? [] : await repo.listDayEntries(scope, input.fromDate);
        const wanted = input.entryIds ? new Set(input.entryIds) : null;
        const selected = wanted ? source.filter((entry) => wanted.has(entry.id)) : source;
        if (wanted && selected.length !== wanted.size)
          throw new NutritionError("NOT_FOUND", "Meal entry not found");
        const copies =
          input.entries ??
          selected.map((entry) => ({
            itemKey: String(entry.id),
            snapshotId: entry.food.snapshotId,
            amount: entry.amount,
            unit: entry.unit,
            slot: input.targetSlot ?? entry.slot,
          }));
        if (
          input.fromDate === input.toDate &&
          copies.some((copy) =>
            source.some((entry) => String(entry.id) === copy.itemKey && entry.slot === copy.slot),
          )
        )
          throw new NutritionError(
            "INVALID_INPUT",
            "Same-day copies must use a different meal slot",
          );
        for (const copy of copies) await assertOwnSnapshot(scope, copy.snapshotId);
        const results = [];
        for (const item of copies) {
          const childId = `${clientMutationId}:${createHash("sha256").update(item.itemKey).digest("hex").slice(0, 24)}`;
          results.push(
            await repo.logEntryInTransaction(tx, scope, {
              localDate: input.toDate,
              timeZone: input.timeZone,
              slot: item.slot,
              food: { kind: "snapshot", snapshotId: item.snapshotId },
              amount: item.amount,
              unit: item.unit,
              method: "copied",
              clientMutationId: childId,
            }),
          );
        }
        await tx.insert(nutritionDiaryBatch).values({
          ...scope,
          clientMutationId,
          operation: "copyDay",
          fingerprint,
          entryIds: results.map((r) => r.entry.id),
        });
        return {
          entries: results.map((r) => r.entry),
          created: results.filter((r) => r.created).length,
        };
      });
    },

    /** Logs the exact immutable revision of an owned saved meal or recipe. */
    async logTemplate(
      scope: NutritionScope,
      input: LogTemplateInput,
    ): Promise<{ entries: DiaryEntry[]; created: number }> {
      const clientMutationId = assertMutationId(input.clientMutationId);
      assertDate(input.localDate);
      if (!isValidTimeZone(input.timeZone))
        throw new NutritionError("INVALID_INPUT", "Unknown time zone");
      if (!MEAL_SLOTS.includes(input.slot))
        throw new NutritionError("INVALID_INPUT", "Unsupported meal slot");
      if (
        !Number.isInteger(input.templateId) ||
        input.templateId < 1 ||
        !Number.isInteger(input.templateRevision) ||
        input.templateRevision < 1
      )
        throw new NutritionError("INVALID_INPUT", "Template revision is invalid");
      if (input.servings !== undefined && (!Number.isFinite(input.servings) || input.servings <= 0))
        throw new NutritionError("INVALID_INPUT", "Servings must be positive");
      const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      return db.transaction(async (tx) => {
        const [receipt] = await tx
          .select()
          .from(nutritionDiaryBatch)
          .where(
            and(
              eq(nutritionDiaryBatch.organizationId, scope.organizationId),
              eq(nutritionDiaryBatch.userId, scope.userId),
              eq(nutritionDiaryBatch.clientMutationId, clientMutationId),
            ),
          )
          .for("update");
        if (receipt) {
          if (receipt.operation !== "logTemplate" || receipt.fingerprint !== fingerprint)
            throw new NutritionError(
              "INVALID_INPUT",
              "Mutation id was reused with different input",
            );
          const entries: DiaryEntry[] = [];
          for (const id of receipt.entryIds) {
            const entry = await selectEntry(tx, scope, eq(nutritionMealEntry.id, id));
            if (entry) entries.push(entry);
          }
          return { entries, created: 0 };
        }
        const [revision] = await tx
          .select({ revision: nutritionTemplateRevision, template: nutritionTemplate })
          .from(nutritionTemplateRevision)
          .innerJoin(
            nutritionTemplate,
            and(
              eq(nutritionTemplate.organizationId, nutritionTemplateRevision.organizationId),
              eq(nutritionTemplate.id, nutritionTemplateRevision.templateId),
            ),
          )
          .where(
            and(
              eq(nutritionTemplateRevision.organizationId, scope.organizationId),
              eq(nutritionTemplateRevision.userId, scope.userId),
              eq(nutritionTemplate.organizationId, scope.organizationId),
              eq(nutritionTemplate.userId, scope.userId),
              eq(nutritionTemplateRevision.templateId, input.templateId),
              eq(nutritionTemplateRevision.revision, input.templateRevision),
            ),
          )
          .for("update", { of: nutritionTemplate });
        if (!revision)
          throw new NutritionError("NOT_FOUND", "Nutrition template revision not found");
        const content = revision.revision;
        if (content.kind === "meal" && input.servings !== undefined)
          throw new NutritionError("INVALID_INPUT", "Servings are only valid for recipes");
        if (content.kind === "recipe" && input.servings === undefined)
          throw new NutritionError("INVALID_INPUT", "Recipe servings are required");
        const scale =
          content.kind === "recipe" ? input.servings! / (content.yieldServings ?? 0) : 1;
        if (!Number.isFinite(scale) || scale <= 0)
          throw new NutritionError("INVALID_INPUT", "Recipe yield is invalid");
        const results: LogEntryResult[] = [];
        for (const [index, ingredient] of content.ingredients.entries()) {
          results.push(
            await repo.logEntryInTransaction(tx, scope, {
              localDate: input.localDate,
              timeZone: input.timeZone,
              slot: input.slot,
              food: { kind: "snapshot", snapshotId: ingredient.snapshotId },
              amount: ingredient.amount * scale,
              unit: ingredient.unit,
              method: "copied",
              clientMutationId: `${clientMutationId}:template:${index}`,
            }),
          );
        }
        await tx.insert(nutritionDiaryBatch).values({
          ...scope,
          clientMutationId,
          operation: "logTemplate",
          fingerprint,
          entryIds: results.map((result) => result.entry.id),
        });
        return {
          entries: results.map((result) => result.entry),
          created: results.filter((result) => result.created).length,
        };
      });
    },

    /** Recently logged foods, favourites and active custom foods for quick logging. */
    async listFoods(scope: NutritionScope): Promise<DiaryFoods> {
      // One latest active row per snapshot, ordered by entry id for deterministic
      // ties. Reuse it for recents, favorites, and custom-food portions.
      const latestRows = await db
        .selectDistinctOn([nutritionMealEntry.snapshotId], {
          snapshot: nutritionFoodSnapshot,
          amount: nutritionMealEntry.amount,
          unit: nutritionMealEntry.unit,
          slot: nutritionMeal.slot,
          createdAt: nutritionMealEntry.createdAt,
          entryId: nutritionMealEntry.id,
        })
        .from(nutritionMealEntry)
        .innerJoin(
          nutritionFoodSnapshot,
          and(
            eq(nutritionFoodSnapshot.organizationId, nutritionMealEntry.organizationId),
            eq(nutritionFoodSnapshot.id, nutritionMealEntry.snapshotId),
          ),
        )
        .innerJoin(
          nutritionMeal,
          and(
            eq(nutritionMeal.organizationId, nutritionMealEntry.organizationId),
            eq(nutritionMeal.id, nutritionMealEntry.mealId),
          ),
        )
        .where(
          and(
            eq(nutritionMealEntry.organizationId, scope.organizationId),
            eq(nutritionMealEntry.userId, scope.userId),
            isNull(nutritionMealEntry.deletedAt),
          ),
        )
        .orderBy(
          nutritionMealEntry.snapshotId,
          desc(nutritionMealEntry.createdAt),
          desc(nutritionMealEntry.id),
        );
      const lastBySnapshot = new Map<number, LastPortion>();
      const lastByCustomFood = new Map<number, LastPortion>();
      for (const row of latestRows) {
        const last: LastPortion = {
          lastLoggedAt: row.createdAt,
          lastAmount: row.amount,
          lastUnit: row.unit,
          lastSlot: row.slot,
          entryId: row.entryId,
        };
        lastBySnapshot.set(row.snapshot.id, last);
        const customFoodId = row.snapshot.customFoodId;
        if (customFoodId !== null) {
          const current = lastByCustomFood.get(customFoodId);
          if (
            !current ||
            last.lastLoggedAt > current.lastLoggedAt ||
            (last.lastLoggedAt.getTime() === current.lastLoggedAt.getTime() &&
              last.entryId > current.entryId)
          )
            lastByCustomFood.set(customFoodId, last);
        }
      }
      const recentRows = [...latestRows]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.entryId - a.entryId)
        .slice(0, RECENT_LIMIT);
      const favoriteRows = await db
        .select({ snapshot: nutritionFoodSnapshot })
        .from(nutritionFavoriteFood)
        .innerJoin(
          nutritionFoodSnapshot,
          and(
            eq(nutritionFoodSnapshot.organizationId, nutritionFavoriteFood.organizationId),
            eq(nutritionFoodSnapshot.id, nutritionFavoriteFood.snapshotId),
          ),
        )
        .where(
          and(
            eq(nutritionFavoriteFood.organizationId, scope.organizationId),
            eq(nutritionFavoriteFood.userId, scope.userId),
          ),
        )
        .orderBy(asc(nutritionFoodSnapshot.name), asc(nutritionFoodSnapshot.id));
      const custom = await repo.listCustomFoods(scope);
      return {
        recents: recentRows.map((row) =>
          snapshotChoice(row.snapshot, lastBySnapshot.get(row.snapshot.id) ?? null),
        ),
        favorites: favoriteRows.map((row) => ({
          ...snapshotChoice(row.snapshot, lastBySnapshot.get(row.snapshot.id) ?? null),
          lastLoggedAt: null,
        })),
        customFoods: custom.map((food) => ({
          ref: { kind: "custom", foodId: food.id },
          source: "custom",
          sourceQualifiedId: sourceQualifiedId("custom", String(food.id)),
          attribution: null,
          name: food.name,
          brand: food.brand,
          basis: basisOf(food),
          nutrientsPerBasis: nutrientsOf(food),
          lastLoggedAt: null,
          lastAmount: lastByCustomFood.get(food.id)?.lastAmount ?? null,
          lastUnit: lastByCustomFood.get(food.id)?.lastUnit ?? null,
          lastSlot: lastByCustomFood.get(food.id)?.lastSlot ?? null,
        })),
      };
    },

    /** Marks or unmarks a logged food (snapshot) as a favourite; idempotent. */
    async setFavorite(
      scope: NutritionScope,
      input: { snapshotId: number; favorite: boolean },
    ): Promise<void> {
      if (!input.favorite) {
        await db
          .delete(nutritionFavoriteFood)
          .where(
            and(
              eq(nutritionFavoriteFood.organizationId, scope.organizationId),
              eq(nutritionFavoriteFood.userId, scope.userId),
              eq(nutritionFavoriteFood.snapshotId, input.snapshotId),
            ),
          );
        return;
      }
      await assertOwnSnapshot(scope, input.snapshotId);
      await db
        .insert(nutritionFavoriteFood)
        .values({ ...scope, snapshotId: input.snapshotId })
        .onConflictDoNothing({
          target: [
            nutritionFavoriteFood.organizationId,
            nutritionFavoriteFood.userId,
            nutritionFavoriteFood.snapshotId,
          ],
        });
    },

    /**
     * Saves a reusable private food; a retry with the same client mutation id
     * returns the food it already created. Editing/archiving: `createCustomFoods` (#81).
     */
    async createCustomFood(scope: NutritionScope, input: CreateCustomFoodInput) {
      return (await customFoods.create(scope, input)).food;
    },
  };
}

export type NutritionDiary = ReturnType<typeof createNutritionDiary>;
