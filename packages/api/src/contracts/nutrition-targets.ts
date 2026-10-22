import { z } from "zod";

import { NUTRIENT_KEYS } from "./nutrition-diary";

/**
 * `nutritionTargets.*` wire contract (Issue #80). Imports only `zod` (and the
 * zod-only diary contract) so web and native can share it.
 *
 * Targets are user-owned: they are entered by the member or accepted from a
 * #76 proposal, never set by the system alone. Each target says where it came
 * from and the local dates it applies between. Settings hold hide-numbers
 * mode, the suggestion direction (maintain by default), the active opt-in for
 * the protein reference, a self-declared height and self-declared yes/no
 * declarations. Inputs are strict: no organization or user ids, ever.
 */

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Mirrors `NUTRITION_DECLARATIONS` in `@openvalens/nutrition` (a test keeps them aligned). */
export const DECLARATIONS = [
  "pregnant_or_breastfeeding",
  "eating_disorder",
  "glucose_lowering_medication",
  "chronic_kidney_disease",
  "cancer_treatment",
  "bariatric_surgery",
  "refeeding_syndrome",
  "glp1_medication",
] as const;
export type Declaration = (typeof DECLARATIONS)[number];

export const ENERGY_DIRECTIONS = ["maintain", "lose", "gain"] as const;
export type EnergyDirection = (typeof ENERGY_DIRECTIONS)[number];

export const TARGET_SOURCES = ["entered", "proposal"] as const;
export type TargetSource = (typeof TARGET_SOURCES)[number];

/** Upper bound on any entered target value; keeps typos out, not a recommendation. */
export const MAX_TARGET_AMOUNT = 100_000;
const amount = z.number().finite().nonnegative().max(MAX_TARGET_AMOUNT);

export const nutrientKey = z.enum(NUTRIENT_KEYS);

export const nutritionTarget = z.object({
  id: z.number().int(),
  nutrient: nutrientKey,
  minAmount: z.number().nullable(),
  maxAmount: z.number().nullable(),
  source: z.enum(TARGET_SOURCES),
  effectiveFrom: localDate,
  /** Exclusive end; `null` while the target applies. */
  effectiveTo: localDate.nullable(),
});
export type NutritionTargetWire = z.infer<typeof nutritionTarget>;

export const targetSettings = z.object({
  revision: z.number().int().nonnegative(),
  hideNumbers: z.boolean(),
  energyDirection: z.enum(ENERGY_DIRECTIONS),
  activeProtein: z.boolean(),
  streaksEnabled: z.boolean(),
  recipeImportEnabled: z.boolean(),
  heightCm: z.number().nullable(),
  declarations: z.array(z.enum(DECLARATIONS)),
});
export type TargetSettingsWire = z.infer<typeof targetSettings>;

export const nutritionSafety = z.object({
  policyVersion: z.string(),
  energyTargets: z.enum(["available", "off"]),
  energySuggestions: z.enum(["available", "off"]),
  reductionSuggestions: z.enum(["available", "off"]),
  softGates: z.array(z.enum(["older_adult", "glp1_medication"])),
  /** Streak surfaces (#90) must stay hidden when this is `hidden`. */
  streaks: z.enum(["available", "hidden"]),
  proteinCapped: z.boolean(),
});
export type NutritionSafetyWire = z.infer<typeof nutritionSafety>;

export const helpline = z.object({
  name: z.string(),
  phone: z.string().nullable(),
  detail: z.string().nullable(),
  url: z.string(),
  verifiedAt: z.string().nullable(),
});
export type HelplineWire = z.infer<typeof helpline>;

export const proteinReference = z.object({
  minGPerKg: z.number(),
  maxGPerKg: z.number(),
  minG: z.number(),
  maxG: z.number(),
  basis: z.enum(["default", "active", "older_adult", "kidney_cap"]),
});

/** Shown right after an eating-disorder declaration, and on the settings screen while it stands. */
export const disclosure = z.object({ text: z.string(), helplines: z.array(helpline) });

