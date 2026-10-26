import { describe, expect, test } from "bun:test";
import { englishI18n } from "@openvalens/i18n/testing";

import {
  displayLabRange,
  formatLabDate,
  formatLabRange,
  formatLabValue,
  labSparkline,
  type LabRangeDisplay,
} from "./labs";

const marker = {
  code: "blood_marker_glucose",
  displayName: "Glucose",
  unit: "mg/dL",
  latestValue: 92,
  latestSampledAt: "2026-06-12T08:30:00.000Z",
  sampleCount: 3,
  recentValues: [
    { sampledAt: "2026-04-10T08:00:00.000Z", value: 105 },
    { sampledAt: "2026-05-15T08:30:00.000Z", value: 99 },
    { sampledAt: "2026-06-12T08:30:00.000Z", value: 92 },
  ],
};

describe("labs presenter", () => {
  test("formatLabValue: appends unit, rounds to 1 decimal, '—' for null", () => {
    expect(formatLabValue(null, "mg/dL")).toBe("—");
    expect(formatLabValue(92, "mg/dL")).toBe("92 mg/dL");
    expect(formatLabValue(6.83, "%")).toBe("6.8 %");
    expect(formatLabValue(72, null)).toBe("72");
  });

  test("formatLabDate: short month + day + year, '—' for null/invalid", () => {
    expect(formatLabDate(null)).toBe("—");
    expect(formatLabDate("not-a-date")).toBe("—");
    const out = formatLabDate("2026-06-12T08:30:00.000Z");
    expect(out).toMatch(/Jun 12, 2026/);
  });

  test("formatLabDate: locale from settings, explicit timezone is deterministic", () => {
    const iso = "2026-06-12T12:00:00.000Z";
    expect(formatLabDate(iso, { units: "metric", locale: "en-US", timeZone: "UTC" })).toBe(
      "Jun 12, 2026",
    );
    expect(formatLabDate(iso, { units: "metric", locale: "en-GB", timeZone: "UTC" })).toBe(
      "12 Jun 2026",
    );
    expect(formatLabDate(iso, { units: "metric", locale: "en-CA", timeZone: "UTC" })).toBe(
      "Jun 12, 2026",
    );
  });

  test("labSparkline: oldest-first values, dates as labels", () => {
    const series = labSparkline(marker);
    expect(series.map((p) => p.value)).toEqual([105, 99, 92]);
    expect(series[0]?.label).toBe("2026-04-10");
  });
});

