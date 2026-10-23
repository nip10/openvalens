import { NutritionError } from "./errors";

/**
 * Optional micronutrients (Issue #78). Keys match the Drizzle column
 * properties on foods, snapshots and catalog mirrors; the unit is part of
 * the name. Like the core nutrients, `null` means the source did not report
 * the value and `0` means it reported zero. They are stored separately so
 * the core diary totals never change shape.
 *
 * The set is deliberately small: nutrients with an adult reference in both
 * EFSA and NASEM, a stable unit, and values in both FDC and Open Food Facts.
 */
export const MICRONUTRIENT_KEYS = [
  "calciumMg",
  "ironMg",
  "magnesiumMg",
  "potassiumMg",
  "zincMg",
  "vitaminCMg",
  "vitaminDUg",
  "vitaminB12Ug",
] as const;

export type MicronutrientKey = (typeof MICRONUTRIENT_KEYS)[number];
export type MicronutrientValues = Record<MicronutrientKey, number | null>;

export const MICRONUTRIENT_UNITS: Readonly<Record<MicronutrientKey, "mg" | "µg">> = Object.freeze({
  calciumMg: "mg",
  ironMg: "mg",
  magnesiumMg: "mg",
  potassiumMg: "mg",
  zincMg: "mg",
  vitaminCMg: "mg",
  vitaminDUg: "µg",
  vitaminB12Ug: "µg",
});

export function emptyMicronutrients(): MicronutrientValues {
  return Object.fromEntries(MICRONUTRIENT_KEYS.map((key) => [key, null])) as MicronutrientValues;
}

/** Picks the micronutrient values off a food, snapshot or catalog row. */
export function micronutrientsOf(row: MicronutrientValues): MicronutrientValues {
  return Object.fromEntries(
    MICRONUTRIENT_KEYS.map((key) => [key, row[key] ?? null]),
  ) as MicronutrientValues;
}

/** A missing key becomes `null` (unknown), never `0`. Rejects negative or non-finite values. */
export function normalizeMicronutrients(
  input: Partial<MicronutrientValues> | undefined,
): MicronutrientValues {
  const values = emptyMicronutrients();
  for (const key of MICRONUTRIENT_KEYS) {
    const value = input?.[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      throw new NutritionError("INVALID_INPUT", `Nutrient ${key} must be a non-negative number`);
    values[key] = value;
  }
  return values;
}

export function hasAnyMicronutrient(values: MicronutrientValues): boolean {
  return MICRONUTRIENT_KEYS.some((key) => values[key] !== null);
}
