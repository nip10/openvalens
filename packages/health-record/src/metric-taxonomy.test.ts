import { describe, expect, test } from "bun:test";

import {
  BLOOD_MARKER_CODE_PREFIX,
  CANONICAL_METRIC_CODES,
  CANONICAL_METRIC_DEFINITIONS,
  canonicalizeMetricCode,
  getDefaultSourcePriorityOrder,
  getMetricDefinition,
  isBloodMarkerFamilyCode,
  isCanonicalMetricCode,
} from "./metric-taxonomy";

describe("metric taxonomy (Issue #17 bounded read-side)", () => {
  test("canonical codes include the anchovy source codes plus target extensions", () => {
    expect(CANONICAL_METRIC_CODES).toEqual([
      "weight",
      "steps",
      "heart_rate",
      "sleep_duration",
      "height",
      "resting_heart_rate",
      "sleep_session",
      "blood_marker",
      "body_fat",
      "active_calories",
      "distance",
    ]);
  });

  test("mobile wearable codes (Issue #45) have units, categories and default priority", () => {
    expect(getMetricDefinition("body_fat")).toMatchObject({
      unit: "%",
      category: "body",
      aggregationDefault: "latest",
    });
    expect(getMetricDefinition("active_calories")).toMatchObject({
      unit: "kcal",
      category: "activity",
      aggregationDefault: "sum",
    });
    expect(getMetricDefinition("distance")).toMatchObject({
      unit: "m",
      category: "activity",
      aggregationDefault: "sum",
    });
    expect(getDefaultSourcePriorityOrder("body_fat")).toEqual(["scale", "phone", "watch"]);
    expect(getDefaultSourcePriorityOrder("active_calories")).toEqual(["watch", "phone"]);
    expect(getDefaultSourcePriorityOrder("distance")).toEqual(["watch", "phone"]);
    expect(canonicalizeMetricCode("bodyFat")).toBe("body_fat");
    expect(canonicalizeMetricCode("activeCalories")).toBe("active_calories");
  });

  test("source codes match anchovy units, categories and default priority", () => {
    expect(getMetricDefinition("steps")).toMatchObject({
      unit: "count",
      category: "activity",
      aggregationDefault: "sum",
    });
    expect(getMetricDefinition("heart_rate")).toMatchObject({
      unit: "bpm",
      category: "cardiac",
      aggregationDefault: "avg",
    });
    expect(getMetricDefinition("sleep_duration")).toMatchObject({
      unit: "min",
      category: "sleep",
      aggregationDefault: "sum",
    });
    for (const code of ["steps", "heart_rate", "sleep_duration"])
      expect(getDefaultSourcePriorityOrder(code)).toEqual(["watch", "phone"]);
  });

  test("canonical definitions expose unit, value type and aggregation default", () => {
    const weight = getMetricDefinition("weight");
    expect(weight).toMatchObject({
      code: "weight",
      displayName: "Weight",
      category: "body",
      unit: "kg",
      valueType: "number",
      aggregationDefault: "latest",
      hasDefaultPriority: true,
    });
    expect(weight?.supportedSources).toContain("watch");
    expect(weight?.supportedSources).toContain("phone");

    const resting = getMetricDefinition("resting_heart_rate");
    expect(resting).toMatchObject({
      code: "resting_heart_rate",
      category: "vitals",
      unit: "bpm",
      valueType: "number",
      aggregationDefault: "avg",
    });
    expect(resting?.supportedSources).toEqual(["watch", "phone"]);

    const sleep = getMetricDefinition("sleep_session");
    expect(sleep).toMatchObject({
      code: "sleep_session",
      category: "sleep",
      unit: "min",
      aggregationDefault: "sum",
    });
    expect(sleep?.supportedSources).toContain("ring");

    const bloodMarker = getMetricDefinition("blood_marker");
    expect(bloodMarker?.hasDefaultPriority).toBe(true);
    expect(bloodMarker?.supportedSources).toContain("lab");

    const height = getMetricDefinition("height");
    expect(height?.hasDefaultPriority).toBe(false);
  });

  test("canonicalizeMetricCode maps legacy aliases", () => {
    expect(canonicalizeMetricCode("heartRate")).toBe("heart_rate");
    expect(canonicalizeMetricCode("restingHeartRate")).toBe("resting_heart_rate");
    expect(canonicalizeMetricCode("sleepSession")).toBe("sleep_session");
    expect(canonicalizeMetricCode("bloodMarker")).toBe("blood_marker");
    expect(canonicalizeMetricCode("weightKg")).toBe("weight");
    expect(canonicalizeMetricCode("heightCm")).toBe("height");
  });

  test("canonicalizeMetricCode preserves blood-marker family codes", () => {
    expect(canonicalizeMetricCode("blood_marker_glucose")).toBe("blood_marker_glucose");
    expect(canonicalizeMetricCode("blood_marker_hba1c")).toBe("blood_marker_hba1c");
    expect(isBloodMarkerFamilyCode("blood_marker_glucose")).toBe(true);
    expect(isBloodMarkerFamilyCode("blood_marker")).toBe(false);
    expect(BLOOD_MARKER_CODE_PREFIX).toBe("blood_marker_");
  });

  test("isCanonicalMetricCode rejects unknown and family codes", () => {
    expect(isCanonicalMetricCode("weight")).toBe(true);
    expect(isCanonicalMetricCode("blood_marker_glucose")).toBe(false);
    expect(isCanonicalMetricCode("made_up")).toBe(false);
  });

  test("getMetricDefinition resolves blood_marker family to the wildcard taxonomy", () => {
    expect(getMetricDefinition("blood_marker_glucose")?.code).toBe("blood_marker");
    expect(getMetricDefinition("blood_marker_hba1c")?.code).toBe("blood_marker");
    expect(getMetricDefinition("nope")).toBeUndefined();
  });

  test("getDefaultSourcePriorityOrder respects hasDefaultPriority gate", () => {
    expect(getDefaultSourcePriorityOrder("weight")).toEqual(["phone", "watch", "scale"]);
    expect(getDefaultSourcePriorityOrder("resting_heart_rate")).toEqual(["watch", "phone"]);
    expect(getDefaultSourcePriorityOrder("sleep_session")).toEqual(["watch", "ring", "phone"]);
    expect(getDefaultSourcePriorityOrder("blood_marker")).toEqual(["lab", "phone", "watch"]);
    expect(getDefaultSourcePriorityOrder("height")).toBeNull();
    expect(getDefaultSourcePriorityOrder("unknown")).toBeNull();
  });

  test("canonical definitions are frozen and unique", () => {
    const codes = new Set(CANONICAL_METRIC_DEFINITIONS.map((d) => d.code));
    expect(codes.size).toBe(CANONICAL_METRIC_DEFINITIONS.length);
    for (const def of CANONICAL_METRIC_DEFINITIONS) {
      expect(Object.isFrozen(def.supportedSources)).toBe(true);
    }
    expect(Object.isFrozen(CANONICAL_METRIC_CODES)).toBe(true);
    expect(Object.isFrozen(CANONICAL_METRIC_DEFINITIONS)).toBe(true);
  });
});