export const targetsOverviewInput = z.strictObject({ localDate });
export const targetsOverviewOutput = z.object({
  settings: targetSettings,
  safety: nutritionSafety,
  /** Active targets. Energy targets are left out while energy targets are off. */
  targets: z.array(nutritionTarget),
  /** The targets that applied on `localDate`, for the diary day view. */
  targetsOn: z.object({ localDate, targets: z.array(nutritionTarget) }),
  /** A reference range, never a target until the member enters one. */
  proteinReference: proteinReference.nullable(),
  /** Present while an eating-disorder declaration stands. */
  support: disclosure.nullable(),
  notes: z.array(z.string()),
});
export type TargetsOverview = z.infer<typeof targetsOverviewOutput>;

export const setTargetInput = z
  .strictObject({
    nutrient: nutrientKey,
    minAmount: amount.nullable().optional(),
    maxAmount: amount.nullable().optional(),
    effectiveFrom: localDate,
  })
  .refine((input) => (input.minAmount ?? null) !== null || (input.maxAmount ?? null) !== null, {
    message: "Enter a minimum, a maximum or both",
  })
  .refine(
    (input) =>
      input.minAmount === null ||
      input.minAmount === undefined ||
      input.maxAmount === null ||
      input.maxAmount === undefined ||
      input.minAmount <= input.maxAmount,
    { message: "The minimum must not be more than the maximum" },
  );
/** `targetId` is the audit target (the nutrient key or `settings`), never a value. */
export const setTargetOutput = z.object({ target: nutritionTarget, targetId: z.string() });

export const clearTargetInput = z.strictObject({ nutrient: nutrientKey, effectiveTo: localDate });
export const clearTargetOutput = z.object({ cleared: z.boolean(), targetId: z.string() });

export const updateSettingsInput = z.strictObject({
  expectedRevision: z.int().nonnegative(),
  hideNumbers: z.boolean().optional(),
  energyDirection: z.enum(ENERGY_DIRECTIONS).optional(),
  activeProtein: z.boolean().optional(),
  streaksEnabled: z.boolean().optional(),
  recipeImportEnabled: z.boolean().optional(),
  heightCm: z.number().finite().min(100).max(250).nullable().optional(),
  declarations: z.array(z.enum(DECLARATIONS)).max(DECLARATIONS.length).optional(),
  /** Removing an eating-disorder answer needs this deliberate confirmation. */
  confirmClearEatingDisorder: z.literal(true).optional(),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsInput>;

export const updateSettingsOutput = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("updated"),
    settings: targetSettings,
    safety: nutritionSafety,
    /** Set only when this update newly recorded an eating-disorder declaration. */
    disclosure: disclosure.nullable(),
    targetId: z.string(),
  }),
  z.object({ outcome: z.literal("conflict"), settings: targetSettings, targetId: z.string() }),
  z.object({
    outcome: z.literal("confirmation_required"),
    settings: targetSettings,
    note: z.string(),
    targetId: z.string(),
  }),
]);
export type UpdateSettingsOutput = z.infer<typeof updateSettingsOutput>;

/** Issue #90 — the logging streak. Today is the member's local day in `timeZone`. */
export const loggingStreakInput = z.strictObject({ timeZone: z.string().min(1).max(64) });
export const loggingStreakOutput = z.discriminatedUnion("state", [
  /** Hide-numbers mode, any exclusion, or no adult confirmation: render nothing. */
  z.object({ state: z.literal("hidden") }),
  /** Available but not turned on. */
  z.object({ state: z.literal("off") }),
  z.object({
    state: z.literal("on"),
    current: z.number().int().nonnegative(),
    freezesAvailable: z.number().int().nonnegative(),
    /** Last local day on which logging the missed day repairs the streak. */
    repairAvailableUntil: localDate.nullable(),
    daysLoggedThisMonth: z.number().int().nonnegative(),
    lastLoggedDate: localDate.nullable(),
    milestone: z.number().int().positive().nullable(),
  }),
]);
export type LoggingStreakOutput = z.infer<typeof loggingStreakOutput>;
