import { expect, test } from "bun:test";
import {
  buildTimelinePage,
  decodeCursor,
  normalizeTimelineDateRange,
  validateTimelineFiltersShape,
} from "./timeline";
import { canonicalEvent, canonicalMetric } from "./canonical";
const at = new Date("2026-09-29T12:00:00Z");
const event = canonicalEvent({
  id: 1,
  eventAt: at,
  eventType: "sleep_session",
  title: null,
  payloadJson: { source: "Manual", endAt: "2026-09-29T13:30:00Z", sleepStageIntervals: [1, 2] },
  dataSource: null,
});
const metric = canonicalMetric({
  id: 2,
  sampledAt: at,
  numericValue: 88,
  textValue: null,
  unit: "kg",
  metadataJson: null,
  metricCode: "weight",
  metricDisplayName: "Weight",
  metricCategory: "body",
  dataSource: {
    id: 3,
    displayName: "Watch",
    originalSourceName: null,
    sourceAppId: null,
    sourceType: "watch",
  },
});
test("canonical source projection preserves anchor sleep and metric contracts", () => {
  expect(event.canonical).toEqual({
    type: "sleep_session",
    title: null,
    endAt: "2026-09-29T13:30:00Z",
    durationMinutes: 90,
    stageCount: 2,
  });
  expect(metric.summary).toBe("Weight 88 kg");
  expect(metric.reviewState).toBe("unreviewed");
});
test("mixed equal-time rows sort by stable ID and cursor advances strictly", () => {
  const first = buildTimelinePage([metric, event], { limit: 1 });
  expect(first.items).toEqual([event]);
  expect(decodeCursor(first.nextCursor ?? "")).toEqual({ at: event.at, id: event.id });
  expect(
    buildTimelinePage([metric, event], { limit: 1, cursor: first.nextCursor ?? undefined }),
  ).toEqual({ items: [metric], nextCursor: null });
  expect(buildTimelinePage([event], { cursor: `${event.at}|health_event:999` }).items).toEqual([]);
});
test("source filter is exact case-insensitive label or ID, before pagination", () => {
  expect(buildTimelinePage([event, metric], { source: "WATCH", limit: 1 }).items).toEqual([metric]);
  expect(buildTimelinePage([event, metric], { source: "3" }).items).toEqual([metric]);
  expect(buildTimelinePage([event, metric], { source: "man" }).items).toEqual([]);
});
test("UTC date range and full timestamps include boundaries", () => {
  expect(normalizeTimelineDateRange({ from: "2026-09-29", to: "2026-09-29" })).toMatchObject({
    fromIso: "2026-09-29T00:00:00.000Z",
    toIso: "2026-09-29T23:59:59.999Z",
  });
  expect(buildTimelinePage([event, metric], { from: event.at, to: event.at }).items).toHaveLength(
    2,
  );
  expect(buildTimelinePage([event], { from: "2026-09-30" }).items).toEqual([]);
  expect(validateTimelineFiltersShape({ from: "2026-02-30" })).not.toBeNull();
  expect(validateTimelineFiltersShape({ from: "2026-09-30", to: "2026-09-01" })).not.toBeNull();
});
test("malformed cursor is rejected rather than silently restarting", () => {
  expect(decodeCursor("junk|health_event:1")).toBeNull();
  expect(decodeCursor(`${event.at}|foreign:1`)).toBeNull();
  expect(() => buildTimelinePage([event], { cursor: "invalid" })).toThrow();
});
