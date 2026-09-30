import { describe, expect, test } from "bun:test";

import {
  buildIngestDefinitionRow,
  CanonicalMetricNotFoundError,
  computeMetricSampleDedupeHash,
  CrossTenantReferenceError,
  ensureSampleHasValue,
  inspectSampleQuality,
  materializeMetricSample,
  parseObservedAtUtc,
  resolveCanonicalMetricCode,
  stableSerialize,
} from "./ingest";

describe("ingest contract (Issue #17 bounded ingest write seam)", () => {
  describe("resolveCanonicalMetricCode", () => {
    test("resolves every canonical taxonomy code", () => {
      for (const code of [
        "weight",
        "height",
        "resting_heart_rate",
        "sleep_session",
        "blood_marker",
      ] as const) {
        const result = resolveCanonicalMetricCode({ metricCode: code });
        expect(result).not.toBeNull();
        expect(result?.canonicalMetricCode).toBe(code);
        expect(result?.isBloodMarkerFamily).toBe(false);
      }
    });

    test("canonical unit/domain are derived from the taxonomy, not the input", () => {
      const weight = resolveCanonicalMetricCode({ metricCode: "weight" });
      expect(weight?.unit).toBe("kg");
      expect(weight?.category).toBe("body");
      const heart = resolveCanonicalMetricCode({ metricCode: "resting_heart_rate" });
      expect(heart?.unit).toBe("bpm");
      expect(heart?.category).toBe("vitals");
    });

    test("aliases resolve to the canonical metric", () => {
      expect(resolveCanonicalMetricCode({ metricCode: "heartRate" })?.canonicalMetricCode).toBe(
        "heart_rate",
      );
      expect(resolveCanonicalMetricCode({ metricCode: "weightKg" })?.canonicalMetricCode).toBe(
        "weight",
      );
    });

    test("blood_marker family codes resolve to the wildcard taxonomy", () => {
      const glucose = resolveCanonicalMetricCode({ metricCode: "blood_marker_glucose" });
      expect(glucose?.canonicalMetricCode).toBe("blood_marker_glucose");
      expect(glucose?.category).toBe("labs");
      expect(glucose?.unit).toBe("varies");
      expect(glucose?.isBloodMarkerFamily).toBe(true);
      expect(glucose?.displayName).toBe("Glucose");

      const hba1c = resolveCanonicalMetricCode({ metricCode: "blood_marker_hba1c" });
      expect(hba1c?.displayName).toBe("Hba1c");
    });

    test("unknown metric codes return null", () => {
      expect(resolveCanonicalMetricCode({ metricCode: "made_up_marker" })).toBeNull();
      expect(resolveCanonicalMetricCode({ metricCode: "" })).toBeNull();
    });
  });

  describe("parseObservedAtUtc", () => {
    test("accepts an ISO string and returns a Date instance", () => {
      const parsed = parseObservedAtUtc("2026-09-29T12:00:00Z");
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed.toISOString()).toBe("2026-09-29T12:00:00.000Z");
    });

    test("accepts a Date instance and returns it", () => {
      const date = new Date("2026-09-29T12:00:00Z");
      const parsed = parseObservedAtUtc(date);
      expect(parsed.getTime()).toBe(date.getTime());
    });

    test("parses dates with offsets to UTC instant", () => {
      const parsed = parseObservedAtUtc("2026-09-29T15:00:00+03:00");
      expect(parsed.toISOString()).toBe("2026-09-29T12:00:00.000Z");
    });

    test("rejects unparseable strings", () => {
      expect(() => parseObservedAtUtc("not-a-date")).toThrow(/valid date/);
      expect(() => parseObservedAtUtc("")).toThrow();
    });

    test("rejects NaN Date instances", () => {
      expect(() => parseObservedAtUtc(new Date("invalid"))).toThrow(/valid date/);
    });
  });

  describe("ensureSampleHasValue", () => {
    test("accepts a numeric value", () => {
      expect(() => ensureSampleHasValue({ valueNumeric: 84, valueString: null })).not.toThrow();
    });
    test("accepts a string value", () => {
      expect(() => ensureSampleHasValue({ valueNumeric: null, valueString: "ok" })).not.toThrow();
    });
    test("rejects when both are null", () => {
      expect(() => ensureSampleHasValue({ valueNumeric: null, valueString: null })).toThrow(
        /must include/,
      );
    });
    test("rejects when both are empty", () => {
      expect(() => ensureSampleHasValue({ valueNumeric: NaN, valueString: "" })).toThrow(
        /must include/,
      );
    });
  });

  describe("inspectSampleQuality", () => {
    const weight = resolveCanonicalMetricCode({ metricCode: "weight" })!;
    test("flags non_finite_value when the numeric is NaN", () => {
      expect(
        inspectSampleQuality({ resolved: weight, valueNumeric: null, declaredUnit: null }),
      ).toContain("non_finite_value");
    });

    test("flags negative_value for known numeric metrics", () => {
      expect(
        inspectSampleQuality({ resolved: weight, valueNumeric: -1, declaredUnit: null }),
      ).toContain("negative_value");
    });

    test("flags unit_mismatch when declared unit does not match taxonomy", () => {
      const flags = inspectSampleQuality({
        resolved: weight,
        valueNumeric: 84,
        declaredUnit: "lb",
      });
      expect(flags).toContain("unit_mismatch");
    });

    test("blood_marker family never produces unit_mismatch", () => {
      const blood = resolveCanonicalMetricCode({ metricCode: "blood_marker_glucose" })!;
      const flags = inspectSampleQuality({
        resolved: blood,
        valueNumeric: 95,
        declaredUnit: "mg/dL",
      });
      expect(flags).not.toContain("unit_mismatch");
    });

    test("emits no flags for a healthy weight sample", () => {
      expect(
        inspectSampleQuality({ resolved: weight, valueNumeric: 84, declaredUnit: "kg" }),
      ).toEqual([]);
    });
  });

  describe("computeMetricSampleDedupeHash", () => {
    test("is deterministic for the same inputs", () => {
      const observedAt = new Date("2026-09-29T12:00:00Z");
      const first = computeMetricSampleDedupeHash({
        metricCode: "weight",
        observedAt,
        valueNumeric: 84,
        valueString: null,
        sourceId: 7,
        externalSampleId: null,
      });
      const second = computeMetricSampleDedupeHash({
        metricCode: "weight",
        observedAt,
        valueNumeric: 84,
        valueString: null,
        sourceId: 7,
        externalSampleId: null,
      });
      expect(first).toBe(second);
      expect(first).toMatch(/^[0-9a-f]{64}$/);
    });

    test("differs when any input changes", () => {
      const base = {
        metricCode: "weight",
        observedAt: new Date("2026-09-29T12:00:00Z"),
        valueNumeric: 84,
        valueString: null,
        sourceId: 7,
        externalSampleId: null,
      };
      const baseline = computeMetricSampleDedupeHash(base);
      const otherValue = computeMetricSampleDedupeHash({ ...base, valueNumeric: 85 });
      const otherSource = computeMetricSampleDedupeHash({ ...base, sourceId: 8 });
      const otherTime = computeMetricSampleDedupeHash({
        ...base,
        observedAt: new Date("2026-09-29T13:00:00Z"),
      });
      expect(otherValue).not.toBe(baseline);
      expect(otherSource).not.toBe(baseline);
      expect(otherTime).not.toBe(baseline);
    });

    test("canonicalizes the metric code before hashing", () => {
      const observedAt = new Date("2026-09-29T12:00:00Z");
      const aliased = computeMetricSampleDedupeHash({
        metricCode: "heartRate",
        observedAt,
        valueNumeric: 70,
        valueString: null,
        sourceId: null,
        externalSampleId: null,
      });
      const canonical = computeMetricSampleDedupeHash({
        metricCode: "heart_rate",
        observedAt,
        valueNumeric: 70,
        valueString: null,
        sourceId: null,
        externalSampleId: null,
      });
      expect(aliased).toBe(canonical);
    });
  });

  describe("stableSerialize", () => {
    test("sorts object keys deterministically", () => {
      const a = stableSerialize({ b: 1, a: 2 });
      const b = stableSerialize({ a: 2, b: 1 });
      expect(a).toBe(b);
    });
    test("handles arrays and nested objects", () => {
      const result = stableSerialize({ list: [{ b: 2, a: 1 }] });
      expect(result).toBe('{"list":[{"a":1,"b":2}]}');
    });
  });

  describe("materializeMetricSample", () => {
    const weight = resolveCanonicalMetricCode({ metricCode: "weight" })!;

    test("uses the taxonomy unit, never the caller-supplied unit", () => {
      const materialised = materializeMetricSample({
        organizationId: "org-a",
        metricDefinitionId: 1,
        resolved: weight,
        raw: {
          metricCode: "weight",
          observedAt: "2026-09-29T12:00:00Z",
          valueNumeric: 84,
        },
      });
      expect(materialised.unit).toBe("kg");
      expect(materialised.numericValue).toBe(84);
      expect(materialised.sampledAt.toISOString()).toBe("2026-09-29T12:00:00.000Z");
      expect(materialised.dedupeHash).toMatch(/^[0-9a-f]{64}$/);
    });

    test("derives a deterministic dedupe hash from canonical fields", () => {
      const materialised = materializeMetricSample({
        organizationId: "org-a",
        metricDefinitionId: 1,
        resolved: weight,
        raw: {
          metricCode: "weight",
          observedAt: "2026-09-29T12:00:00Z",
          valueNumeric: 84,
        },
      });
      const expected = computeMetricSampleDedupeHash({
        metricCode: "weight",
        observedAt: new Date("2026-09-29T12:00:00Z"),
        valueNumeric: 84,
        valueString: null,
        sourceId: null,
        externalSampleId: null,
      });
      expect(materialised.dedupeHash).toBe(expected);
    });

    test("honours a caller-supplied dedupeHash", () => {
      const materialised = materializeMetricSample({
        organizationId: "org-a",
        metricDefinitionId: 1,
        resolved: weight,
        raw: {
          metricCode: "weight",
          observedAt: "2026-09-29T12:00:00Z",
          valueNumeric: 84,
          dedupeHash: "caller-supplied-hash",
        },
      });
      expect(materialised.dedupeHash).toBe("caller-supplied-hash");
    });

    test("converts a numeric null into textValue when provided", () => {
      const materialised = materializeMetricSample({
        organizationId: "org-a",
        metricDefinitionId: 1,
        resolved: weight,
        raw: {
          metricCode: "weight",
          observedAt: "2026-09-29T12:00:00Z",
          valueString: "refused",
        },
      });
      expect(materialised.numericValue).toBeNull();
      expect(materialised.textValue).toBe("refused");
    });

    test("embeds payload + canonical metadata into metadataJson", () => {
      const materialised = materializeMetricSample({
        organizationId: "org-a",
        metricDefinitionId: 1,
        resolved: weight,
        raw: {
          metricCode: "weight",
          observedAt: "2026-09-29T12:00:00Z",
          valueNumeric: 84,
          payload: { source: "manual" },
        },
      });
      expect(materialised.metadataJson).toMatchObject({
        canonicalMetricCode: "weight",
        taxonomyUnit: "kg",
        source: "manual",
      });
    });
  });

  describe("buildIngestDefinitionRow", () => {
    test("uses the taxonomy unit/category/valueType/aggregationDefault verbatim", () => {
      const resolved = resolveCanonicalMetricCode({ metricCode: "resting_heart_rate" })!;
      const row = buildIngestDefinitionRow({ organizationId: "org-a", resolved });
      expect(row).toEqual({
        organizationId: "org-a",
        code: "resting_heart_rate",
        displayName: "Resting Heart Rate",
        category: "vitals",
        unit: "bpm",
        valueType: "number",
        aggregationDefault: "avg",
        isActive: true,
      });
    });

    test("honours a caller displayName override", () => {
      const resolved = resolveCanonicalMetricCode({ metricCode: "weight" })!;
      const row = buildIngestDefinitionRow({
        organizationId: "org-a",
        resolved,
        displayNameOverride: "Body Mass",
      });
      expect(row.displayName).toBe("Body Mass");
    });
  });

  describe("typed errors", () => {
    test("CanonicalMetricNotFoundError carries the offending code", () => {
      const error = new CanonicalMetricNotFoundError("made_up");
      expect(error.code).toBe("METRIC_NOT_FOUND");
      expect(error.message).toContain("made_up");
    });

    test("CrossTenantReferenceError identifies the resource and id", () => {
      const error = new CrossTenantReferenceError("data_source", 42);
      expect(error.code).toBe("CROSS_TENANT_REFERENCE");
      expect(error.message).toContain("data_source");
      expect(error.message).toContain("42");
    });
  });
});
