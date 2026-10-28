import { z } from "zod";

import { foodRef, nutrientSummary, nutrientValues, type FoodRef } from "./nutrition-diary";

const mutationId = z.string().min(1).max(128);
const id = z.number().int().positive();
const amount = z.number().finite().positive();
const unit = z.enum(["g", "ml", "serving"]);
const ingredient = z.strictObject({ food: foodRef, amount, unit });
const content = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("meal"),
    name: z.string().trim().min(1).max(200),
    ingredients: z.array(ingredient).min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal("recipe"),
    name: z.string().trim().min(1).max(200),
    yieldServings: amount,
    ingredients: z.array(ingredient).min(1).max(100),
  }),
]);
export const nutritionTemplateContent = content;

export const nutritionTemplateIngredient = z.strictObject({
  food: z.object({
    snapshotId: id,
    source: z.enum(["custom", "fdc", "off", "manual"]),
    sourceQualifiedId: z.string().nullable(),
    sourceVersion: z.string().nullable(),
    attribution: z.string().nullable(),
    name: z.string(),
    brand: z.string().nullable(),
    barcode: z.string().nullable(),
    basis: z.object({
      nutrientBasisAmount: z.number(),
      nutrientBasisUnit: unit,
      servingSizeAmount: z.number().nullable(),
      servingSizeUnit: z.enum(["g", "ml"]).nullable(),
      servingLabel: z.string().nullable(),
    }),
    nutrientsPerBasis: nutrientValues,
  }),
  amount,
  unit,
  nutrients: nutrientValues,
});
export const nutritionTemplate = z.discriminatedUnion("kind", [
  z.strictObject({
    id,
    revision: id,
    kind: z.literal("meal"),
    name: z.string(),
    yieldServings: z.null(),
    ingredients: z.array(nutritionTemplateIngredient),
    summary: nutrientSummary,
    archived: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  z.strictObject({
    id,
    revision: id,
    kind: z.literal("recipe"),
    name: z.string(),
    yieldServings: amount,
    ingredients: z.array(nutritionTemplateIngredient),
    summary: nutrientSummary,
    archived: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
]);
export type NutritionTemplate = z.infer<typeof nutritionTemplate>;
export type NutritionTemplateContent = z.infer<typeof content>;
export const listNutritionTemplatesOutput = z.object({ templates: z.array(nutritionTemplate) });
export const createNutritionTemplateInput = z.strictObject({
  clientMutationId: mutationId,
  content,
});
export const updateNutritionTemplateInput = z.strictObject({
  clientMutationId: mutationId,
  templateId: id,
  expectedRevision: id,
  content,
});
export const archiveNutritionTemplateInput = z.strictObject({
  clientMutationId: mutationId,
  templateId: id,
  expectedRevision: id,
});
export const nutritionTemplateOutcome = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.enum(["applied", "replayed"]),
    template: nutritionTemplate,
    targetId: z.string(),
  }),
  z.strictObject({
    outcome: z.literal("conflict"),
    server: nutritionTemplate,
    targetId: z.string(),
  }),
]);
export type NutritionTemplateOutcome = z.infer<typeof nutritionTemplateOutcome>;
export const logTemplateInput = z.strictObject({
  clientMutationId: mutationId,
  templateId: id,
  templateRevision: id,
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeZone: z.string().min(1).max(100),
  slot: z.enum(["breakfast", "lunch", "dinner", "snack", "other"]),
  servings: amount.optional(),
});
export type TemplateFoodRef = FoodRef;
