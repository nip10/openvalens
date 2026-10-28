import { describe, expect, test } from "bun:test";

import { templateAmountValue, templateIngredientCoverage } from "./nutrition-templates";

const nutrients = (energyKcal: number | null, proteinG: number | null) => ({
  energyKcal,
  energyKj: null,
  proteinG,
  carbohydrateG: null,
  fatG: null,
  saturatedFatG: null,
  fiberG: null,
  totalSugarsG: null,
  addedSugarsG: null,
  freeSugarsG: null,
  sodiumMg: null,
  saltG: null,
});

describe("nutrition template presentation", () => {
  test("tracks energy and protein coverage independently", () => {
    expect(
      templateIngredientCoverage([
        { nutrients: nutrients(120, null) },
        { nutrients: nutrients(null, 4) },
        { nutrients: nutrients(null, null) },
      ]),
    ).toEqual({ energyKnown: 1, proteinKnown: 1, total: 3 });
  });

  test("does not convert hidden or unknown amounts into zero", () => {
    expect(templateAmountValue(null, false)).toBe("");
    expect(templateAmountValue(12, true)).toBe("");
    expect(templateAmountValue(0, false)).toBe("0");
  });
});
