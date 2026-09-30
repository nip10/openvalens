import { expect, test } from "bun:test";
import { formatTimelineRefLabel, resolveTimelineRefHref } from "./timeline-links";
test("anchor reference dashboard paths, fallback and domain-independent canonical refs", () => {
  for (const [table, href] of Object.entries({
    blood_marker: "/blood",
    dexa_scan: "/body",
    body_composition: "/body",
    weight: "/body",
    weight_entry: "/body",
    cardiac_exam: "/cardiac",
    imaging_study: "/imaging",
    weekly_review: "/reports/weekly",
    scheduled_event: "/calendar",
    daily_reminder: "/calendar",
    metric_sample: "/records/timeline",
    health_event: "/records/timeline",
  })) {
    expect(resolveTimelineRefHref({ table, id: 3 })).toBe(href);
    expect(resolveTimelineRefHref({ sourceTable: table, sourceId: 3 })).toBe(href);
    expect(resolveTimelineRefHref({ type: "source_record", label: `${table}:3`, id: 3 })).toBe(
      href,
    );
  }
  expect(resolveTimelineRefHref({ table: "blood_panel", id: 42 })).toBe("/blood/42");
  expect(resolveTimelineRefHref({ table: "blood_panel" })).toBe("/blood");
  expect(resolveTimelineRefHref({ table: "consultation", id: 1 })).toBeNull();
  expect(resolveTimelineRefHref({ table: "insight", id: 1 })).toBeNull();
  expect(resolveTimelineRefHref({ table: "unknown", id: 1 })).toBeNull();
  expect(resolveTimelineRefHref({ table: "__proto__", id: 1 })).toBeNull();
  expect(resolveTimelineRefHref({ table: "constructor", id: 1 })).toBeNull();
  expect(resolveTimelineRefHref({ table: "metric_sample", id: 9 }, { domain: "labs" })).toBe(
    "/records/timeline",
  );
  expect(resolveTimelineRefHref({ table: "health_event", id: 10 }, { domain: "activity" })).toBe(
    "/records/timeline",
  );
});
test("anchor ref labels preserve source-file labels and table/ID fallbacks", () => {
  expect(formatTimelineRefLabel({ table: "cardiac_exam", id: 3, relation: "source_record" })).toBe(
    "cardiac_exam #3",
  );
  expect(formatTimelineRefLabel({ sourceTable: "insight", sourceId: 5 })).toBe("insight #5");
  expect(formatTimelineRefLabel({ type: "source_file", label: "mri.pdf" })).toBe("mri.pdf");
  expect(formatTimelineRefLabel({ type: "data_source" })).toBe("data_source");
  expect(formatTimelineRefLabel({})).toBe("Unknown reference");
});
