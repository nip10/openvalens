import type { Database } from "@openvalens/db";
import {
  nutritionFood,
  nutritionFoodSnapshot,
  nutritionGoal,
  nutritionMeal,
  nutritionMealEntry,
} from "@openvalens/db/schema/nutrition";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { NutritionError } from "./errors";
import { assertLocalDay, isLocalDate, type MealSlot } from "./local-day";
import {
  NUTRIENT_COLUMNS,
  NUTRIENT_KEYS,
  computeNutrientFactor,
  normalizeBasis,
  normalizeNutrients,
  nutrientsOf,
  scaleNutrients,
  type AmountUnit,
  type NutrientBasis,
  type NutrientKey,
  type NutrientValues,
  type ServingSizeUnit,
} from "./nutrients";
import {
  customFoodSnapshotContent,
  externalSnapshotContent,
  normalizeBarcode,
  normalizeName,
  snapshotContentHash,
  sourceQualifiedId,
  type ExternalSnapshotInput,
  type SnapshotContent,
} from "./snapshot";

/**
 * Nutrition repository (Issue #74). Every method takes a `NutritionScope`
 * that the caller derives from the authenticated session (never from request
 * payloads): the active organization and the member whose diary it is. Rows
 * outside that scope behave as if they do not exist (`NOT_FOUND`). No health
 * values are logged; errors name rules only.
 */

export type NutritionScope = { organizationId: string; userId: string };

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type CustomFoodInput = {
  name: string;
  brand?: string | null;
  barcode?: string | null;
  nutrientBasisAmount: number;
  nutrientBasisUnit: AmountUnit;
  servingSizeAmount?: number | null;
  servingSizeUnit?: ServingSizeUnit | null;
  servingLabel?: string | null;
  /** Omitted keys are stored as unknown (`null`), never as zero. */
  nutrients?: Partial<NutrientValues>;
};

export type CustomFood = typeof nutritionFood.$inferSelect;
export type FoodSnapshot = typeof nutritionFoodSnapshot.$inferSelect;
export type MealEntryMethod = (typeof nutritionMealEntry.$inferSelect)["method"];

export type LogEntryInput = {
  localDate: string;
  /** IANA zone the member logged from; fixed on the meal when it is first created. */
  timeZone: string;
  slot: MealSlot;
  food:
    | { kind: "custom"; foodId: number }
    | { kind: "external"; snapshot: ExternalSnapshotInput }
    /** Reuse a snapshot already in this organization (copy-day, recents). */
    | { kind: "snapshot"; snapshotId: number };
  amount: number;
  unit: AmountUnit;
  method: MealEntryMethod;
  consumedAt?: Date | null;
  /** Client-generated id (1–128 chars) that makes retries/offline replays idempotent. */
  clientMutationId?: string | null;
};

export type DiaryEntry = {
  id: number;
  mealId: number;
  localDate: string;
  timeZone: string;
  slot: MealSlot;
  amount: number;
  unit: AmountUnit;
  method: MealEntryMethod;
  consumedAt: Date | null;
  clientMutationId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Logged food as it was at logging time. */
  food: {
    snapshotId: number;
    source: FoodSnapshot["source"];
    /** e.g. `fdc:123456`; `null` for one-off manual foods. */
    sourceQualifiedId: string | null;
    sourceVersion: string | null;
    attribution: string | null;
    name: string;
    brand: string | null;
    barcode: string | null;
    basis: NutrientBasis;
    /** Values per basis, exactly as captured. */
    nutrientsPerBasis: NutrientValues;
  };
  /** Values for this entry's amount; `null` stays unknown. */
  nutrients: NutrientValues;
};

export type LogEntryResult = {
  entry: DiaryEntry;
  /** `false` when `clientMutationId` matched an existing entry (replay). */
  created: boolean;
};

export type NutritionGoal = typeof nutritionGoal.$inferSelect;

export type GoalInput = {
  nutrient: NutrientKey;
  minAmount?: number | null;
  maxAmount?: number | null;
};

