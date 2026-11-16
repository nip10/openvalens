import type { Database } from "@openvalens/db";
import { metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import { and, desc, eq, isNull, like, sql } from "drizzle-orm";

import { referenceRangeFromSample } from "./reference-range";
import type { LabMarkerHistory, LabMarkerLatest } from "./types";

const BLOOD_MARKER_PREFIX = "blood_marker_";

/**
 * For each lab marker (metric definition starting with `blood_marker_`),
 * return the latest sample and a small recent series. Markers the tenant
 * has defined but never written a sample for are included with
 * `latestValue = null`. Excludes superseded rows. The latest reading carries
 * the lab's own reference range when one was stored with it.
 */
export async function listLabMarkerLatest(
  db: Database,
  organizationId: string,
  recentLimit: number,
): Promise<LabMarkerLatest[]> {
  const safeLimit = Math.max(2, Math.min(60, Math.floor(recentLimit)));

  const definitions = await db
    .select({
      code: metricDefinition.code,
      displayName: metricDefinition.displayName,
      unit: metricDefinition.unit,
      defId: metricDefinition.id,
    })
    .from(metricDefinition)
    .where(
      and(
        eq(metricDefinition.organizationId, organizationId),
        like(metricDefinition.code, `${BLOOD_MARKER_PREFIX}%`),
      ),
    );

  const results: LabMarkerLatest[] = [];

  for (const def of definitions) {
    const samples = await db
      .select({
        sampledAt: metricSample.sampledAt,
        numericValue: metricSample.numericValue,
        unit: metricSample.unit,
        metadataJson: metricSample.metadataJson,
      })
      .from(metricSample)
      .where(
        and(
          eq(metricSample.organizationId, organizationId),
          eq(metricSample.metricDefinitionId, def.defId),
          isNull(metricSample.supersededAt),
          sql`${metricSample.numericValue} IS NOT NULL`,
        ),
      )
      .orderBy(desc(metricSample.sampledAt), desc(metricSample.id))
      .limit(safeLimit);

    const withValue = samples.filter(
      (s): s is typeof s & { numericValue: number } => s.numericValue !== null,
    );
    const numeric = withValue.map((s) => ({
      sampledAt: s.sampledAt.toISOString(),
      value: s.numericValue,
    }));

    const latest = numeric[0];
    const latestRow = withValue[0];
    results.push({
      code: def.code,
      displayName: def.displayName,
      unit: def.unit,
      latestValue: latest?.value ?? null,
      latestSampledAt: latest?.sampledAt ?? null,
      sampleCount: numeric.length,
      recentValues: [...numeric].reverse(),
      referenceRange: latestRow
        ? referenceRangeFromSample(latestRow.metadataJson, latestRow.unit, def.unit)
        : null,
    });
  }

  // Stable order: markers with readings first (newest reading first), then
  // empty markers alphabetically by display name.
  return results.sort((a, b) => {
    if (a.latestSampledAt && b.latestSampledAt) {
      return a.latestSampledAt < b.latestSampledAt
        ? 1
        : a.latestSampledAt > b.latestSampledAt
          ? -1
          : 0;
    }
    if (a.latestSampledAt) return -1;
    if (b.latestSampledAt) return 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

/** Most readings one history returns; a marker with more drops the oldest. */
export const LAB_HISTORY_LIMIT = 500;

/**
 * Every reading of one lab marker for the workspace, oldest first, each with
 * the lab's own range stored with it. Superseded rows are left out. Returns
 * `null` when the workspace has no such marker, so another workspace's
 * marker code reads as missing rather than empty.
 */
export async function listLabMarkerHistory(
  db: Database,
  organizationId: string,
  code: string,
  limit: number = LAB_HISTORY_LIMIT,
): Promise<LabMarkerHistory | null> {
  if (!code.startsWith(BLOOD_MARKER_PREFIX)) return null;
  const safeLimit = Math.max(1, Math.min(LAB_HISTORY_LIMIT, Math.floor(limit)));
  const [def] = await db
    .select({
      code: metricDefinition.code,
      displayName: metricDefinition.displayName,
      unit: metricDefinition.unit,
      defId: metricDefinition.id,
    })
    .from(metricDefinition)
    .where(
      and(eq(metricDefinition.organizationId, organizationId), eq(metricDefinition.code, code)),
    )
    .limit(1);
  if (!def) return null;

  const samples = await db
    .select({
      sampledAt: metricSample.sampledAt,
      numericValue: metricSample.numericValue,
      unit: metricSample.unit,
      metadataJson: metricSample.metadataJson,
    })
    .from(metricSample)
    .where(
      and(
        eq(metricSample.organizationId, organizationId),
        eq(metricSample.metricDefinitionId, def.defId),
        isNull(metricSample.supersededAt),
        sql`${metricSample.numericValue} IS NOT NULL`,
      ),
    )
    .orderBy(desc(metricSample.sampledAt), desc(metricSample.id))
    .limit(safeLimit + 1);

  const readings = samples
    .slice(0, safeLimit)
    .filter((s): s is typeof s & { numericValue: number } => s.numericValue !== null)
    .map((s) => ({
      sampledAt: s.sampledAt.toISOString(),
      value: s.numericValue,
      referenceRange: referenceRangeFromSample(s.metadataJson, s.unit, def.unit),
    }))
    .reverse();
  return {
    code: def.code,
    displayName: def.displayName,
    unit: def.unit,
    readings,
    truncated: samples.length > safeLimit,
  };
}
