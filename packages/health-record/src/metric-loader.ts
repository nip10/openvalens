/**
 * Metric catalog + source-preference loaders (Issue #17 — bounded read-side).
 *
 * Repository methods that read the tenant-scoped metric catalog and
 * source-preference rows. Pure delegation: every query is filtered by
 * `organizationId`, the schema's foreign-key constraints already
 * enforce that metric codes exist for the org, and source preferences
 * use the unique `(organizationId, metricCode)` /
 * `(organizationId, userId, metricCode)` indexes.
 *
 * No mutation lives here — the API layer composes the writes through
 * `repository.upsertSourcePreference` and
 * `repository.deleteSourcePreference`.
 */

import type { Database } from "@openhealth/db";
import {
  dataSource,
  metricDefinition,
  metricSourcePreference,
} from "@openhealth/db/schema/health-record";
import { and, eq, isNull } from "drizzle-orm";

import {
  canonicalizeMetricCode,
  getMetricDefinition,
  isBloodMarkerFamilyCode,
  isCanonicalMetricCode,
  type CanonicalMetricDefinition,
} from "./metric-taxonomy";

export type TenantMetricDefinitionRow = {
  id: number;
  code: string;
  displayName: string;
  category: string | null;
  unit: string | null;
  valueType: string;
  aggregationDefault: string | null;
  isActive: boolean;
};

export type TenantMetricDefinition = TenantMetricDefinitionRow & {
  canonicalMetricCode: string;
  isBloodMarkerFamily: boolean;
  taxonomy: CanonicalMetricDefinition | null;
};

export type TenantSourcePreferenceRow = {
  id: number;
  metricCode: string;
  userId: string | null;
  preferredSources: string[];
  scope: "organization" | "user";
};

/**
 * Read the active org's metric catalog (tenant-filtered, active rows
 * only). Returns the public-facing `TenantMetricDefinition` shape used
 * by the API and the source-priority resolver.
 */
export async function listMetricDefinitions(
  db: Database,
  organizationId: string,
): Promise<TenantMetricDefinition[]> {
  const rows = await db
    .select({
      id: metricDefinition.id,
      code: metricDefinition.code,
      displayName: metricDefinition.displayName,
      category: metricDefinition.category,
      unit: metricDefinition.unit,
      valueType: metricDefinition.valueType,
      aggregationDefault: metricDefinition.aggregationDefault,
      isActive: metricDefinition.isActive,
    })
    .from(metricDefinition)
    .where(
      and(eq(metricDefinition.organizationId, organizationId), eq(metricDefinition.isActive, true)),
    );

  return rows.map((row) => decorateMetricDefinitionRow(row));
}

/**
 * Read the active org's `metric_source_preference` rows for both
 * scopes (org + user). The resolver downstream keys by canonical metric
 * code; we expose both raw rows and the `scope` discriminator so the
 * caller can also audit how many rows were loaded.
 */
export async function listSourcePreferences(
  db: Database,
  organizationId: string,
  userId: string,
): Promise<TenantSourcePreferenceRow[]> {
  const rows = await db
    .select({
      id: metricSourcePreference.id,
      metricCode: metricSourcePreference.metricCode,
      userId: metricSourcePreference.userId,
      preferredSources: metricSourcePreference.preferredSources,
    })
    .from(metricSourcePreference)
    .where(eq(metricSourcePreference.organizationId, organizationId));

  return rows
    .filter((row) => row.userId === null || row.userId === userId)
    .map((row) => ({
      id: row.id,
      metricCode: row.metricCode,
      userId: row.userId,
      preferredSources: Array.isArray(row.preferredSources) ? row.preferredSources : [],
      scope: row.userId === null ? ("organization" as const) : ("user" as const),
    }));
}

/**
 * Read just the org-scoped (family-history) preferences for the active
 * tenant. Used when the caller only wants the org layer.
 */
export async function listOrganizationSourcePreferences(
  db: Database,
  organizationId: string,
): Promise<TenantSourcePreferenceRow[]> {
  const rows = await db
    .select({
      id: metricSourcePreference.id,
      metricCode: metricSourcePreference.metricCode,
      userId: metricSourcePreference.userId,
      preferredSources: metricSourcePreference.preferredSources,
    })
    .from(metricSourcePreference)
    .where(
      and(
        eq(metricSourcePreference.organizationId, organizationId),
        isNull(metricSourcePreference.userId),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    metricCode: row.metricCode,
    userId: null,
    preferredSources: Array.isArray(row.preferredSources) ? row.preferredSources : [],
    scope: "organization" as const,
  }));
}

/**
 * Convenience loader: returns the catalog of metric codes the active
 * org has registered. The taxonomy module owns the canonical list;
 * this loader intersects with the tenant DB so we never expose a
 * definition the tenant hasn't opted in to.
 */
export async function listActiveMetricCodes(
  db: Database,
  organizationId: string,
): Promise<string[]> {
  const definitions = await listMetricDefinitions(db, organizationId);
  return definitions.map((definition) => definition.code);
}

/**
 * Read the tenant's data sources for a metric code. Currently the
 * `metric_sample` rows don't link to a `metric_definition` ↔
 * `data_source` join directly; we keep this helper for callers that
 * want the per-metric source vocabulary from the registered
 * `data_source` rows.
 *
 * For the bounded read-side scope, this is not on the read path —
 * timeline adapters don't join through `data_source.source_type`. The
 * loader is exported for downstream packages that need the org's
 * declared sources.
 */
export async function listMetricSources(
  db: Database,
  organizationId: string,
  _metricCode: string,
): Promise<Array<{ id: number; sourceType: string; sourceKey: string }>> {
  void _metricCode;
  const rows = await db
    .select({
      id: dataSource.id,
      sourceType: dataSource.sourceType,
      sourceKey: dataSource.sourceKey,
    })
    .from(dataSource)
    .where(and(eq(dataSource.organizationId, organizationId), eq(dataSource.isActive, true)));
  return rows;
}

export function decorateMetricDefinitionRow(
  row: TenantMetricDefinitionRow,
): TenantMetricDefinition {
  const canonical = canonicalizeMetricCode(row.code);
  const taxonomy = getMetricDefinition(canonical) ?? null;
  return {
    ...row,
    canonicalMetricCode: canonical,
    isBloodMarkerFamily: isBloodMarkerFamilyCode(canonical),
    taxonomy,
  };
}

export function isCanonicalRow(row: TenantMetricDefinitionRow): boolean {
  return isCanonicalMetricCode(canonicalizeMetricCode(row.code));
}
