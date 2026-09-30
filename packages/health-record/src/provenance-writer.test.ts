import { describe, expect, test } from "bun:test";

import {
  createCanonicalToDerivedProvenanceLink,
  createRawArtifactToCanonicalProvenanceLink,
  normalizeProvenanceLinkRow,
} from "./provenance-writer";

describe("health-record — provenance writer helpers", () => {
  test("createRawArtifactToCanonicalProvenanceLink produces a derived_from_raw_artifact link", () => {
    const link = createRawArtifactToCanonicalProvenanceLink({
      organizationId: "org-1",
      artifactId: 7,
      canonicalTable: "metric_sample",
      canonicalId: 99,
    });
    expect(link).toEqual({
      organizationId: "org-1",
      targetTable: "metric_sample",
      targetId: 99,
      sourceTable: "ingestion_raw_artifact",
      sourceId: 7,
      relation: "derived_from_raw_artifact",
    });
  });

  test("createCanonicalToDerivedProvenanceLink preserves relation + metadata", () => {
    const link = createCanonicalToDerivedProvenanceLink({
      organizationId: "org-1",
      canonicalTable: "metric_sample",
      canonicalId: 99,
      derivedTable: "preferred_metric_sample",
      derivedId: 12,
      relation: "preferred_source_projection",
      metadataJson: {
        metricCode: "weight",
        winningRule: "source_priority_then_quality_then_recency",
      },
    });
    expect(link.relation).toBe("preferred_source_projection");
    expect(link.metadataJson).toMatchObject({ metricCode: "weight" });
    expect(link.targetTable).toBe("preferred_metric_sample");
    expect(link.targetId).toBe(12);
  });

  test("createCanonicalToDerivedProvenanceLink defaults metadata to null", () => {
    const link = createCanonicalToDerivedProvenanceLink({
      organizationId: "org-1",
      canonicalTable: "health_event",
      canonicalId: 100,
      derivedTable: "health_event_projection",
      derivedId: 200,
      relation: "derived_projection",
    });
    expect(link.metadataJson).toBeNull();
  });

  test("normalizeProvenanceLinkRow maps a Drizzle row to the public shape", () => {
    const row = normalizeProvenanceLinkRow({
      id: 1,
      organizationId: "org-1",
      targetTable: "metric_sample",
      targetId: 99,
      sourceTable: "ingestion_raw_artifact",
      sourceId: 7,
      relation: "derived_from_raw_artifact",
      createdAt: "2026-03-07T10:00:00.000Z",
    });
    expect(row).toEqual({
      id: 1,
      organizationId: "org-1",
      targetTable: "metric_sample",
      targetId: 99,
      sourceTable: "ingestion_raw_artifact",
      sourceId: 7,
      relation: "derived_from_raw_artifact",
      createdAt: "2026-03-07T10:00:00.000Z",
    });
  });
});