function customFoodValues(input: CustomFoodInput) {
  return {
    name: normalizeName(input.name),
    brand: input.brand?.trim() || null,
    barcode: input.barcode ? normalizeBarcode(input.barcode) : null,
    ...normalizeBasis(input),
    ...normalizeNutrients(input.nutrients),
  };
}

function assertClientMutationId(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (value.length < 1 || value.length > 128)
    throw new NutritionError("INVALID_INPUT", "Client mutation id must be 1 to 128 characters");
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

function toDiaryEntry(
  entry: typeof nutritionMealEntry.$inferSelect,
  meal: typeof nutritionMeal.$inferSelect,
  snapshot: FoodSnapshot,
): DiaryEntry {
  const perBasis = nutrientsOf(snapshot);
  return {
    id: entry.id,
    mealId: meal.id,
    localDate: meal.localDate,
    timeZone: meal.timeZone,
    slot: meal.slot,
    amount: entry.amount,
    unit: entry.unit,
    method: entry.method,
    consumedAt: entry.consumedAt,
    clientMutationId: entry.clientMutationId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    food: {
      snapshotId: snapshot.id,
      source: snapshot.source,
      sourceQualifiedId:
        snapshot.sourceFoodId === null
          ? null
          : sourceQualifiedId(snapshot.source, snapshot.sourceFoodId),
      sourceVersion: snapshot.sourceVersion,
      attribution: snapshot.attribution,
      name: snapshot.name,
      brand: snapshot.brand,
      barcode: snapshot.barcode,
      basis: basisOf(snapshot),
      nutrientsPerBasis: perBasis,
    },
    nutrients: scaleNutrients(perBasis, entry.nutrientFactor),
  };
}

async function selectEntry(tx: Tx, scope: NutritionScope, where: ReturnType<typeof and>) {
  const [row] = await tx
    .select({ entry: nutritionMealEntry, meal: nutritionMeal, snapshot: nutritionFoodSnapshot })
    .from(nutritionMealEntry)
    .innerJoin(
      nutritionMeal,
      and(
        eq(nutritionMeal.organizationId, nutritionMealEntry.organizationId),
        eq(nutritionMeal.id, nutritionMealEntry.mealId),
      ),
    )
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
        where,
      ),
    )
    .limit(1);
  return row ? toDiaryEntry(row.entry, row.meal, row.snapshot) : null;
}

/** Inserts the snapshot unless identical content already exists in the organization. */
async function ensureSnapshot(
  tx: Tx,
  organizationId: string,
  content: SnapshotContent,
): Promise<FoodSnapshot> {
  const contentHash = snapshotContentHash(content);
  const [inserted] = await tx
    .insert(nutritionFoodSnapshot)
    .values({ organizationId, ...content, contentHash })
    .onConflictDoNothing({
      target: [nutritionFoodSnapshot.organizationId, nutritionFoodSnapshot.contentHash],
    })
    .returning();
  if (inserted) return inserted;
  const [existing] = await tx
    .select()
    .from(nutritionFoodSnapshot)
    .where(
      and(
        eq(nutritionFoodSnapshot.organizationId, organizationId),
        eq(nutritionFoodSnapshot.contentHash, contentHash),
      ),
    );
  if (!existing) throw new Error("Snapshot upsert did not return a row");
  return existing;
}

async function resolveSnapshot(
  tx: Tx,
  scope: NutritionScope,
  food: LogEntryInput["food"],
): Promise<FoodSnapshot> {
  if (food.kind === "external")
    return ensureSnapshot(tx, scope.organizationId, externalSnapshotContent(food.snapshot));
  if (food.kind === "snapshot") {
    const [snapshot] = await tx
      .select()
      .from(nutritionFoodSnapshot)
      .where(
        and(
          eq(nutritionFoodSnapshot.organizationId, scope.organizationId),
          eq(nutritionFoodSnapshot.id, food.snapshotId),
        ),
      );
    if (!snapshot) throw new NutritionError("NOT_FOUND", "Food snapshot not found");
    return snapshot;
  }
  const [row] = await tx
    .select()
    .from(nutritionFood)
    .where(
      and(
        eq(nutritionFood.organizationId, scope.organizationId),
        eq(nutritionFood.userId, scope.userId),
        eq(nutritionFood.id, food.foodId),
        isNull(nutritionFood.archivedAt),
      ),
    );
  if (!row) throw new NutritionError("NOT_FOUND", "Custom food not found");
  return ensureSnapshot(tx, scope.organizationId, customFoodSnapshotContent(row));
}

