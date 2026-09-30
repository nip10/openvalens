import type { ProvenanceLinkInsert, ProvenanceLinkRow } from "./types";

/**
 * Provenance writer (Issue #17, MVP).
 *
 * Reused pure link-intent helpers, not persistence. Actual writes are
 * performed by repository.writeProvenanceLink with ownership validation.
 *
 * Two helper factories:
 * - `createRawArtifactToCanonicalProvenanceLink` — links a raw
 *   ingest artifact (e.g. `ingestionRawArtifact`) to its
 *   canonicalised record (a `health_event` or `metric_sample`).
 * - `createCanonicalToDerivedProvenanceLink` — links a canonical
 *   record to a downstream projection (e.g. a derived
 *   `weight_event` from a canonical `daily_weight` row).
 *
 * The `ProvenanceLinkInsert` shape is the typed contract the ingest
 * package can call when it writes a new record. Org/user come from
 * authz; this shape carries the link payload only.
 *
 * Adapted from the anchor (not full projection-writer parity)
 * `anchovy/apps/web/src/lib/v2/health-record/provenance-writer.ts`.
 * Projection pseudo-tables and decision metadata may be expressed by these
 * legacy helpers but are rejected by the writer: they lack schema support.
 */

export type ProvenanceRelation = "derived_from_raw_artifact" | "derived_from" | "source_record";

export type ProvenanceTable = string;

export function createRawArtifactToCanonicalProvenanceLink(input: {
  organizationId: string;
  artifactId: number;
  canonicalTable: ProvenanceTable;
  canonicalId: number;
}): ProvenanceLinkInsert {
  return {
    organizationId: input.organizationId,
    targetTable: input.canonicalTable,
    targetId: input.canonicalId,
    sourceTable: "ingestion_raw_artifact",
    sourceId: input.artifactId,
    relation: "derived_from_raw_artifact",
  };
}

export function createCanonicalToDerivedProvenanceLink(input: {
  organizationId: string;
  canonicalTable: ProvenanceTable;
  canonicalId: number;
  derivedTable: ProvenanceTable;
  derivedId: number;
  relation:
    | Exclude<ProvenanceRelation, "derived_from_raw_artifact">
    | "preferred_source_projection"
    | "derived_projection";
  metadataJson?: Record<string, unknown> | null;
}): ProvenanceLinkInsert {
  return {
    organizationId: input.organizationId,
    targetTable: input.derivedTable,
    targetId: input.derivedId,
    sourceTable: input.canonicalTable,
    sourceId: input.canonicalId,
    relation: input.relation,
    metadataJson: input.metadataJson ?? null,
  };
}

/**
 * Normalize a serialized provenance row. The schema has no metadata column.
 */
export function normalizeProvenanceLinkRow(row: {
  id: number;
  organizationId: string;
  targetTable: string;
  targetId: number;
  sourceTable: string;
  sourceId: number;
  relation: string;
  createdAt: string;
}): ProvenanceLinkRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    targetTable: row.targetTable,
    targetId: row.targetId,
    sourceTable: row.sourceTable,
    sourceId: row.sourceId,
    relation: row.relation,
    createdAt: row.createdAt,
  };
}
