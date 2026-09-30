import { describe, expect, test } from "bun:test";

import {
  decodePreferredSourcesFromRow,
  encodePreferredSourcesForRow,
  sanitizeMetricSourcePreference,
  validateMetricSourcePreference,
} from "./source-preferences";

describe("source preferences (Issue #17 bounded read-side)", () => {
  test("sanitize returns the canonicalized payload for a known metric", () => {
    const sanitized = sanitizeMetricSourcePreference({
      metricCode: "weight",
      preferredSources: ["phone", "watch"],
    });
    expect(sanitized).toEqual({
      metricCode: "weight",
      canonicalMetricCode: "weight",
      preferredSources: ["phone", "watch"],
    });
  });

  test("sanitize preserves blood_marker family codes", () => {
    const sanitized = sanitizeMetricSourcePreference({
      metricCode: "blood_marker_glucose",
      preferredSources: ["lab_x", "phone"],
    });
    expect(sanitized?.canonicalMetricCode).toBe("blood_marker_glucose");
    expect(sanitized?.preferredSources).toEqual(["lab_x", "phone"]);
  });

  test("sanitize rejects unknown metric codes", () => {
    const sanitized = sanitizeMetricSourcePreference({
      metricCode: "made_up_code",
      preferredSources: ["watch", "phone"],
    });
    expect(sanitized).toBeNull();
  });

  test("sanitize rejects unsupported source vocabularies", () => {
    const sanitized = sanitizeMetricSourcePreference({
      metricCode: "resting_heart_rate",
      preferredSources: ["ring", "watch"],
    });
    expect(sanitized).toBeNull();
  });

  test("sanitize rejects empty source arrays", () => {
    expect(
      sanitizeMetricSourcePreference({ metricCode: "weight", preferredSources: [] }),
    ).toBeNull();
  });

  test("validate returns INVALID metric code for unknown codes", () => {
    const result = validateMetricSourcePreference({
      metricCode: "made_up_code",
      preferredSources: ["watch", "phone"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_metric_code");
  });

  test("validate returns EMPTY for empty source arrays", () => {
    const result = validateMetricSourcePreference({
      metricCode: "weight",
      preferredSources: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("empty_sources");
  });

  test("validate returns UNSUPPORTED for invalid source vocab", () => {
    const result = validateMetricSourcePreference({
      metricCode: "resting_heart_rate",
      preferredSources: ["ring", "watch"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unsupported_source");
  });

  test("validate accepts well-formed payloads", () => {
    const result = validateMetricSourcePreference({
      metricCode: "weight",
      preferredSources: ["phone", "watch", "scale"],
    });
    expect(result).toEqual({ ok: true });
  });

  test("encode dedupes whitespace-trimmed sources", () => {
    const encoded = encodePreferredSourcesForRow(["watch", " watch ", "phone", "watch"]);
    expect(encoded).toEqual(["watch", "phone"]);
  });

  test("decode filters non-string entries", () => {
    const decoded = decodePreferredSourcesFromRow(["watch", null as unknown as string, 7 as unknown as string, "phone"]);
    expect([...decoded]).toEqual(["watch", "phone"]);
  });

  test("decode tolerates null and undefined", () => {
    expect([...decodePreferredSourcesFromRow(null)]).toEqual([]);
    expect([...decodePreferredSourcesFromRow(undefined)]).toEqual([]);
  });
});