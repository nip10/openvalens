import { describe, expect, test } from "bun:test";

import { localDateRange, MAX_TOTALS_RANGE_DAYS } from "./daily-totals";
import {
  computeNutrientFactor,
  emptyNutrients,
  scaleNutrients,
  type NutrientValues,
} from "./nutrients";
import { nutrientCoverage, summarizeEntries, summarizeNutrients } from "./totals";

function values(input: Partial<NutrientValues>): NutrientValues {
  return { ...emptyNutrients(), ...input };
}

describe("summarizeNutrients", () => {
  test("sums known values only; unknown is counted as missing, never as 0", () => {
    const { entryCount, totals } = summarizeNutrients([
      { nutrients: values({ energyKcal: 200, proteinG: 10 }) },
      { nutrients: values({ energyKcal: 150 }) },
      { nutrients: values({}) },
    ]);
    expect(entryCount).toBe(3);
    expect(totals.energyKcal).toEqual({ known: 350, reported: 2, missing: 1, coverage: "partial" });
    expect(totals.proteinG).toEqual({ known: 10, reported: 1, missing: 2, coverage: "partial" });
    expect(totals.fiberG).toEqual({ known: null, reported: 0, missing: 3, coverage: "none" });
  });

  test("a recorded zero is reported data, distinct from unknown", () => {
    const { totals } = summarizeNutrients([
      { nutrients: values({ addedSugarsG: 0 }) },
      { nutrients: values({ addedSugarsG: 0 }) },
    ]);
    expect(totals.addedSugarsG).toEqual({ known: 0, reported: 2, missing: 0, coverage: "full" });
    expect(totals.freeSugarsG).toEqual({ known: null, reported: 0, missing: 2, coverage: "none" });
  });

  test("no entries means not logged: no totals rather than zero totals", () => {
    const { entryCount, totals } = summarizeNutrients([]);
    expect(entryCount).toBe(0);
    for (const total of Object.values(totals))
      expect(total).toEqual({ known: null, reported: 0, missing: 0, coverage: "no_entries" });
  });

  test("never derives salt from sodium, kJ from kcal or sugar types from each other", () => {
    const { totals } = summarizeNutrients([
      { nutrients: values({ sodiumMg: 400, energyKcal: 100, totalSugarsG: 12 }) },
      { nutrients: values({ saltG: 1.5, addedSugarsG: 3 }) },
    ]);
    expect(totals.sodiumMg).toMatchObject({ known: 400, reported: 1, missing: 1 });
    expect(totals.saltG).toMatchObject({ known: 1.5, reported: 1, missing: 1 });
    expect(totals.energyKj).toMatchObject({ known: null, coverage: "none" });
    expect(totals.totalSugarsG).toMatchObject({ known: 12, reported: 1, missing: 1 });
    expect(totals.addedSugarsG).toMatchObject({ known: 3, reported: 1, missing: 1 });
    expect(totals.freeSugarsG).toMatchObject({ known: null, coverage: "none" });
  });

  test("portions in different units scale through the stored factor before summing", () => {
    const basis = {
      nutrientBasisAmount: 100,
      nutrientBasisUnit: "g" as const,
      servingSizeAmount: 30,
      servingSizeUnit: "g" as const,
      servingLabel: "1 slice",
    };
    const per100g = values({ energyKcal: 250, fiberG: null });
    const grams = scaleNutrients(per100g, computeNutrientFactor(basis, 50, "g"));
    const slices = scaleNutrients(per100g, computeNutrientFactor(basis, 2, "serving"));
    const { totals } = summarizeNutrients([{ nutrients: grams }, { nutrients: slices }]);
    // 50 g = 125 kcal; 2 × 30 g = 150 kcal.
    expect(totals.energyKcal.known).toBeCloseTo(275);
    expect(totals.fiberG).toMatchObject({ known: null, missing: 2 });
  });
});

describe("summarizeEntries", () => {
  test("counts entries per food source for provenance", () => {
    const summary = summarizeEntries([
      { nutrients: values({ energyKcal: 1 }), source: "fdc" },
      { nutrients: values({ energyKcal: 1 }), source: "fdc" },
      { nutrients: values({}), source: "manual" },
    ]);
    expect(summary.sources).toEqual({ fdc: 2, off: 0, custom: 0, manual: 1 });
    expect(summary.entryCount).toBe(3);
  });
});

describe("nutrientCoverage", () => {
  test("classifies every case", () => {
    expect(nutrientCoverage(0, 0)).toBe("no_entries");
    expect(nutrientCoverage(2, 0)).toBe("full");
    expect(nutrientCoverage(1, 1)).toBe("partial");
    expect(nutrientCoverage(0, 3)).toBe("none");
  });
});

describe("localDateRange", () => {
  test("lists every calendar day inclusive, across month and leap-day boundaries", () => {
    expect(localDateRange("2028-02-27", "2028-03-01")).toEqual([
      "2028-02-27",
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
    expect(localDateRange("2026-12-31", "2027-01-01")).toEqual(["2026-12-31", "2027-01-01"]);
    expect(localDateRange("2026-10-12", "2026-10-12")).toEqual(["2026-10-12"]);
  });

  test("is plain calendar arithmetic, unaffected by daylight-saving changes", () => {
    // Europe/Lisbon and America/New_York change clocks in these windows.
    expect(localDateRange("2026-10-24", "2026-10-26")).toHaveLength(3);
    expect(localDateRange("2026-03-07", "2026-03-09")).toHaveLength(3);
  });

  test("rejects invalid dates, reversed ranges and ranges that are too long", () => {
    expect(() => localDateRange("2026-02-30", "2026-03-01")).toThrow(/calendar date/);
    expect(() => localDateRange("2026-10-13", "2026-10-12")).toThrow(/end before/);
    const start = "2026-01-01";
    const last = new Date(Date.UTC(2026, 0, MAX_TOTALS_RANGE_DAYS)).toISOString().slice(0, 10);
    expect(localDateRange(start, last)).toHaveLength(MAX_TOTALS_RANGE_DAYS);
    const tooFar = new Date(Date.UTC(2026, 0, MAX_TOTALS_RANGE_DAYS + 1))
      .toISOString()
      .slice(0, 10);
    expect(() => localDateRange(start, tooFar)).toThrow(/at most/);
  });
});