describe("lab reference range", () => {
  const glucose = { code: "blood_marker_glucose", unit: "mg/dL" };
  const vitaminD = { code: "blood_marker_vitamin_d", unit: "ng/mL" };
  const line = (range: LabRangeDisplay | null) =>
    range === null ? null : formatLabRange(englishI18n, range);

  test("no recorded range shows nothing", () => {
    expect(displayLabRange(vitaminD, null, "as_reported")).toBeNull();
    expect(displayLabRange(vitaminD, undefined, "mg_dl")).toBeNull();
    expect(
      displayLabRange(
        vitaminD,
        { low: null, high: null, text: null, unit: "ng/mL" },
        "as_reported",
      ),
    ).toBeNull();
  });

  test("both bounds read 'Lab range 30 to 100 ng/mL', exactly as recorded", () => {
    const range = { low: 30, high: 100, text: "30–100", unit: "ng/mL" };
    expect(line(displayLabRange(vitaminD, range, "as_reported"))).toBe("Lab range 30 to 100 ng/mL");
    // Precision the lab printed is kept, never rounded away.
    expect(
      line(
        displayLabRange(
          { code: "blood_marker_tsh", unit: "mIU/L" },
          { low: 0.27, high: 4.2, text: null, unit: "mIU/L" },
          "as_reported",
        ),
      ),
    ).toBe("Lab range 0.27 to 4.2 mIU/L");
  });

  test("one bound only reads 'up to' or 'from'", () => {
    expect(
      line(
        displayLabRange(
          glucose,
          { low: null, high: 100, text: null, unit: "mg/dL" },
          "as_reported",
        ),
      ),
    ).toBe("Lab range up to 100 mg/dL");
    expect(
      line(
        displayLabRange(glucose, { low: 50, high: null, text: null, unit: "mg/dL" }, "as_reported"),
      ),
    ).toBe("Lab range from 50 mg/dL");
  });

  test("text-only ranges are shown verbatim, with the unit added only when missing", () => {
    expect(
      line(
        displayLabRange(
          { code: "blood_marker_hs_crp", unit: "mg/L" },
          { low: null, high: null, text: "< 0.30", unit: "mg/L" },
          "as_reported",
        ),
      ),
    ).toBe("Lab range: < 0.30 mg/L");
    expect(
      line(
        displayLabRange(
          { code: "blood_marker_hs_crp", unit: "mg/L" },
          { low: null, high: null, text: "< 0.30 mg/L", unit: "mg/L" },
          "as_reported",
        ),
      ),
    ).toBe("Lab range: < 0.30 mg/L");
    expect(
      line(
        displayLabRange(
          { code: "blood_marker_x", unit: null },
          { low: null, high: null, text: "Negative", unit: null },
          "as_reported",
        ),
      ),
    ).toBe("Lab range: Negative");
  });

  test("a one-sided range with lab text prefers the lab's own wording", () => {
    expect(
      line(
        displayLabRange(
          glucose,
          { low: null, high: 100, text: "< 100", unit: "mg/dL" },
          "as_reported",
        ),
      ),
    ).toBe("Lab range: < 100 mg/dL");
  });

  test("converts numeric bounds the same way as the reading", () => {
    const range = { low: 70, high: 99, text: "70–99", unit: "mg/dL" };
    const shown = displayLabRange(glucose, range, "mmol_l");
    expect(shown).toMatchObject({
      kind: "between",
      low: "3.9",
      high: "5.5",
      unit: "mmol/L",
      converted: true,
    });
    expect(line(shown)).toBe("Lab range 3.9 to 5.5 mmol/L");
    expect(line(displayLabRange(glucose, range, "mg_dl"))).toBe("Lab range 70 to 99 mg/dL");
    expect(
      line(
        displayLabRange(
          { code: "blood_marker_creatinine", unit: "mg/dL" },
          { low: 0.5, high: 1.1, text: null, unit: "mg/dL" },
          "mmol_l",
        ),
      ),
    ).toBe("Lab range 44.2 to 97.3 µmol/L");
    expect(
      line(displayLabRange(glucose, { low: null, high: 100, text: null, unit: "mg/dL" }, "mmol_l")),
    ).toBe("Lab range up to 5.6 mmol/L");
  });

  test("never converts text ranges or analytes without a fixed factor", () => {
    expect(
      displayLabRange(glucose, { low: null, high: null, text: "70–99", unit: "mg/dL" }, "mmol_l"),
    ).toEqual({ kind: "text", text: "70–99", unit: "mg/dL", converted: false });
    expect(
      line(displayLabRange(vitaminD, { low: 30, high: 100, text: null, unit: "ng/mL" }, "mmol_l")),
    ).toBe("Lab range 30 to 100 ng/mL");
  });

  test("a range recorded in a different unit keeps its own unit", () => {
    // Reading defined in mg/dL, range stored in mmol/L: shown as mmol/L as reported.
    expect(
      line(
        displayLabRange(
          glucose,
          { low: 3.9, high: 5.5, text: null, unit: "mmol/L" },
          "as_reported",
        ),
      ),
    ).toBe("Lab range 3.9 to 5.5 mmol/L");
  });

  test("copy describes the range only: no judgement words", () => {
    const words = /\b(within|above|below|high|low|normal|abnormal|good|bad|healthy|risk)\b/i;
    for (const range of [
      displayLabRange(glucose, { low: 70, high: 99, text: null, unit: "mg/dL" }, "as_reported"),
      displayLabRange(glucose, { low: null, high: 99, text: null, unit: "mg/dL" }, "as_reported"),
      displayLabRange(glucose, { low: 70, high: null, text: null, unit: "mg/dL" }, "as_reported"),
    ])
      expect(line(range)).not.toMatch(words);
  });
});
