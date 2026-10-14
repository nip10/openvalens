import { emptyNutrients, type NutrientKey, type NutrientValues } from "../nutrients";
import type { CatalogRecordAdapter, FdcFoodRecord } from "./record";
import { asRecord, asText, gtinOrNull, nonNegativeNumber, scaleUnit } from "./parse-util";

/**
 * USDA FoodData Central adapter (Issue #72). Parses one food object from the
 * FDC download JSON (`FoundationFoods[]`, `SRLegacyFoods[]`,
 * `BrandedFoods[]`, `SurveyFoods[]`) or the FDC API "full" format. FDC
 * reports `foodNutrients` per 100 g (per 100 ml for branded liquids).
 *
 * Nutrients are matched by FDC nutrient number and only converted between
 * mass units (µg/mg/g); nothing is derived from another nutrient. FDC has no
 * salt or free-sugars values, so those stay unknown.
 */

type NutrientSpec = { numbers: readonly string[]; unit: "kcal" | "kj" | "g" | "mg" };

const FDC_NUTRIENTS: Readonly<Partial<Record<NutrientKey, NutrientSpec>>> = {
  // 957 = Energy (Atwater General Factors), used only when 208 is absent.
  energyKcal: { numbers: ["208", "957"], unit: "kcal" },
  energyKj: { numbers: ["268"], unit: "kj" },
  proteinG: { numbers: ["203"], unit: "g" },
  carbohydrateG: { numbers: ["205"], unit: "g" },
  fatG: { numbers: ["204"], unit: "g" },
  saturatedFatG: { numbers: ["606"], unit: "g" },
  fiberG: { numbers: ["291"], unit: "g" },
  totalSugarsG: { numbers: ["269", "269.3"], unit: "g" },
  addedSugarsG: { numbers: ["539"], unit: "g" },
  sodiumMg: { numbers: ["307"], unit: "mg" },
};

/** `{ number -> { amount, unit } }` from either FDC nutrient shape. */
function nutrientTable(raw: unknown): Map<string, { amount: number; unit: string }> {
  const table = new Map<string, { amount: number; unit: string }>();
  if (!Array.isArray(raw)) return table;
  for (const item of raw) {
    const row = asRecord(item);
    if (!row) continue;
    const nutrient = asRecord(row.nutrient);
    const number = asText(nutrient?.number ?? row.nutrientNumber ?? row.number);
    const unit = asText(nutrient?.unitName ?? row.unitName);
    const amount = nonNegativeNumber(row.amount ?? row.value);
    if (number === null || unit === null || amount === null || table.has(number)) continue;
    table.set(number, { amount, unit: unit.toLowerCase() });
  }
  return table;
}

function fdcNutrients(raw: unknown): NutrientValues {
  const table = nutrientTable(raw);
  const values = emptyNutrients();
  for (const [key, spec] of Object.entries(FDC_NUTRIENTS) as [NutrientKey, NutrientSpec][]) {
    for (const number of spec.numbers) {
      const found = table.get(number);
      if (!found) continue;
      const value =
        spec.unit === "kcal" || spec.unit === "kj"
          ? found.unit === spec.unit
            ? found.amount
            : null
          : scaleUnit(found.amount, found.unit, spec.unit);
      if (value !== null) {
        values[key] = value;
        break;
      }
    }
  }
  return values;
}

/** FDC serving units: `g`/`GRM` and `ml`/`MLT`; anything else is not a physical size. */
function fdcUnit(raw: unknown): "g" | "ml" | null {
  const unit = asText(raw)?.toLowerCase();
  if (unit === "g" || unit === "grm") return "g";
  if (unit === "ml" || unit === "mlt") return "ml";
  return null;
}

export function parseFdcFood(raw: unknown): FdcFoodRecord | null {
  const food = asRecord(raw);
  if (!food) return null;
  const fdcId = asText(food.fdcId);
  const name = asText(food.description);
  const dataType = asText(food.dataType);
  if (fdcId === null || !/^[0-9]{1,12}$/.test(fdcId) || name === null || dataType === null)
    return null;

  const servingUnit = fdcUnit(food.servingSizeUnit);
  const servingAmount = servingUnit ? nonNegativeNumber(food.servingSize) : null;
  const hasServing = servingUnit !== null && servingAmount !== null && servingAmount > 0;

  return {
    source: "fdc",
    fdcId,
    dataType,
    name,
    brand: asText(food.brandName) ?? asText(food.brandOwner),
    barcode: gtinOrNull(food.gtinUpc),
    nutrientBasisAmount: 100,
    nutrientBasisUnit: servingUnit === "ml" ? "ml" : "g",
    servingSizeAmount: hasServing ? servingAmount : null,
    servingSizeUnit: hasServing ? servingUnit : null,
    servingLabel: asText(food.householdServingFullText),
    ...fdcNutrients(food.foodNutrients),
  };
}

export const fdcAdapter: CatalogRecordAdapter<FdcFoodRecord> = {
  source: "fdc",
  parse: parseFdcFood,
};
