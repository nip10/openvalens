// Snapshot contract from anchovy's clinical-export/build-bundle.ts, not timeline inference.
export type CanonicalTargetTable = "health_event" | "metric_sample";
export type CanonicalRecordRow = {
  table: CanonicalTargetTable;
  id: number;
  at: Date | string;
  canonicalSnapshot: Record<string, unknown>;
};
export type ProvenanceLinkRow = {
  targetTable: CanonicalTargetTable;
  targetId: number;
  sourceTable: string;
  sourceId: number;
  relation: string;
};
export type ClinicalExportBundle = {
  generation: {
    generatedAt: string;
    schemaVersion: string;
    organizationId: string;
    itemCount: number;
  };
  items: Array<{
    id: string;
    table: CanonicalTargetTable;
    at: string;
    canonicalSnapshot: Record<string, unknown>;
    provenanceLinks: Array<{ sourceTable: string; sourceId: number; relation: string }>;
  }>;
};
/** GET query semantics: default/nonfinite 200, truncate then clamp to [1, 500]. */
export function normalizeClinicalExportLimit(value?: number | string): number {
  const raw = Number(value ?? 200);
  return Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 500) : 200;
}
function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}
/** Internal pure assembly. Runtime API supplies neither records nor timestamps. */
export function selectCanonicalRecords(records: readonly CanonicalRecordRow[], limit: number) {
  return [...records]
    .sort(
      (left, right) =>
        toIso(right.at).localeCompare(toIso(left.at)) ||
        left.table.localeCompare(right.table) ||
        left.id - right.id,
    )
    .slice(0, limit);
}
export function buildClinicalExportBundle(
  organizationId: string,
  records: readonly CanonicalRecordRow[],
  links: readonly ProvenanceLinkRow[],
  now: Date,
): ClinicalExportBundle {
  const linksByTarget = new Map<string, ClinicalExportBundle["items"][number]["provenanceLinks"]>();
  for (const link of links) {
    const key = `${link.targetTable}:${link.targetId}`;
    const targetLinks = linksByTarget.get(key) ?? [];
    targetLinks.push({
      sourceTable: link.sourceTable,
      sourceId: link.sourceId,
      relation: link.relation,
    });
    linksByTarget.set(key, targetLinks);
  }
  const items = records.map((record) => ({
    id: `${record.table}:${record.id}`,
    table: record.table,
    at: toIso(record.at),
    canonicalSnapshot: record.canonicalSnapshot,
    provenanceLinks: [...(linksByTarget.get(`${record.table}:${record.id}`) ?? [])].sort(
      (left, right) =>
        left.sourceTable.localeCompare(right.sourceTable) ||
        left.sourceId - right.sourceId ||
        left.relation.localeCompare(right.relation),
    ),
  }));
  return {
    generation: {
      generatedAt: now.toISOString(),
      schemaVersion: "v2-clinical-export-v1",
      organizationId,
      itemCount: items.length,
    },
    items,
  };
}
