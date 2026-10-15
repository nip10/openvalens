import { z } from "zod";

/**
 * `nutritionDiary.*` wire contract (Issue #77). Shared by the server router,
 * `apps/web` and `apps/native` (including the native offline outbox), so this
 * file imports only `zod`.
 *
 * Inputs are strict: unknown keys — including any `organizationId` or
 * `userId` — are rejected. Tenant and member always come from the session.
 * Nutrient values are `number | null`; `null` means "not provided", never 0.
 */

export const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack", "other"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const AMOUNT_UNITS = ["g", "ml", "serving"] as const;
export type AmountUnit = (typeof AMOUNT_UNITS)[number];

export const NUTRIENT_KEYS = [
  "energyKcal",
  "energyKj",
  "proteinG",
  "carbohydrateG",
  "fatG",
  "saturatedFatG",
  "fiberG",
  "totalSugarsG",
  "addedSugarsG",
  "freeSugarsG",
  "sodiumMg",
  "saltG",
] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const timeZone = z.string().min(1).max(64);
const clientMutationId = z.string().min(1).max(64);
const positive = z.number().finite().positive();
const id = z.number().int().positive();
const nutrientValue = z.number().finite().nonnegative().nullable();

export const nutrientValues = z.object(
  Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, nutrientValue])) as Record<
    NutrientKey,
    typeof nutrientValue
  >,
);
export type NutrientValues = z.infer<typeof nutrientValues>;

const partialNutrients = z
  .strictObject(
    Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, nutrientValue.optional()])) as Record<
      NutrientKey,
      z.ZodOptional<typeof nutrientValue>
    >,
  )
  .optional();

export const nutrientBasis = z.object({
  nutrientBasisAmount: z.number(),
  nutrientBasisUnit: z.enum(AMOUNT_UNITS),
  servingSizeAmount: z.number().nullable(),
  servingSizeUnit: z.enum(["g", "ml"]).nullable(),
  servingLabel: z.string().nullable(),
});
export type NutrientBasis = z.infer<typeof nutrientBasis>;

const foodSource = z.enum(["custom", "fdc", "off", "manual"]);

/**
 * A one-off food typed in by the member (quick add, or the manual draft
 * after a barcode miss). `barcode` keeps the scanned/typed code as
 * provenance only; every value is the member's own.
 */
export const manualFoodInput = z.strictObject({
  name: z.string().trim().min(1).max(200),
  brand: z.string().max(200).nullish(),
  barcode: z.string().max(32).nullish(),
  nutrientBasisAmount: positive,
  nutrientBasisUnit: z.enum(AMOUNT_UNITS),
  servingSizeAmount: positive.nullish(),
  servingSizeUnit: z.enum(["g", "ml"]).nullish(),
  servingLabel: z.string().max(100).nullish(),
  nutrients: partialNutrients,
});
export type ManualFoodInput = z.infer<typeof manualFoodInput>;

export const foodRef = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("snapshot"), snapshotId: id }),
  z.strictObject({ kind: z.literal("custom"), foodId: id }),
  /**
   * A food by `nutritionFoods` result id (`custom:42`, `fdc:123`,
   * `off:3017620422003`), resolved server-side (#69); nutrient values are
   * never taken from the client for these.
   */
  z.strictObject({ kind: z.literal("catalog"), id: z.string().min(5).max(40) }),
  z.strictObject({ kind: z.literal("manual"), food: manualFoodInput }),
]);
export type FoodRef = z.infer<typeof foodRef>;

export const logEntryInput = z.strictObject({
  clientMutationId,
  localDate,
  timeZone,
  slot: z.enum(MEAL_SLOTS),
  food: foodRef,
  amount: positive,
  unit: z.enum(AMOUNT_UNITS),
  method: z.enum(["manual", "search", "barcode", "quick_add"]),
});
export type LogEntryInput = z.infer<typeof logEntryInput>;

const entryChange = {
  clientMutationId,
  entryId: id,
  expectedRevision: z.number().int().min(1).nullish(),
};

export const updateEntryInput = z.strictObject({
  ...entryChange,
  amount: positive,
  unit: z.enum(AMOUNT_UNITS),
  slot: z.enum(MEAL_SLOTS).optional(),
});
export type UpdateEntryInput = z.infer<typeof updateEntryInput>;

export const entryChangeInput = z.strictObject(entryChange);
export type EntryChangeInput = z.infer<typeof entryChangeInput>;

export const setDayStatusInput = z.strictObject({
  clientMutationId: clientMutationId.optional(),
  localDate,
  complete: z.boolean(),
});
export type SetDayStatusInput = z.infer<typeof setDayStatusInput>;

export const copyDayInput = z.strictObject({
  clientMutationId,
  fromDate: localDate,
  toDate: localDate,
  timeZone,
  entryIds: z.array(id).min(1).max(200).optional(),
});
export type CopyDayInput = z.infer<typeof copyDayInput>;

export const getDayInput = z.strictObject({ localDate });

/** Inclusive local-date range; at most 92 days per call. */
export const getTotalsInput = z.strictObject({ from: localDate, to: localDate });
export type GetTotalsInput = z.infer<typeof getTotalsInput>;

