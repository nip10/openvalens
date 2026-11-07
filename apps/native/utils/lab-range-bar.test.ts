import { describe, expect, test } from "bun:test";

import { labRangeBar } from "./lab-range-bar";

const between = (low: string, high: string, unit = "ng/mL") =>
  ({ kind: "between", low, high, unit, converted: false }) as const;

describe("labRangeBar", () => {
  test("a two-bound range gets half its width on each side, never below zero", () => {
    expect(labRangeBar(65, "ng/mL", between("30", "100"))).toEqual({
      bandStart: 100 * (30 / 135),
      bandEnd: 100 * (100 / 135),
      marker: 100 * (65 / 135),
    });
    expect(labRangeBar(5, "mmol/L", between("4", "6", "mmol/L"))).toEqual({
      bandStart: 25,
      bandEnd: 75,
      marker: 50,
    });
  });

  test("a reading beyond the track is drawn at its edge", () => {
    expect(labRangeBar(50, "mmol/L", between("4", "6", "mmol/L"))?.marker).toBe(100);
    expect(labRangeBar(-3, "mmol/L", between("4", "6", "mmol/L"))?.marker).toBe(0);
  });

  test("an upper bound only: the band runs from the start of the track", () => {
    const bar = labRangeBar(50, "U/L", {
      kind: "upTo",
      high: "100",
      unit: "U/L",
      converted: false,
    });
    expect(bar?.bandStart).toBe(0);
    expect(bar?.bandEnd).toBeCloseTo(66.667, 2);
    expect(bar?.marker).toBeCloseTo(33.333, 2);
  });

  test("a lower bound only: the band runs to the end of the track", () => {
    expect(
      labRangeBar(75, "mg/dL", { kind: "from", low: "50", unit: "mg/dL", converted: false }),
    ).toEqual({ bandStart: (25 / 75) * 100, bandEnd: 100, marker: (50 / 75) * 100 });
  });

  test("no bar for a text range, another unit, no reading or unusable bounds", () => {
    expect(
      labRangeBar(1, "ng/mL", { kind: "text", text: "negative", unit: "", converted: false }),
    ).toBeNull();
    expect(labRangeBar(65, "nmol/L", between("30", "100"))).toBeNull();
    expect(labRangeBar(null, "ng/mL", between("30", "100"))).toBeNull();
    expect(labRangeBar(65, "ng/mL", between("100", "30"))).toBeNull();
    expect(labRangeBar(65, "ng/mL", null)).toBeNull();
  });

  test("units compare without case or spaces", () => {
    expect(labRangeBar(65, " NG/ML", between("30", "100"))).not.toBeNull();
  });
});
