import { describe, expect, test } from "bun:test";

import { referenceRangeFromSample } from "./reference-range";

describe("referenceRangeFromSample", () => {
  test("reads the clinical-schema keys exactly as recorded", () => {
    expect(
      referenceRangeFromSample(
        { refRangeLow: 30, refRangeHigh: 100, refRangeText: "30–100" },
        "ng/mL",
        "ng/mL",
      ),
    ).toEqual({ low: 30, high: 100, text: "30–100", unit: "ng/mL" });
  });

  test("nothing recorded, or nothing usable, is null", () => {
    expect(referenceRangeFromSample(null, null, "mg/dL")).toBeNull();
    expect(referenceRangeFromSample([30, 100], null, "mg/dL")).toBeNull();
    expect(referenceRangeFromSample({ panel: "2026-10-08" }, null, "mg/dL")).toBeNull();
    expect(
      referenceRangeFromSample(
        { refRangeLow: "30", refRangeHigh: Number.NaN, refRangeText: "   " },
        null,
        "mg/dL",
      ),
    ).toBeNull();
    expect(referenceRangeFromSample({ refRangeText: "x".repeat(121) }, null, "mg/dL")).toBeNull();
  });

  test("the range is in the reading's unit, falling back to the marker's", () => {
    const meta = { refRangeHigh: 100 };
    expect(referenceRangeFromSample(meta, "mmol/L", "mg/dL")?.unit).toBe("mmol/L");
    // API-ingested blood markers store the taxonomy placeholder unit.
    expect(referenceRangeFromSample(meta, "varies", "mg/dL")?.unit).toBe("mg/dL");
    expect(referenceRangeFromSample(meta, null, "mg/dL")?.unit).toBe("mg/dL");
    expect(referenceRangeFromSample(meta, null, null)?.unit).toBeNull();
  });
});
