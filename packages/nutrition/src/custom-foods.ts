import type { Database } from "@openvalens/db";
import { nutritionFood } from "@openvalens/db/schema/nutrition";
import { and, asc, eq, isNull } from "drizzle-orm";

import { NutritionError } from "./errors";
import { NUTRIENT_KEYS } from "./nutrients";
import {
  customFoodValues,
  type CustomFood,
  type CustomFoodInput,
  type NutritionScope,
} from "./repository";

/**
 * Private custom food management (Issue #81) on top of the #74 table.
 *
 * - A custom food belongs to one member of one organization. Every method
 *   takes the session-derived `NutritionScope`; another member's or another
 *   workspace's food behaves as missing (`NOT_FOUND`). The owner is never
 *   read from input.
 * - Custom foods never enter the shared catalogs (#72): they live only in
 *   `nutrition_food`, and catalog search/lookup never reads that table.
 * - Edits bump `revision`. A meal entry points at the snapshot taken when it
 *   was logged (`source_version` = revision), so edits and archiving never
 *   rewrite logged history.
 * - Deletion is an archive: the food disappears from search, lookup, quick
 *   logging and new entries, and can be restored. Rows are only removed by
 *   data-rights erasure of the whole account or workspace.
 * - Writes are retry-safe: `create` dedupes on the client mutation id, an
 *   edit whose content already matches the server is `unchanged`, and
 *   archive/restore are idempotent. A stale `expectedRevision` with different
 *   content returns `conflict` with the server's food; nothing is overwritten.
 *
 * Recipes are explicitly later (not v1) and are not modelled here.
 */

export type CreateCustomFoodInput = CustomFoodInput & {
  /** Client-generated id (1–128 chars); a retry with the same id returns the same food. */
  clientMutationId?: string | null;
};

export type UpdateCustomFoodInput = {
  foodId: number;
  /** Revision the client last saw; `null`/omitted applies without a conflict check. */
  expectedRevision?: number | null;
  food: CustomFoodInput;
};

export type CustomFoodOutcome =
  | { outcome: "applied" | "unchanged"; food: CustomFood }
  /** The food changed (or was archived) since `expectedRevision`; `server` is its current state. */
  | { outcome: "conflict"; server: CustomFood };

const CONTENT_KEYS = [
  "name",
  "brand",
  "barcode",
  "nutrientBasisAmount",
  "nutrientBasisUnit",
  "servingSizeAmount",
  "servingSizeUnit",
  "servingLabel",
  ...NUTRIENT_KEYS,
] as const;

/** `null` and `0` compare as different values, so "unknown" never equals "zero". */
function sameContent(food: CustomFood, values: ReturnType<typeof customFoodValues>): boolean {
  return CONTENT_KEYS.every((key) => food[key] === values[key]);
}

function assertClientMutationId(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > 128)
    throw new NutritionError("INVALID_INPUT", "Client mutation id must be 1 to 128 characters");
  return value;
}

function assertFoodId(value: number): number {
  if (!Number.isInteger(value) || value < 1)
    throw new NutritionError("INVALID_INPUT", "Food id must be a positive integer");
  return value;
}

export function createCustomFoods(db: Database) {
  const own = (scope: NutritionScope, foodId: number) =>
    and(
      eq(nutritionFood.organizationId, scope.organizationId),
      eq(nutritionFood.userId, scope.userId),
      eq(nutritionFood.id, assertFoodId(foodId)),
    );

  async function setArchived(scope: NutritionScope, foodId: number, archived: boolean) {
    const where = own(scope, foodId);
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(nutritionFood).where(where).for("update");
      if (!current) throw new NutritionError("NOT_FOUND", "Custom food not found");
      if ((current.archivedAt !== null) === archived) return current;
      const now = new Date();
      const [row] = await tx
        .update(nutritionFood)
        .set({ archivedAt: archived ? now : null, updatedAt: now })
        .where(where)
        .returning();
      if (!row) throw new NutritionError("NOT_FOUND", "Custom food not found");
      return row;
    });
  }

  return {
    /** The member's foods by name; archived ones only when asked. */
    async list(
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

    /** One food (archived included, so a management screen can restore it). */
    async get(scope: NutritionScope, foodId: number): Promise<CustomFood | null> {
      const [row] = await db.select().from(nutritionFood).where(own(scope, foodId));
      return row ?? null;
    },

    /** Saves a private food; `created: false` when the mutation id was already applied. */
    async create(
      scope: NutritionScope,
      input: CreateCustomFoodInput,
    ): Promise<{ food: CustomFood; created: boolean }> {
      const clientMutationId = assertClientMutationId(input.clientMutationId);
      const values = customFoodValues(input);
      return db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(nutritionFood)
          .values({ ...scope, ...values, clientMutationId })
          .onConflictDoNothing()
          .returning();
        if (inserted) return { food: inserted, created: true };
        const [existing] = clientMutationId
          ? await tx
              .select()
              .from(nutritionFood)
              .where(
                and(
                  eq(nutritionFood.organizationId, scope.organizationId),
                  eq(nutritionFood.userId, scope.userId),
                  eq(nutritionFood.clientMutationId, clientMutationId),
                ),
              )
          : [];
        if (!existing) throw new Error("Custom food insert did not return a row");
        return { food: existing, created: false };
      });
    },

    /**
     * Replaces a food's content and bumps its revision. Archived foods are
     * not edited (restore first): the caller gets `conflict` with the server
     * state. Snapshots of earlier revisions are never touched.
     */
    async update(scope: NutritionScope, input: UpdateCustomFoodInput): Promise<CustomFoodOutcome> {
      const values = customFoodValues(input.food);
      const where = own(scope, input.foodId);
      return db.transaction(async (tx) => {
        const [current] = await tx.select().from(nutritionFood).where(where).for("update");
        if (!current) throw new NutritionError("NOT_FOUND", "Custom food not found");
        if (current.archivedAt !== null) return { outcome: "conflict", server: current };
        if (sameContent(current, values)) return { outcome: "unchanged", food: current };
        const expected = input.expectedRevision;
        if (expected !== undefined && expected !== null && expected !== current.revision)
          return { outcome: "conflict", server: current };
        const [row] = await tx
          .update(nutritionFood)
          .set({ ...values, revision: current.revision + 1, updatedAt: new Date() })
          .where(where)
          .returning();
        if (!row) throw new NutritionError("NOT_FOUND", "Custom food not found");
        return { outcome: "applied", food: row };
      });
    },

    /** Hides the food from new logging; logged entries keep their snapshots. Idempotent. */
    async archive(scope: NutritionScope, foodId: number): Promise<CustomFood> {
      return setArchived(scope, foodId, true);
    },

    /** Undo for `archive`. Idempotent. */
    async restore(scope: NutritionScope, foodId: number): Promise<CustomFood> {
      return setArchived(scope, foodId, false);
    },
  };
}

export type CustomFoods = ReturnType<typeof createCustomFoods>;
