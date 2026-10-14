import { describe, expect, test } from "bun:test";

import { NutritionError } from "./errors";
import {
  NUTRIENT_KEYS,
  computeNutrientFactor,
  emptyNutrients,
  normalizeBasis,
  normalizeNutrients,
  scaleNutrients,
  type NutrientBasis,
} from "./nutrients";

const per100g: NutrientBasis = {
  nutrientBasisAmount: 100,
  nutrientBasisUnit: "g",
  servingSizeAmount: 30,
  servingSizeUnit: "g",
  servingLabel: "1 slice",
};

const perServing: NutrientBasis = {
  nutrientBasisAmount: 1,
  nutrientBasisUnit: "serving",
  servingSizeAmount: 250,
  servingSizeUnit: "ml",
  servingLabel: "1 cup",
};

function code(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    return error instanceof NutritionError ? error.code : "OTHER";
  }
  return "NONE";
}

describe("nutrient values", () => {
  test("missing keys are unknown (null), recorded zero stays zero", () => {
    const values = normalizeNutrients({ totalSugarsG: 0, proteinG: 3.5 });
    expect(values.totalSugarsG).toBe(0);
    expect(values.proteinG).toBe(3.5);
    expect(values.addedSugarsG).toBeNull();
    expect(values.fiberG).toBeNull();
    expect(Object.keys(values).sort()).toEqual([...NUTRIENT_KEYS].sort());
  });

  test("negative or non-finite values are rejected", () => {
    expect(code(() => normalizeNutrients({ fatG: -1 }))).toBe("INVALID_INPUT");
    expect(code(() => normalizeNutrients({ fatG: Number.NaN }))).toBe("INVALID_INPUT");
    expect(code(() => normalizeNutrients({ fatG: Number.POSITIVE_INFINITY }))).toBe(
      "INVALID_INPUT",
    );
  });

  test("salt and sodium, total and added sugars are independent", () => {
    const values = normalizeNutrients({ sodiumMg: 400, totalSugarsG: 12 });
    expect(values.saltG).toBeNull();
    expect(values.addedSugarsG).toBeNull();
    expect(values.freeSugarsG).toBeNull();
  });

  test("scaling keeps null as null and zero as zero", () => {
    const scaled = scaleNutrients({ ...emptyNutrients(), energyKcal: 250, fiberG: 0 }, 0.3);
    expect(scaled.energyKcal).toBeCloseTo(75);
    expect(scaled.fiberG).toBe(0);
    expect(scaled.saltG).toBeNull();
  });
});

describe("unit conversion", () => {
  test("same unit as the basis", () => {
    expect(computeNutrientFactor(per100g, 150, "g")).toBeCloseTo(1.5);
    expect(computeNutrientFactor(perServing, 2, "serving")).toBe(2);
  });

  test("servings convert through the declared serving size", () => {
    expect(computeNutrientFactor(per100g, 2, "serving")).toBeCloseTo(0.6);
    expect(computeNutrientFactor(perServing, 125, "ml")).toBeCloseTo(0.5);
  });

  test("g and ml never convert into each other", () => {
    expect(code(() => computeNutrientFactor(per100g, 100, "ml"))).toBe("UNIT_INCOMPATIBLE");
    expect(code(() => computeNutrientFactor(perServing, 100, "g"))).toBe("UNIT_INCOMPATIBLE");
  });

  test("servings need a serving size when values are per g/ml", () => {
    const noServing = { ...per100g, servingSizeAmount: null, servingSizeUnit: null };
    expect(code(() => computeNutrientFactor(noServing, 1, "serving"))).toBe("UNIT_INCOMPATIBLE");
  });

  test("amount must be positive", () => {
    expect(code(() => computeNutrientFactor(per100g, 0, "g"))).toBe("INVALID_INPUT");
    expect(code(() => computeNutrientFactor(per100g, -5, "g"))).toBe("INVALID_INPUT");
  });

  test("basis validation", () => {
    expect(code(() => normalizeBasis({ nutrientBasisAmount: 0, nutrientBasisUnit: "g" }))).toBe(
      "INVALID_INPUT",
    );
    expect(
      code(() =>
        normalizeBasis({ nutrientBasisAmount: 100, nutrientBasisUnit: "g", servingSizeAmount: 30 }),
      ),
    ).toBe("INVALID_INPUT");
    expect(
      normalizeBasis({ nutrientBasisAmount: 100, nutrientBasisUnit: "g", servingLabel: "  " }),
    ).toEqual({
      nutrientBasisAmount: 100,
      nutrientBasisUnit: "g",
      servingSizeAmount: null,
      servingSizeUnit: null,
      servingLabel: null,
    });
  });
});