export const setFavoriteInput = z.strictObject({ snapshotId: id, favorite: z.boolean() });

/**
 * Saves a reusable private food; with a `barcode`, later lookups of that code
 * find it. A retry with the same `clientMutationId` returns the same food (#81).
 */
export const createFoodInput = manualFoodInput.extend({
  clientMutationId: clientMutationId.optional(),
});

// ─── Outputs ──────────────────────────────────────────────────

export const diaryEntry = z.object({
  id: z.number(),
  localDate: z.string(),
  timeZone: z.string(),
  slot: z.enum(MEAL_SLOTS),
  amount: z.number(),
  unit: z.enum(AMOUNT_UNITS),
  method: z.string(),
  clientMutationId: z.string().nullable(),
  revision: z.number(),
  deleted: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  food: z.object({
    snapshotId: z.number(),
    source: foodSource,
    sourceQualifiedId: z.string().nullable(),
    sourceVersion: z.string().nullable(),
    attribution: z.string().nullable(),
    name: z.string(),
    brand: z.string().nullable(),
    basis: nutrientBasis,
    nutrientsPerBasis: nutrientValues,
  }),
  /** Values for this entry's amount; `null` = unknown. */
  nutrients: nutrientValues,
});
export type DiaryEntry = z.infer<typeof diaryEntry>;

export const dayStatus = z.enum(["unmarked", "complete"]);
export type DayStatus = z.infer<typeof dayStatus>;

/**
 * How many of a day's entries provided a nutrient (#79): `full` all,
 * `partial` some, `none` none, `no_entries` nothing logged that day.
 */
export const NUTRIENT_COVERAGE = ["full", "partial", "none", "no_entries"] as const;
export type NutrientCoverage = (typeof NUTRIENT_COVERAGE)[number];

export const nutrientTotal = z.object({
  /** Sum of the values entries provided; `null` when none did (never 0 for unknown). */
  known: z.number().nullable(),
  reported: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  coverage: z.enum(NUTRIENT_COVERAGE),
});
export type NutrientTotal = z.infer<typeof nutrientTotal>;

const foodSourceCounts = z.object({
  fdc: z.number().int().nonnegative(),
  off: z.number().int().nonnegative(),
  custom: z.number().int().nonnegative(),
  manual: z.number().int().nonnegative(),
});

/** Server-computed totals for a set of entries: values, coverage and provenance. */
export const nutrientSummary = z.object({
  entryCount: z.number().int().nonnegative(),
  totals: z.object(
    Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, nutrientTotal])) as Record<
      NutrientKey,
      typeof nutrientTotal
    >,
  ),
  /** Entries per food source; totals are estimates from these sources. */
  sources: foodSourceCounts,
});
export type NutrientSummary = z.infer<typeof nutrientSummary>;

export const diaryDay = z.object({
  localDate: z.string(),
  status: dayStatus,
  completedAt: z.string().nullable(),
  entries: z.array(diaryEntry),
  summary: nutrientSummary,
});
export type DiaryDay = z.infer<typeof diaryDay>;

/** One local day's totals; days with nothing logged are included with `entryCount: 0`. */
export const dailyTotals = nutrientSummary.extend({
  localDate: z.string(),
  status: dayStatus,
});
export type DailyTotals = z.infer<typeof dailyTotals>;

export const getTotalsOutput = z.object({ days: z.array(dailyTotals) });
export type GetTotalsOutput = z.infer<typeof getTotalsOutput>;

export const entryOutcome = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("applied"), entry: diaryEntry, targetId: z.string() }),
  z.object({ outcome: z.literal("replayed"), entry: diaryEntry, targetId: z.string() }),
  /** The server changed since the client's revision; nothing was written. */
  z.object({ outcome: z.literal("conflict"), server: diaryEntry, targetId: z.string() }),
]);
export type EntryOutcome = z.infer<typeof entryOutcome>;

export const logEntryOutput = z.object({
  entry: diaryEntry,
  created: z.boolean(),
  targetId: z.string(),
});
export type LogEntryOutput = z.infer<typeof logEntryOutput>;

export const setDayStatusOutput = z.object({
  localDate: z.string(),
  status: dayStatus,
  completedAt: z.string().nullable(),
  targetId: z.string(),
});

export const copyDayOutput = z.object({
  entries: z.array(diaryEntry),
  created: z.number(),
  targetId: z.string(),
});

export const foodChoice = z.object({
  ref: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("snapshot"), snapshotId: z.number() }),
    z.object({ kind: z.literal("custom"), foodId: z.number() }),
  ]),
  source: foodSource,
  sourceQualifiedId: z.string().nullable(),
  attribution: z.string().nullable(),
  name: z.string(),
  brand: z.string().nullable(),
  basis: nutrientBasis,
  nutrientsPerBasis: nutrientValues,
  lastLoggedAt: z.string().nullable(),
});
export type FoodChoice = z.infer<typeof foodChoice>;

export const diaryFoods = z.object({
  recents: z.array(foodChoice),
  favorites: z.array(foodChoice),
  customFoods: z.array(foodChoice),
});
export type DiaryFoods = z.infer<typeof diaryFoods>;
