import { expect, test } from "bun:test";
import { canonicalEvent, canonicalMetric } from "./canonical";
import { buildTimelineChangeSummary } from "./changes-since-review";
test("anchor summary counts occurrence items, severity and needs review", () => {
  const at = new Date("2026-09-01T12:00:00Z");
  const event = canonicalEvent({
    id: 1,
    eventAt: at,
    eventType: "sleep_session",
    title: null,
    payloadJson: { confidence: 0.3 },
    dataSource: null,
  });
  const metric = canonicalMetric({
    id: 2,
    sampledAt: at,
    numericValue: 1,
    textValue: null,
    unit: null,
    metadataJson: { flag: "HIGH" },
    metricCode: "weight",
    metricDisplayName: "Weight",
    metricCategory: "body",
    dataSource: null,
  });
  expect(buildTimelineChangeSummary([event, metric])).toEqual({
    total: 2,
    byDomain: { sleep: 1, body: 1 },
    bySeverity: { none: 1, warning: 1 },
    needsReview: 2,
  });
});
