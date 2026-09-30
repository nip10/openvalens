import { describe, expect, test } from "bun:test";

import { hasQualityFlags, normalizeMetricSample } from "./normalization";

describe("normalization helpers (Issue #17 bounded read-side)", () => {
  test("canonicalize the metric code and emit no flags for healthy values", () => {
    const result = normalizeMetricSample({
      metricCode: "weight",
      value: 84,
      unit: "kg",
    });
    expect(result).toEqual({
      metricCode: "weight",
      canonicalMetricCode: "weight",
      value: 84,
      unit: "kg",
      qualityFlags: [],
    });
    expect(hasQualityFlags(result)).toBe(false);
  });

  test("flag unit mismatch when the unit does not match the canonical definition", () => {
    const result = normalizeMetricSample({
      metricCode: "weight",
      value: 84,
      unit: "lb",
    });
    expect(result.qualityFlags).toContain("unit_mismatch");
    expect(result.unit).toBe("kg");
  });

  test("flag non-finite values", () => {
    const result = normalizeMetricSample({
      metricCode: "resting_heart_rate",
      value: Number.NaN,
    });
    expect(result.qualityFlags).toContain("non_finite_value");
  });

  test("flag negative values for numeric metrics", () => {
    const result = normalizeMetricSample({
      metricCode: "weight",
      value: -1,
    });
    expect(result.qualityFlags).toContain("negative_value");
  });

  test("flag unknown metric codes", () => {
    const result = normalizeMetricSample({
      metricCode: "made_up",
      value: 42,
    });
    expect(result.qualityFlags).toContain("unknown_metric");
    expect(result.canonicalMetricCode).toBe("made_up");
  });

  test("blood_marker family samples inherit the wildcard unit", () => {
    const result = normalizeMetricSample({
      metricCode: "blood_marker_glucose",
      value: 95,
      unit: "mg/dL",
    });
    expect(result.canonicalMetricCode).toBe("blood_marker_glucose");
    // The blood_marker wildcard taxonomy uses unit "varies", so the
    // caller-supplied unit does not trigger a mismatch flag.
    expect(result.qualityFlags).toEqual([]);
    expect(result.unit).toBe("varies");
  });

  test("alias resolves before normalization", () => {
    const result = normalizeMetricSample({
      metricCode: "heartRate",
      value: 70,
    });
    expect(result.canonicalMetricCode).toBe("heart_rate");
  });
});
