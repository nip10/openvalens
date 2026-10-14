import { NutritionError } from "./errors";

/**
 * Core v1 nutrients (Issue #74). Keys match the Drizzle column properties on
 * `nutrition_food` / `nutrition_food_snapshot`; the unit is part of the name.
 *
 * Each value is `number | null`: `null` means the source did not provide the
 * nutrient, `0` means it reported zero. Nothing here converts one nutrient
 * into another (salt is not derived from sodium, energy kJ not from kcal, and
 * total sugars are independent of added/free sugars).
 */
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

export type NutrientValues = Record<NutrientKey, number | null>;

/** SQL column / goal identifier for each nutrient key. */
export const NUTRIENT_COLUMNS: Readonly<Record<NutrientKey, string>> = Object.freeze({
  energyKcal: "energy_kcal",
  energyKj: "energy_kj",
  proteinG: "protein_g",
  carbohydrateG: "carbohydrate_g",
  fatG: "fat_g",
  saturatedFatG: "saturated_fat_g",
  fiberG: "fiber_g",
  totalSugarsG: "total_sugars_g",
  addedSugarsG: "added_sugars_g",
  freeSugarsG: "free_sugars_g",
  sodiumMg: "sodium_mg",
  saltG: "salt_g",
});

export const NUTRIENT_UNITS: Readonly<Record<NutrientKey, "kcal" | "kJ" | "g" | "mg">> =
  Object.freeze({
    energyKcal: "kcal",
    energyKj: "kJ",
    proteinG: "g",
    carbohydrateG: "g",
    fatG: "g",
    saturatedFatG: "g",
    fiberG: "g",
    totalSugarsG: "g",
    addedSugarsG: "g",
    freeSugarsG: "g",
    sodiumMg: "mg",
    saltG: "g",
  });

/** Units a nutrient basis or a logged amount can use. */
export const AMOUNT_UNITS = ["g", "ml", "serving"] as const;
export type AmountUnit = (typeof AMOUNT_UNITS)[number];

/** Units of a serving's physical size. */
export const SERVING_SIZE_UNITS = ["g", "ml"] as const;
export type ServingSizeUnit = (typeof SERVING_SIZE_UNITS)[number];

/**
 * What the nutrient values are "per", plus an optional household serving.
 * Example: per 100 g, one serving = 30 g ("1 slice").
 */
export type NutrientBasis = {
  nutrientBasisAmount: number;
  nutrientBasisUnit: AmountUnit;
  servingSizeAmount: number | null;
  servingSizeUnit: ServingSizeUnit | null;
  servingLabel: string | null;
};

export function emptyNutrients(): NutrientValues {
  return Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, null])) as NutrientValues;
}

/**
 * Fills every key: a missing key becomes `null` (unknown), never `0`.
 * Rejects negative or non-finite values.
 */
export function normalizeNutrients(input: Partial<NutrientValues> | undefined): NutrientValues {
  const values = emptyNutrients();
  for (const key of NUTRIENT_KEYS) {
    const value = input?.[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      throw new NutritionError("INVALID_INPUT", `Nutrient ${key} must be a non-negative number`);
    values[key] = value;
  }
  return values;
}

/** Picks the nutrient values off a food or snapshot row. */
export function nutrientsOf(row: NutrientValues): NutrientValues {
  return Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, row[key]])) as NutrientValues;
}

/** Validates and normalizes a basis; throws `INVALID_INPUT`. */
export function normalizeBasis(input: {
  nutrientBasisAmount: number;
  nutrientBasisUnit: AmountUnit;
  servingSizeAmount?: number | null;
  servingSizeUnit?: ServingSizeUnit | null;
  servingLabel?: string | null;
}): NutrientBasis {
  if (!isPositive(input.nutrientBasisAmount))
    throw new NutritionError("INVALID_INPUT", "Nutrient basis amount must be positive");
  if (!AMOUNT_UNITS.includes(input.nutrientBasisUnit))
    throw new NutritionError("INVALID_INPUT", "Unsupported nutrient basis unit");
  const servingSizeAmount = input.servingSizeAmount ?? null;
  const servingSizeUnit = input.servingSizeUnit ?? null;
  if ((servingSizeAmount === null) !== (servingSizeUnit === null))
    throw new NutritionError("INVALID_INPUT", "Serving size needs both an amount and a unit");
  if (servingSizeAmount !== null && !isPositive(servingSizeAmount))
    throw new NutritionError("INVALID_INPUT", "Serving size amount must be positive");
  if (servingSizeUnit !== null && !SERVING_SIZE_UNITS.includes(servingSizeUnit))
    throw new NutritionError("INVALID_INPUT", "Unsupported serving size unit");
  const servingLabel = input.servingLabel?.trim() || null;
  return {
    nutrientBasisAmount: input.nutrientBasisAmount,
    nutrientBasisUnit: input.nutrientBasisUnit,
    servingSizeAmount,
    servingSizeUnit,
    servingLabel,
  };
}

/**
 * Multiplier that turns per-basis nutrient values into the values for
 * `amount` `unit`. Servings convert to g/ml only through the food's declared
 * serving size; g and ml never convert into each other (no density guess).
 * Throws `UNIT_INCOMPATIBLE` when no labeled conversion exists.
 */
export function computeNutrientFactor(
  basis: NutrientBasis,
  amount: number,
  unit: AmountUnit,
): number {
  if (!isPositive(amount))
    throw new NutritionError("INVALID_INPUT", "Logged amount must be positive");
  if (!AMOUNT_UNITS.includes(unit))
    throw new NutritionError("INVALID_INPUT", "Unsupported logged unit");
  const { nutrientBasisAmount, nutrientBasisUnit, servingSizeAmount, servingSizeUnit } = basis;

  if (unit === nutrientBasisUnit) return amount / nutrientBasisAmount;
  if (servingSizeAmount !== null && servingSizeUnit !== null) {
    // Logged in servings, values per g/ml of the same dimension.
    if (unit === "serving" && servingSizeUnit === nutrientBasisUnit)
      return (amount * servingSizeAmount) / nutrientBasisAmount;
    // Logged in g/ml, values per serving of that size.
    if (nutrientBasisUnit === "serving" && servingSizeUnit === unit)
      return amount / servingSizeAmount / nutrientBasisAmount;
  }
  throw new NutritionError(
    "UNIT_INCOMPATIBLE",
    "Logged unit cannot be converted to the food's nutrient basis",
  );
}

/** Scales known values; unknown (`null`) stays unknown and `0` stays `0`. */
export function scaleNutrients(values: NutrientValues, factor: number): NutrientValues {
  return Object.fromEntries(
    NUTRIENT_KEYS.map((key) => {
      const value = values[key];
      return [key, value === null ? null : value * factor];
    }),
  ) as NutrientValues;
}

function isPositive(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
