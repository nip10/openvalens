import { describe, expect, test } from "bun:test";

import { catalogAttribution } from "./catalog/repository";
import { foodResultToLogFood, isVariableMeasureBarcode, type FoodResult } from "./food-search";
import { emptyMicronutrients } from "./micronutrients";
import { emptyNutrients } from "./nutrients";

const basis = {
  nutrientBasisAmount: 100,
  nutrientBasisUnit: "g" as const,
  servingSizeAmount: 40,
  servingSizeUnit: "g" as const,
  servingLabel: "1 bar",
};

const food = (overrides: Partial<FoodResult>): FoodResult => ({
  id: "off:4006381333931",
  source: "off",
  sourceFoodId: "4006381333931",
  sourceVersion: "2026-05-01T00:00:00.000Z",
  origin: "live",
  dataType: null,
  name: "Synthetic oat bar",
  brand: null,
  barcode: "4006381333931",
  basis,
  nutrients: { ...emptyNutrients(), energyKcal: 400 },
  micronutrients: emptyMicronutrients(),
  attribution: catalogAttribution("off"),
  release: null,
  overlay: null,
  ...overrides,
});

describe("isVariableMeasureBarcode (Issue #69)", () => {
  test("flags GS1 restricted-circulation store/variable-measure codes", () => {
    for (const code of ["2012345678901", "2912345678906", "0212345678904", "212345678900"])
      expect(isVariableMeasureBarcode(code)).toBe(true);
  });

  test("leaves ordinary GTIN/EAN/UPC codes alone, including UPC-E", () => {
    for (const code of ["4006381333931", "3017620422003", "012345678905", "01234565", "20012345"])
      expect(isVariableMeasureBarcode(code)).toBe(false);
  });
});

describe("foodResultToLogFood (Issue #69 → #77)", () => {
  test("custom foods are logged by id so the server snapshots its own row", () => {
    expect(
      foodResultToLogFood(
        food({ id: "custom:7", source: "custom", sourceFoodId: "7", attribution: null }),
      ),
    ).toEqual({ kind: "custom", foodId: 7 });
  });

  test("live results keep source, version, attribution and unknown nutrients", () => {
    const logged = foodResultToLogFood(food({}));
    expect(logged).toMatchObject({
      kind: "external",
      snapshot: {
        source: "off",
        sourceFoodId: "4006381333931",
        sourceVersion: "2026-05-01T00:00:00.000Z",
        attribution: catalogAttribution("off").notice,
        nutrientBasisAmount: 100,
        servingLabel: "1 bar",
      },
    });
    const snapshot = logged.kind === "external" ? logged.snapshot : null;
    expect(snapshot?.nutrients?.energyKcal).toBe(400);
    expect(snapshot?.nutrients?.proteinG).toBeNull();
  });

  test("a nameless product cannot be logged directly (manual draft instead)", () => {
    expect(() => foodResultToLogFood(food({ name: null }))).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });
});