async function ensureMeal(
  tx: Tx,
  scope: NutritionScope,
  day: { localDate: string; timeZone: string; slot: MealSlot },
) {
  const [inserted] = await tx
    .insert(nutritionMeal)
    .values({ ...scope, ...day })
    .onConflictDoNothing({
      target: [
        nutritionMeal.organizationId,
        nutritionMeal.userId,
        nutritionMeal.localDate,
        nutritionMeal.slot,
      ],
    })
    .returning();
  if (inserted) return inserted;
  const [existing] = await tx
    .select()
    .from(nutritionMeal)
    .where(
      and(
        eq(nutritionMeal.organizationId, scope.organizationId),
        eq(nutritionMeal.userId, scope.userId),
        eq(nutritionMeal.localDate, day.localDate),
        eq(nutritionMeal.slot, day.slot),
      ),
    );
  if (!existing) throw new Error("Meal upsert did not return a row");
  return existing;
}

export function createNutritionRepository(db: Database) {
  const byClientMutation = (id: string) => eq(nutritionMealEntry.clientMutationId, id);
  const activeEntry = (entryId: number) =>
    and(eq(nutritionMealEntry.id, entryId), isNull(nutritionMealEntry.deletedAt));
  const ownFood = (scope: NutritionScope, foodId: number) =>
    and(
      eq(nutritionFood.organizationId, scope.organizationId),
      eq(nutritionFood.userId, scope.userId),
      eq(nutritionFood.id, foodId),
    );

  return {
    // ─── Custom foods ──────────────────────────────────────────

    async createCustomFood(scope: NutritionScope, input: CustomFoodInput): Promise<CustomFood> {
      const [row] = await db
        .insert(nutritionFood)
        .values({ ...scope, ...customFoodValues(input) })
        .returning();
      if (!row) throw new Error("Custom food insert did not return a row");
      return row;
    },

    /**
     * Replaces a custom food's content and bumps `revision`. Snapshots taken
     * from earlier revisions are untouched, so logged history keeps its values.
     */
    async updateCustomFood(
      scope: NutritionScope,
      foodId: number,
      input: CustomFoodInput,
    ): Promise<CustomFood> {
      const values = customFoodValues(input);
      return db.transaction(async (tx) => {
        const [current] = await tx
          .select({ revision: nutritionFood.revision })
          .from(nutritionFood)
          .where(and(ownFood(scope, foodId), isNull(nutritionFood.archivedAt)))
          .for("update");
        if (!current) throw new NutritionError("NOT_FOUND", "Custom food not found");
        const [row] = await tx
          .update(nutritionFood)
          .set({ ...values, revision: current.revision + 1, updatedAt: new Date() })
          .where(ownFood(scope, foodId))
          .returning();
        if (!row) throw new NutritionError("NOT_FOUND", "Custom food not found");
        return row;
      });
    },

    /** Hides a custom food from new logging; existing entries keep their snapshots. */
    async archiveCustomFood(scope: NutritionScope, foodId: number): Promise<void> {
      const rows = await db
        .update(nutritionFood)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(ownFood(scope, foodId), isNull(nutritionFood.archivedAt)))
        .returning({ id: nutritionFood.id });
      if (rows.length === 0) throw new NutritionError("NOT_FOUND", "Custom food not found");
    },

    async getCustomFood(scope: NutritionScope, foodId: number): Promise<CustomFood | null> {
      const [row] = await db.select().from(nutritionFood).where(ownFood(scope, foodId));
      return row ?? null;
    },

    async listCustomFoods(
      scope: NutritionScope,
      options: { includeArchived?: boolean } = {},
    ): Promise<CustomFood[]> {
      return db
        .select()
        .from(nutritionFood)
        .where(
          and(
            eq(nutritionFood.organizationId, scope.organizationId),
            eq(nutritionFood.userId, scope.userId),
            options.includeArchived ? undefined : isNull(nutritionFood.archivedAt),
          ),
        )
        .orderBy(asc(nutritionFood.name), asc(nutritionFood.id));
    },

    // ─── Diary ─────────────────────────────────────────────────

    /**
     * Logs one food into a local-day meal slot, snapshotting the food first.
     * With `clientMutationId`, a replay returns the original entry unchanged
     * (`created: false`) instead of adding a duplicate.
     */
    async logEntry(scope: NutritionScope, input: LogEntryInput): Promise<LogEntryResult> {
      assertLocalDay(input);
      const clientMutationId = assertClientMutationId(input.clientMutationId);
      return db.transaction(async (tx) => {
        if (clientMutationId) {
          const replay = await selectEntry(tx, scope, byClientMutation(clientMutationId));
          if (replay) return { entry: replay, created: false };
        }
        const snapshot = await resolveSnapshot(tx, scope, input.food);
        const nutrientFactor = computeNutrientFactor(snapshot, input.amount, input.unit);
        const meal = await ensureMeal(tx, scope, input);
        const [inserted] = await tx
          .insert(nutritionMealEntry)
          .values({
            ...scope,
            mealId: meal.id,
            snapshotId: snapshot.id,
            amount: input.amount,
            unit: input.unit,
            nutrientFactor,
            method: input.method,
            consumedAt: input.consumedAt ?? null,
            clientMutationId,
          })
          .onConflictDoNothing({
            target: [
              nutritionMealEntry.organizationId,
              nutritionMealEntry.userId,
              nutritionMealEntry.clientMutationId,
            ],
            where: isNotNull(nutritionMealEntry.clientMutationId),
          })
          .returning({ id: nutritionMealEntry.id });
        const entry = await selectEntry(
          tx,
          scope,
          inserted
            ? eq(nutritionMealEntry.id, inserted.id)
            : byClientMutation(clientMutationId ?? ""),
        );
        if (!entry) throw new Error("Meal entry insert did not return a row");
        return { entry, created: Boolean(inserted) };
      });
    },

    /** Changes the logged amount; the snapshot (and its per-basis values) never changes. */
    async updateEntryAmount(
      scope: NutritionScope,
      entryId: number,
      input: { amount: number; unit: AmountUnit },
    ): Promise<DiaryEntry> {
      return db.transaction(async (tx) => {
        const current = await selectEntry(tx, scope, activeEntry(entryId));
        if (!current) throw new NutritionError("NOT_FOUND", "Meal entry not found");
        const nutrientFactor = computeNutrientFactor(current.food.basis, input.amount, input.unit);
        await tx
          .update(nutritionMealEntry)
          .set({ amount: input.amount, unit: input.unit, nutrientFactor, updatedAt: new Date() })
          .where(
            and(
              eq(nutritionMealEntry.organizationId, scope.organizationId),
              eq(nutritionMealEntry.userId, scope.userId),
              eq(nutritionMealEntry.id, entryId),
            ),
          );
        const updated = await selectEntry(tx, scope, eq(nutritionMealEntry.id, entryId));
        if (!updated) throw new NutritionError("NOT_FOUND", "Meal entry not found");
        return updated;
      });
    },

    /** Soft-deletes an entry (undo with `restoreEntry`). */
    async deleteEntry(scope: NutritionScope, entryId: number): Promise<void> {
      await setDeleted(scope, entryId, new Date());
    },

    async restoreEntry(scope: NutritionScope, entryId: number): Promise<void> {
      await setDeleted(scope, entryId, null);
    },

    async getEntry(scope: NutritionScope, entryId: number): Promise<DiaryEntry | null> {
      return db.transaction((tx) => selectEntry(tx, scope, activeEntry(entryId)));
    },

    /** Active entries for one local day, in slot then logging order. */
    async listDayEntries(scope: NutritionScope, localDate: string): Promise<DiaryEntry[]> {
      if (!isLocalDate(localDate))
        throw new NutritionError("INVALID_INPUT", "Local date must be a YYYY-MM-DD calendar date");
      const rows = await db
        .select({ entry: nutritionMealEntry, meal: nutritionMeal, snapshot: nutritionFoodSnapshot })
        .from(nutritionMealEntry)
        .innerJoin(
          nutritionMeal,
          and(
            eq(nutritionMeal.organizationId, nutritionMealEntry.organizationId),
            eq(nutritionMeal.id, nutritionMealEntry.mealId),
          ),
        )
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
            eq(nutritionMeal.localDate, localDate),
            isNull(nutritionMealEntry.deletedAt),
          ),
        )
        .orderBy(
          sql`array_position(array['breakfast', 'lunch', 'dinner', 'snack', 'other'], ${nutritionMeal.slot})`,
          asc(nutritionMealEntry.createdAt),
          asc(nutritionMealEntry.id),
        );
      return rows.map((row) => toDiaryEntry(row.entry, row.meal, row.snapshot));
    },

    // ─── Optional goals ────────────────────────────────────────

    /** Sets the member's goal for one nutrient, archiving any previous active goal. */
    async setGoal(scope: NutritionScope, input: GoalInput): Promise<NutritionGoal> {
      if (!NUTRIENT_KEYS.includes(input.nutrient))
        throw new NutritionError("INVALID_INPUT", "Unsupported nutrient");
      const minAmount = input.minAmount ?? null;
      const maxAmount = input.maxAmount ?? null;
      const valid = (value: number | null) =>
        value === null || (Number.isFinite(value) && value >= 0);
      if (
        (minAmount === null && maxAmount === null) ||
        !valid(minAmount) ||
        !valid(maxAmount) ||
        (minAmount !== null && maxAmount !== null && minAmount > maxAmount)
      )
        throw new NutritionError("INVALID_INPUT", "Goal needs a non-negative minimum or maximum");
      const nutrient = NUTRIENT_COLUMNS[input.nutrient];
      return db.transaction(async (tx) => {
        await tx
          .update(nutritionGoal)
          .set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(nutritionGoal.organizationId, scope.organizationId),
              eq(nutritionGoal.userId, scope.userId),
              eq(nutritionGoal.nutrient, nutrient),
              isNull(nutritionGoal.archivedAt),
            ),
          );
        const [row] = await tx
          .insert(nutritionGoal)
          .values({ ...scope, nutrient, minAmount, maxAmount })
          .returning();
        if (!row) throw new Error("Goal insert did not return a row");
        return row;
      });
    },

    async listActiveGoals(scope: NutritionScope): Promise<NutritionGoal[]> {
      return db
        .select()
        .from(nutritionGoal)
        .where(
          and(
            eq(nutritionGoal.organizationId, scope.organizationId),
            eq(nutritionGoal.userId, scope.userId),
            isNull(nutritionGoal.archivedAt),
          ),
        )
        .orderBy(asc(nutritionGoal.nutrient));
    },

    async archiveGoal(scope: NutritionScope, goalId: number): Promise<void> {
      const rows = await db
        .update(nutritionGoal)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(nutritionGoal.organizationId, scope.organizationId),
            eq(nutritionGoal.userId, scope.userId),
            eq(nutritionGoal.id, goalId),
            isNull(nutritionGoal.archivedAt),
          ),
        )
        .returning({ id: nutritionGoal.id });
      if (rows.length === 0) throw new NutritionError("NOT_FOUND", "Goal not found");
    },
  };

  async function setDeleted(scope: NutritionScope, entryId: number, deletedAt: Date | null) {
    const rows = await db
      .update(nutritionMealEntry)
      .set({ deletedAt, updatedAt: new Date() })
      .where(
        and(
          eq(nutritionMealEntry.organizationId, scope.organizationId),
          eq(nutritionMealEntry.userId, scope.userId),
          eq(nutritionMealEntry.id, entryId),
          deletedAt
            ? isNull(nutritionMealEntry.deletedAt)
            : isNotNull(nutritionMealEntry.deletedAt),
        ),
      )
      .returning({ id: nutritionMealEntry.id });
    if (rows.length === 0) throw new NutritionError("NOT_FOUND", "Meal entry not found");
  }
}

export type NutritionRepository = ReturnType<typeof createNutritionRepository>;
