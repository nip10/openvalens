import { expect, test } from "bun:test";
import {
  buildClinicalExportBundle,
  normalizeClinicalExportLimit,
  selectCanonicalRecords,
  type CanonicalRecordRow,
} from "./build-bundle";

const now = new Date("2026-03-08T09:30:00.000Z");
test("anchor generation metadata and empty bundle", () => {
  expect(buildClinicalExportBundle("org-1", [], [], now)).toEqual({
    generation: {
      generatedAt: "2026-03-08T09:30:00.000Z",
      schemaVersion: "v2-clinical-export-v1",
      organizationId: "org-1",
      itemCount: 0,
    },
    items: [],
  });
});
test("source GET default, nonfinite, truncation and clamp semantics", () => {
  expect(
    [undefined, "foo", "Infinity", NaN, Infinity, 0, -2, 9999, 12.8, "12.8", ""].map(
      normalizeClinicalExportLimit,
    ),
  ).toEqual([200, 200, 200, 200, 200, 1, 1, 500, 12, 12, 1]);
});
test("anchor snapshot fixture and Date/offset/invalid-string normalization", () => {
  const snapshots = [
    {
      metricDefinitionId: 11,
      value: 58,
      unit: "bpm",
      metadata: { source: "PRIVATE", nested: [1, null] },
    },
    { eventType: "workout", title: null, payload: { unknown: "PRIVATE" } },
  ];
  const records: CanonicalRecordRow[] = [
    {
      table: "metric_sample",
      id: 91,
      at: "2026-03-06T10:45:00+03:00",
      canonicalSnapshot: snapshots[0]!,
    },
    {
      table: "health_event",
      id: 22,
      at: new Date("2026-03-06T08:00:00Z"),
      canonicalSnapshot: snapshots[1]!,
    },
    { table: "health_event", id: 23, at: "bad", canonicalSnapshot: {} },
  ];
  const bundle = buildClinicalExportBundle(
    "org-1",
    records,
    [
      {
        targetTable: "metric_sample",
        targetId: 91,
        sourceTable: "health_connect_record",
        sourceId: 3001,
        relation: "derived_from",
      },
    ],
    now,
  );
  expect(bundle.generation.itemCount).toBe(3);
  expect(bundle.items.map((item) => item.at)).toEqual([
    "2026-03-06T07:45:00.000Z",
    "2026-03-06T08:00:00.000Z",
    "1970-01-01T00:00:00.000Z",
  ]);
  expect(bundle.items[0]).toEqual({
    id: "metric_sample:91",
    table: "metric_sample",
    at: "2026-03-06T07:45:00.000Z",
    canonicalSnapshot: snapshots[0]!,
    provenanceLinks: [
      { sourceTable: "health_connect_record", sourceId: 3001, relation: "derived_from" },
    ],
  });
  expect(bundle.items[1]?.canonicalSnapshot).toEqual(snapshots[1]!);
  expect(bundle.items[1]?.provenanceLinks).toEqual([]);
});
test("selected canonical IDs and provenance sorting retain table/ID identity", () => {
  const records: CanonicalRecordRow[] = [
    { table: "metric_sample", id: 91, at: now, canonicalSnapshot: { value: 58 } },
  ];
  const links = [
    {
      targetTable: "metric_sample" as const,
      targetId: 91,
      sourceTable: "health_connect_record",
      sourceId: 3002,
      relation: "derived_from",
    },
    {
      targetTable: "metric_sample" as const,
      targetId: 91,
      sourceTable: "apple_health_record",
      sourceId: 12,
      relation: "derived_from",
    },
    {
      targetTable: "metric_sample" as const,
      targetId: 91,
      sourceTable: "health_connect_record",
      sourceId: 3001,
      relation: "z",
    },
    {
      targetTable: "metric_sample" as const,
      targetId: 91,
      sourceTable: "health_connect_record",
      sourceId: 3001,
      relation: "derived_from",
    },
    {
      targetTable: "health_event" as const,
      targetId: 91,
      sourceTable: "wrong-target",
      sourceId: 1,
      relation: "derived_from",
    },
    {
      targetTable: "metric_sample" as const,
      targetId: 92,
      sourceTable: "unselected",
      sourceId: 1,
      relation: "derived_from",
    },
  ];
  expect(buildClinicalExportBundle("org-1", records, links, now).items[0]?.provenanceLinks).toEqual(
    [
      { sourceTable: "apple_health_record", sourceId: 12, relation: "derived_from" },
      { sourceTable: "health_connect_record", sourceId: 3001, relation: "derived_from" },
      { sourceTable: "health_connect_record", sourceId: 3001, relation: "z" },
      { sourceTable: "health_connect_record", sourceId: 3002, relation: "derived_from" },
    ],
  );
});
test("latest-first merge uses table then numeric ID for equal timestamps, not timeline lexical IDs", () => {
  const records: CanonicalRecordRow[] = [
    ...[10, 2, 1].map((id) => ({
      table: "metric_sample" as const,
      id,
      at: now,
      canonicalSnapshot: {},
    })),
    ...[10, 2, 1].map((id) => ({
      table: "health_event" as const,
      id,
      at: now.toISOString(),
      canonicalSnapshot: {},
    })),
    { table: "health_event", id: 99, at: "2025-01-01", canonicalSnapshot: {} },
  ];
  const selected = selectCanonicalRecords(records, 5);
  expect(selected.map((r) => `${r.table}:${r.id}`)).toEqual([
    "health_event:1",
    "health_event:2",
    "health_event:10",
    "metric_sample:1",
    "metric_sample:2",
  ]);
  expect(selectCanonicalRecords([...records].reverse(), 5)).toEqual(selected);
  expect(records).toHaveLength(7);
});
