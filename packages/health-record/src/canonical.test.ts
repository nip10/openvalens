import { describe, expect, test } from "bun:test";

import { canonicalEvent, canonicalMetric } from "./canonical";

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

  test("the ingest channel rides on the data-source ref next to the stored label", () => {
    const event = canonicalMetric({
      id: 5,
      sampledAt: new Date("2026-09-29T00:00:00Z"),
      numericValue: 72,
      textValue: null,
      unit: "bpm",
      metadataJson: { provider: "apple_health", sourceApp: "app.openvalens.demo.tracker" },
      metricCode: "heart_rate",
      metricDisplayName: "Heart Rate",
      metricCategory: null,
      dataSource: {
        id: 9,
        displayName: "app.openvalens.demo.tracker",
        originalSourceName: null,
        sourceAppId: "app.openvalens.demo.tracker",
        sourceType: "unknown",
      },
    });
    expect(event.sourceRefs).toEqual([
      {
        type: "data_source",
        label: "app.openvalens.demo.tracker",
        id: 9,
        provider: "apple_health",
      },
    ]);
  });

  test("a sleep event from a wearable carries the vendor id", () => {
    const event = canonicalEvent({
      id: 6,
      eventAt: new Date("2026-09-29T00:00:00Z"),
      eventType: "sleep_session",
      title: null,
      payloadJson: { provider: "oura", sourceApp: "oura" },
      dataSource: {
        id: 3,
        displayName: "Oura (cloud)",
        originalSourceName: null,
        sourceAppId: "oura",
        sourceType: "ring",
      },
    });
    expect(event.sourceRefs).toEqual([
      { type: "data_source", label: "Oura (cloud)", id: 3, provider: "oura" },
      { type: "data_source", label: "oura", provider: "oura" },
    ]);
  });

  test("a reading typed in through ingestMetricSample is marked manual", () => {
    const event = canonicalMetric({
      id: 7,
      sampledAt: new Date("2026-09-29T00:00:00Z"),
      numericValue: 60,
      textValue: null,
      unit: "bpm",
      metadataJson: { canonicalMetricCode: "resting_heart_rate", ingestedByUserId: "user-1" },
      metricCode: "resting_heart_rate",
      metricDisplayName: "Resting Heart Rate",
      metricCategory: null,
      dataSource: null,
    });
    expect(event.sourceRefs).toEqual([{ type: "manual", label: "manual", provider: "manual" }]);
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
