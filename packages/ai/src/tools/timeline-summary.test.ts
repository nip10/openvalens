import { describe, expect, test } from "bun:test";

import { FIXED_NOW, ORG_A, createFakeSources, timelineEntry, toolContext } from "./test-fixtures";
import {
  TIMELINE_SUMMARY_RECENT_ITEMS,
  TIMELINE_SUMMARY_SCAN_LIMIT,
  buildTimelineSummary,
  executeTimelineSummary,
  timelineSummaryInput,
  timelineSummaryOutput,
} from "./timeline-summary";

const WINDOW = { days: 30, from: "2026-02-08", to: FIXED_NOW.toISOString() };

describe("timelineSummary input", () => {
  test("defaults to 30 days and caps at 90", () => {
    expect(timelineSummaryInput.parse({})).toEqual({ days: 30 });
    expect(timelineSummaryInput.safeParse({ days: 0 }).success).toBe(false);
    expect(timelineSummaryInput.safeParse({ days: 91 }).success).toBe(false);
  });
});

describe("buildTimelineSummary", () => {
  test("counts entries and lists the newest without titles or sources", () => {
    const items = [
      timelineEntry("metric_sample:3", "2026-03-09T08:00:00.000Z", {
        kind: "metric",
        domain: "labs",
        severity: "warning",
        reviewState: "needs_review",
        canonical: { metricCode: "blood_marker_ldl" },
      }),
      timelineEntry("health_event:2", "2026-03-05T22:00:00.000Z"),
      timelineEntry("consultation:1", "2026-02-20T00:00:00.000Z", { domain: "unknown" }),
    ];

    const result = buildTimelineSummary(items, false, WINDOW, FIXED_NOW);

    expect(() => timelineSummaryOutput.parse(result)).not.toThrow();
    expect(result).toMatchObject({
      status: "ok",
      entryCount: 3,
      truncated: false,
      byDomain: { labs: 1, sleep: 1, unknown: 1 },
      byKind: { metric: 1, event: 2 },
      bySeverity: { warning: 1, none: 2 },
      needsReviewCount: 1,
      newestAt: "2026-03-09T08:00:00.000Z",
      oldestAt: "2026-02-20T00:00:00.000Z",
    });
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.recent[0]).toEqual({
      at: "2026-03-09T08:00:00.000Z",
      kind: "metric",
      domain: "labs",
      severity: "warning",
      reviewState: "needs_review",
      metricCode: "blood_marker_ldl",
    });
    expect(result.recent[1]?.metricCode).toBeNull();
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "SYNTHETIC_EVENT_TITLE",
      "SYNTHETIC_EVENT_SUMMARY",
      "SYNTHETIC_DEVICE_NAME",
      "SYNTHETIC_DIAGNOSIS",
      "consultation:1",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("an empty window is no_data", () => {
    expect(buildTimelineSummary([], false, WINDOW, FIXED_NOW)).toEqual({
      status: "no_data",
      windowDays: 30,
      from: "2026-02-08",
      to: FIXED_NOW.toISOString(),
      generatedAt: FIXED_NOW.toISOString(),
    });
  });
});

describe("timelineSummary execution", () => {
  test("asks only for the window and reports truncation honestly", async () => {
    const timeline = Array.from({ length: TIMELINE_SUMMARY_SCAN_LIMIT + 5 }, (_unused, index) =>
      timelineEntry(
        `health_event:${index + 1}`,
        new Date(FIXED_NOW.getTime() - index * 60_000).toISOString(),
      ),
    );
    timeline.push(timelineEntry("health_event:9999", "2025-01-01T00:00:00.000Z"));
    const { sources } = createFakeSources({ [ORG_A]: { timeline } });

    const result = await executeTimelineSummary(toolContext({ sources }), { days: 7 });

    expect(result).toMatchObject({
      status: "ok",
      windowDays: 7,
      from: "2026-03-03",
      entryCount: TIMELINE_SUMMARY_SCAN_LIMIT,
      truncated: true,
    });
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.recent).toHaveLength(TIMELINE_SUMMARY_RECENT_ITEMS);
  });
});
