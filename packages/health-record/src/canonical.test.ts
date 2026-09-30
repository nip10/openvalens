import { describe, expect, test } from "bun:test";

import { canonicalMetric } from "./canonical";

describe("canonical metric uses taxonomy seam (Issue #17 bounded read-side)", () => {
  test("taxonomy-derived unit fills in when the row omits one", () => {
    const event = canonicalMetric({
      id: 1,
      sampledAt: new Date("2026-09-29T00:00:00Z"),
      numericValue: 84,
      textValue: null,
      unit: null,
      metadataJson: null,
      metricCode: "weight",
      metricDisplayName: "Weight",
      metricCategory: null,
      dataSource: null,
    });
    expect(event.domain).toBe("body");
    expect(event.canonical.unit).toBe("kg");
    expect(event.summary).toBe("Weight 84 kg");
  });

  test("explicit tenant category wins over taxonomy fallback", () => {
    const event = canonicalMetric({
      id: 2,
      sampledAt: new Date("2026-09-29T00:00:00Z"),
      numericValue: 60,
      textValue: null,
      unit: null,
      metadataJson: null,
      metricCode: "resting_heart_rate",
      metricDisplayName: "Resting Heart Rate",
      metricCategory: "vitals",
      dataSource: null,
    });
    expect(event.domain).toBe("vitals");
    expect(event.canonical.unit).toBe("bpm");
  });

  test("blood_marker family uses the wildcard category and unit", () => {
    const event = canonicalMetric({
      id: 3,
      sampledAt: new Date("2026-09-29T00:00:00Z"),
      numericValue: 95,
      textValue: null,
      unit: "mg/dL",
      metadataJson: null,
      metricCode: "blood_marker_glucose",
      metricDisplayName: "Glucose",
      metricCategory: null,
      dataSource: null,
    });
    expect(event.domain).toBe("labs");
    // The taxonomy declares "varies" for the wildcard; the row's
    // explicit unit wins when it's present.
    expect(event.canonical.unit).toBe("mg/dL");
    expect(event.summary).toBe("Glucose 95 mg/dL");
  });

  test("unknown metric code falls through to the unknown domain", () => {
    const event = canonicalMetric({
      id: 4,
      sampledAt: new Date("2026-09-29T00:00:00Z"),
      numericValue: 1,
      textValue: null,
      unit: null,
      metadataJson: null,
      metricCode: "custom_marker",
      metricDisplayName: "Custom",
      metricCategory: null,
      dataSource: null,
    });
    expect(event.domain).toBe("unknown");
  });
});