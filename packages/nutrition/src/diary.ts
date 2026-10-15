import type { Database } from "@openvalens/db";
import {
  nutritionDiaryDay,
  nutritionDiaryMutation,
  nutritionFavoriteFood,
  nutritionFoodSnapshot,
  nutritionMealEntry,
} from "@openvalens/db/schema/nutrition";
import { and, asc, desc, eq, isNull, max, sql } from "drizzle-orm";

import { createCustomFoods, type CreateCustomFoodInput } from "./custom-foods";
import { NutritionError } from "./errors";
import type { FoodLookupProvider } from "./food-lookup";
import { createFoodSearch, foodResultToLogFood } from "./food-search";
import { isLocalDate, MEAL_SLOTS, type MealSlot } from "./local-day";
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
  /** Move the entry to another slot on the same local day. */
  slot?: MealSlot;
};

export type CopyDayInput = {
  fromDate: string;
  toDate: string;
  timeZone: string;
  /** Entries to copy (all active entries of `fromDate` when omitted). */
  entryIds?: number[];
  /** Each copy gets `${clientMutationId}:${sourceEntryId}`, so replays copy nothing twice. */
  clientMutationId: string;
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

function snapshotChoice(snapshot: FoodSnapshot, lastLoggedAt: Date | null): FoodChoice {
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
    lastLoggedAt,
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
    if (!logged) throw new NutritionError("NOT_FOUND", "Food snapshot not found");
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
      return change(scope, input, "update", async (tx, current) => {
        // Editing a deleted entry would silently resurrect it: ask instead.
        if (current.deletedAt) return "conflict";
        const nutrientFactor = computeNutrientFactor(current.food.basis, input.amount, input.unit);
        let mealId = current.mealId;
        if (input.slot && input.slot !== current.slot) {
          const meal = await ensureMeal(tx, scope, {
            localDate: current.localDate,
            timeZone: current.timeZone,
            slot: input.slot,
          });
          mealId = meal.id;
        }
        await tx
          .update(nutritionMealEntry)
          .set({ amount: input.amount, unit: input.unit, nutrientFactor, mealId, ...bump() })
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
      if (input.fromDate === input.toDate)
        throw new NutritionError("INVALID_INPUT", "Choose a different day to copy into");
      const source = await repo.listDayEntries(scope, input.fromDate);
      const wanted = input.entryIds ? new Set(input.entryIds) : null;
      const selected = wanted ? source.filter((entry) => wanted.has(entry.id)) : source;
      if (wanted && selected.length !== wanted.size)
        throw new NutritionError("NOT_FOUND", "Meal entry not found");
      const entries: DiaryEntry[] = [];
      let created = 0;
      for (const entry of selected) {
        const result = await repo.logEntry(scope, {
          localDate: input.toDate,
          timeZone: input.timeZone,
          slot: entry.slot,
          food: { kind: "snapshot", snapshotId: entry.food.snapshotId },
          amount: entry.amount,
          unit: entry.unit,
          method: "copied",
          clientMutationId: `${clientMutationId}:${entry.id}`,
        });
        entries.push(result.entry);
        if (result.created) created += 1;
      }
      return { entries, created };
    },

    /** Recently logged foods, favourites and active custom foods for quick logging. */
    async listFoods(scope: NutritionScope): Promise<DiaryFoods> {
      const recentRows = await db
        .select({
          snapshot: nutritionFoodSnapshot,
          lastLoggedAt: max(nutritionMealEntry.createdAt),
        })
        .from(nutritionMealEntry)
        .innerJoin(
          nutritionFoodSnapshot,
          and(
            eq(nutritionFoodSnapshot.organizationId, nutritionMealEntry.organizationId),
            eq(nutritionFoodSnapshot.id, nutritionMealEntry.snapshotId),
          ),
        )
        .where(
          and(
            eq(nutritionMealEntry.organizationId, scope.organizationId),
            eq(nutritionMealEntry.userId, scope.userId),
            isNull(nutritionMealEntry.deletedAt),
          ),
        )
        .groupBy(nutritionFoodSnapshot.id)
        .orderBy(desc(max(nutritionMealEntry.createdAt)), desc(nutritionFoodSnapshot.id))
        .limit(RECENT_LIMIT);
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
          snapshotChoice(row.snapshot, row.lastLoggedAt ? new Date(row.lastLoggedAt) : null),
        ),
        favorites: favoriteRows.map((row) => snapshotChoice(row.snapshot, null)),
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
