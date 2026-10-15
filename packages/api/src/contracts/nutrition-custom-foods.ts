import { z } from "zod";

import { manualFoodInput, nutrientBasis, nutrientValues } from "./nutrition-diary";

/**
 * `nutritionCustomFoods.*` wire contract (Issue #81): managing a member's
 * private custom foods. Shared by the server router, `apps/web` and
 * `apps/native`, so this file imports only `zod` and sibling contracts.
 *
 * Inputs are strict: unknown keys — including any `organizationId`,
 * `userId` or owner field — are rejected. The owner always comes from the
 * session. Nutrient values are `number | null`; `null` means "not entered",
 * never 0. Recipes are explicitly later, not part of v1.
 */

const id = z.number().int().positive();
const clientMutationId = z.string().min(1).max(64);

export const listCustomFoodsInput = z
  .strictObject({ includeArchived: z.boolean().optional() })
  .optional();

export const customFoodIdInput = z.strictObject({ foodId: id });

/** The food's editable content: same shape as a quick-add food. */
export const customFoodContent = manualFoodInput;
export type CustomFoodContent = z.infer<typeof customFoodContent>;

export const createCustomFoodInput = z.strictObject({
  /** Reused on retry so a lost response cannot save the food twice. */
  clientMutationId,
  food: customFoodContent,
});
export type CreateCustomFoodInput = z.infer<typeof createCustomFoodInput>;

export const updateCustomFoodInput = z.strictObject({
  foodId: id,
  /** Revision the client edited; a different server revision returns `conflict`. */
  expectedRevision: z.number().int().min(1),
  food: customFoodContent,
});
export type UpdateCustomFoodInput = z.infer<typeof updateCustomFoodInput>;

// ─── Outputs ──────────────────────────────────────────────────

export const customFood = z.object({
  id: z.number(),
  /** `custom:<id>`, the id food search and `nutritionDiary.logEntry` accept. */
  sourceQualifiedId: z.string(),
  /** Always entered by the member; never from a catalog. */
  provenance: z.literal("user_entered"),
  name: z.string(),
  brand: z.string().nullable(),
  barcode: z.string().nullable(),
  basis: nutrientBasis,
  nutrientsPerBasis: nutrientValues,
  revision: z.number(),
  archived: z.boolean(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CustomFood = z.infer<typeof customFood>;

export const customFoodList = z.object({ foods: z.array(customFood) });
export type CustomFoodList = z.infer<typeof customFoodList>;

export const createCustomFoodOutput = z.object({
  food: customFood,
  /** `false` when `clientMutationId` was already applied (retry). */
  created: z.boolean(),
  targetId: z.string(),
});

export const customFoodOutcome = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("applied"), food: customFood, targetId: z.string() }),
  /** The server already holds this content (a retry or a no-op edit). */
  z.object({ outcome: z.literal("unchanged"), food: customFood, targetId: z.string() }),
  /** The food changed or was archived since the client's revision; nothing was written. */
  z.object({ outcome: z.literal("conflict"), server: customFood, targetId: z.string() }),
]);
export type CustomFoodOutcome = z.infer<typeof customFoodOutcome>;

export const customFoodChangeOutput = z.object({ food: customFood, targetId: z.string() });
