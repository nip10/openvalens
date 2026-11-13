import {
  emptyMicronutrients,
  type MicronutrientKey,
  type MicronutrientValues,
} from "../micronutrients";
import { emptyNutrients, type NutrientKey, type NutrientValues } from "../nutrients";
import type { CatalogRecordAdapter, OffProductRecord } from "./record";
import { asRecord, asText, gtinOrNull, nonNegativeNumber, roundTo12 } from "./parse-util";

/**
 * Open Food Facts adapter (Issue #72). Parses one product object from the OFF
 * JSONL dump or the OFF product API (same field names). Only the core
 * nutrients are mapped, from OFF's normalized `*_100g` values; product images
 * and every other field are ignored.
 *
 * The mapping is the only transformation: OFF stores mass nutrients in grams,
 * so sodium and caffeine are converted to milligrams. Alcohol is the one
 * nutrient OFF stores as a percentage (`alcohol_100g` is % vol); it is
 * converted to grams by `offAlcoholGrams`. Nothing is derived (salt is not
 * computed from sodium here, kJ not from kcal). Values that are not finite
 * non-negative numbers are stored as unknown. Corrections never happen here;
 * they belong in the overlay table.
 */

const OFF_NUTRIENTS: Readonly<Partial<Record<NutrientKey, { key: string; gToMg?: true }>>> = {
  energyKcal: { key: "energy-kcal_100g" },
  energyKj: { key: "energy-kj_100g" },
  proteinG: { key: "proteins_100g" },
  carbohydrateG: { key: "carbohydrates_100g" },
  fatG: { key: "fat_100g" },
  saturatedFatG: { key: "saturated-fat_100g" },
  fiberG: { key: "fiber_100g" },
  totalSugarsG: { key: "sugars_100g" },
  addedSugarsG: { key: "added-sugars_100g" },
  sodiumMg: { key: "sodium_100g", gToMg: true },
  saltG: { key: "salt_100g" },
  // #443: OFF shows caffeine in mg but stores `caffeine_100g` in g (an energy
  // drink at 32 mg per 100 ml has `caffeine_100g: 0.032`).
  caffeineMg: { key: "caffeine_100g", gToMg: true },
};

/** Density of ethanol in g/ml, used to turn % vol into grams (#443). */
export const ETHANOL_DENSITY_G_PER_ML = 0.789;

/**
 * Alcohol in grams per 100 ml from OFF's `alcohol_100g`, which holds the
 * alcohol by volume (% vol = ml of ethanol in 100 ml of drink), not grams:
 *
 *   alcohol g per 100 ml = % vol × 0.789 g/ml
 *
 * so a 5 % vol beer has 3.945 g per 100 ml. The result is per 100 ml, so it
 * is kept only when the product's values are per 100 ml. A product with
 * values per 100 g would need the drink's own density, which is never
 * guessed, so its alcohol stays unknown.
 */
export function offAlcoholGrams(raw: unknown, basisUnit: "g" | "ml"): number | null {
  const percent = nonNegativeNumber(raw);
  if (percent === null || percent > 100 || basisUnit !== "ml") return null;
  return roundTo12(percent * ETHANOL_DENSITY_G_PER_ML);
}

/** Micronutrients (#78): OFF's `*_100g` values are in grams, scaled to the column unit. */
const OFF_MICRONUTRIENTS: Readonly<Record<MicronutrientKey, { key: string; factor: number }>> = {
  calciumMg: { key: "calcium_100g", factor: 1e3 },
  ironMg: { key: "iron_100g", factor: 1e3 },
  magnesiumMg: { key: "magnesium_100g", factor: 1e3 },
  potassiumMg: { key: "potassium_100g", factor: 1e3 },
  zincMg: { key: "zinc_100g", factor: 1e3 },
  vitaminCMg: { key: "vitamin-c_100g", factor: 1e3 },
  vitaminDUg: { key: "vitamin-d_100g", factor: 1e6 },
  vitaminB12Ug: { key: "vitamin-b12_100g", factor: 1e6 },
};

function offMicronutrients(raw: unknown): MicronutrientValues {
  const nutriments = asRecord(raw);
  const values = emptyMicronutrients();
  if (!nutriments) return values;
  for (const [key, spec] of Object.entries(OFF_MICRONUTRIENTS) as [
    MicronutrientKey,
    { key: string; factor: number },
  ][]) {
    const value = nonNegativeNumber(nutriments[spec.key]);
    if (value !== null) values[key] = roundTo12(value * spec.factor);
  }
  return values;
}

function offNutrients(raw: unknown): NutrientValues {
  const nutriments = asRecord(raw);
  const values = emptyNutrients();
  if (!nutriments) return values;
  for (const [key, spec] of Object.entries(OFF_NUTRIENTS) as [
    NutrientKey,
    { key: string; gToMg?: true },
  ][]) {
    const value = nonNegativeNumber(nutriments[spec.key]);
    if (value !== null) values[key] = spec.gToMg ? roundTo12(value * 1000) : value;
  }
  return values;
}

function offUnit(raw: unknown): "g" | "ml" | null {
  const unit = asText(raw)?.toLowerCase();
  return unit === "g" || unit === "ml" ? unit : null;
}

export function parseOffProduct(raw: unknown): OffProductRecord | null {
  const product = asRecord(raw);
  if (!product) return null;
  const code = asText(product.code);
  const modified = nonNegativeNumber(product.last_modified_t);
  if (code === null || !/^[0-9]{1,24}$/.test(code) || modified === null) return null;

  // OFF's `_100g` values are per 100 ml for products sold by volume.
  const basisUnit = offUnit(product.product_quantity_unit) === "ml" ? "ml" : "g";
  const servingAmount = nonNegativeNumber(product.serving_quantity);
  const servingUnit = offUnit(product.serving_quantity_unit) ?? basisUnit;
  const hasServing = servingAmount !== null && servingAmount > 0;

  return {
    source: "off",
    code,
    lastModifiedAt: new Date(Math.trunc(modified) * 1000),
    name: asText(product.product_name),
    brand: asText(product.brands),
    barcode: gtinOrNull(code),
    nutrientBasisAmount: 100,
    nutrientBasisUnit: basisUnit,
    servingSizeAmount: hasServing ? servingAmount : null,
    servingSizeUnit: hasServing ? servingUnit : null,
    servingLabel: asText(product.serving_size),
    ...offNutrients(product.nutriments),
    alcoholG: offAlcoholGrams(asRecord(product.nutriments)?.alcohol_100g, basisUnit),
    ...offMicronutrients(product.nutriments),
  };
}

export const offAdapter: CatalogRecordAdapter<OffProductRecord> = {
  source: "off",
  // 2: caffeine and alcohol (% vol to g), #443.
  version: 2,
  parse: parseOffProduct,
};
