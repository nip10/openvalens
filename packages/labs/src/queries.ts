import type { Database } from "@openhealth/db";
import { metricDefinition, metricSample } from "@openhealth/db/schema/health-record";
import { and, desc, eq, isNull, like, sql } from "drizzle-orm";

import type { LabMarkerLatest } from "./types";

const BLOOD_MARKER_PREFIX = "blood_marker_";

/**
 * For each lab marker (metric definition starting with `blood_marker_`),
 * return the latest sample and a small recent series. Markers the tenant
 * has defined but never written a sample for are included with
 * `latestValue = null`. Excludes superseded rows.
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

    const numeric = samples
      .filter((s): s is typeof s & { numericValue: number } => s.numericValue !== null)
      .map((s) => ({
        sampledAt: s.sampledAt.toISOString(),
        value: s.numericValue,
      }));

    const latest = numeric[0];
    results.push({
      code: def.code,
      displayName: def.displayName,
      unit: def.unit,
      latestValue: latest?.value ?? null,
      latestSampledAt: latest?.sampledAt ?? null,
      sampleCount: numeric.length,
      recentValues: [...numeric].reverse(),
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
