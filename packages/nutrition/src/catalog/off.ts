import { emptyNutrients, type NutrientKey, type NutrientValues } from "../nutrients";
import type { CatalogRecordAdapter, OffProductRecord } from "./record";
import { asRecord, asText, gtinOrNull, nonNegativeNumber, roundTo12 } from "./parse-util";

/**
 * Open Food Facts adapter (Issue #72). Parses one product object from the OFF
 * JSONL dump or the OFF product API (same field names). Only the core
 * nutrients are mapped, from OFF's normalized `*_100g` values; product images
 * and every other field are ignored.
 *
 * The mapping is the only transformation: OFF reports sodium in grams, so it
 * is converted to milligrams. Nothing is derived (salt is not computed from
 * sodium here, kJ not from kcal). Values that are not finite non-negative
 * numbers are stored as unknown. Corrections never happen here; they belong
 * in the overlay table.
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
};

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
  };
}

export const offAdapter: CatalogRecordAdapter<OffProductRecord> = {
  source: "off",
  parse: parseOffProduct,
};
