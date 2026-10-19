import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const zone = z.string().min(1).max(64);
const mutationId = z.string().min(1).max(64);
const quantity = z.number().finite().positive().max(9_999_999);
const waterUnit = z.enum(["ml", "l", "fl_oz"]);

export const plainWaterDayInput = z.strictObject({ date: day, timeZone: zone });
export const plainWaterPreferenceInput = z
  .strictObject({
    enabled: z.boolean().optional(),
    personalGoal: quantity.nullable().optional(),
    personalGoalUnit: waterUnit.optional(),
  })
  .refine(
    (value) =>
      (value.personalGoal === null && value.personalGoalUnit === undefined) ||
      (value.personalGoal === undefined
        ? value.personalGoalUnit === undefined
        : value.personalGoalUnit !== undefined),
    {
      message: "Goal quantity and unit must be supplied together",
    },
  )
  .refine((value) => value.enabled !== undefined || value.personalGoal !== undefined, {
    message: "At least one preference must be updated",
  });
export const plainWaterAddInput = z.strictObject({
  quantity,
  unit: waterUnit,
  observedAt: z.string().datetime({ offset: true }),
  timeZone: zone,
  clientMutationId: mutationId,
});
export const plainWaterChangeInput = z
  .strictObject({
    id: z.number().int().positive().safe(),
    clientMutationId: mutationId,
    expectedRevision: z.number().int().positive().safe(),
    quantity: quantity.optional(),
    unit: waterUnit.optional(),
    observedAt: z.string().datetime({ offset: true }).optional(),
    timeZone: zone.optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.quantity === undefined) !== (value.unit === undefined))
      ctx.addIssue({ code: "custom", message: "Quantity and unit must be supplied together" });
    if (
      value.quantity === undefined &&
      value.observedAt === undefined &&
      value.timeZone === undefined
    )
      ctx.addIssue({ code: "custom", message: "Change must include an edited value" });
  });
export const plainWaterDeleteInput = z.strictObject({
  id: z.number().int().positive().safe(),
  clientMutationId: mutationId,
  expectedRevision: z.number().int().positive().safe(),
});

const entry = z.object({
  id: z.number(),
  observedAt: z.string(),
  timeZone: z.string(),
  quantityMl: z.number().nullable(),
  revision: z.number(),
  deleted: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const plainWaterDay = z.object({
  date: day,
  timeZone: zone,
  label: z.literal("Plain water subtotal"),
  enabled: z.boolean(),
  quantityMl: z.number().nullable(),
  personalGoalMl: z.number().nullable(),
  entries: z.array(entry),
});
export const plainWaterMutationOutput = z.object({
  outcome: z.enum(["applied", "replayed", "conflict"]),
  entry,
  targetId: z.string(),
});
