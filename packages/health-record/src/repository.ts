import type { Database } from "@openhealth/db";
import {
  dataSource,
  healthEvent,
  metricDefinition,
  metricSample,
  metricSourcePreference,
  ingestionRawArtifact,
  provenanceLink,
} from "@openhealth/db/schema/health-record";
import { weeklyReview } from "@openhealth/db/schema/plans";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { canonicalEvent, canonicalMetric } from "./canonical";
import { buildTimelinePage, normalizeTimelineDateRange } from "./timeline";
import type { TimelineFilters, ProvenanceLinkInsert } from "./types";
import { buildTimelineChangeSummary } from "./changes-since-review";
import { createDomainTimelineReader } from "./domain-reader";
import { buildDomainTimelineItems } from "./timeline-adapters";
import {
  listActiveMetricCodes,
  listMetricDefinitions,
  listSourcePreferences,
  type TenantMetricDefinition,
  type TenantSourcePreferenceRow,
} from "./metric-loader";
import {
  resolveSourcePriorityList,
  type MetricSourcePriorityResolution,
  type SourcePreferenceRow,
} from "./source-priority";
import {
  encodePreferredSourcesForRow,
  sanitizeMetricSourcePreference,
} from "./source-preferences";

export const PROVENANCE_TABLES = [
  "health_event",
  "metric_sample",
  "ingestion_raw_artifact",
] as const;
export class ProvenanceReferenceError extends Error {
  constructor() {
    super("Referenced resource not found in the active organization.");
  }
}
export type HealthRecordRepository = ReturnType<typeof createHealthRecordRepository>;
export function createHealthRecordRepository(db: Database) {
  async function listTimeline(
    organizationId: string,
    filters: TimelineFilters = {},
    excludedIds: readonly string[] = [],
  ) {
    const { fromIso, toIso } = normalizeTimelineDateRange(filters);
    const sourceFields = {
      id: dataSource.id,
      displayName: dataSource.displayName,
      originalSourceName: dataSource.originalSourceName,
      sourceAppId: dataSource.sourceAppId,
      sourceType: dataSource.sourceType,
    };
    // Full org-scoped candidate scan is deliberate: derived filters must run BEFORE
    // pagination. SQL keyset/filter pushdown is a follow-up, not silent truncation.
    const [events, metrics, links, domainRows] = await Promise.all([
      db
        .select({
          id: healthEvent.id,
          eventAt: healthEvent.eventAt,
          eventType: healthEvent.eventType,
          title: healthEvent.title,
          payloadJson: healthEvent.payloadJson,
          dataSource: sourceFields,
        })
        .from(healthEvent)
        .leftJoin(
          dataSource,
          and(
            eq(dataSource.organizationId, organizationId),
            eq(healthEvent.dataSourceId, dataSource.id),
          ),
        )
        .where(
          and(
            eq(healthEvent.organizationId, organizationId),
            ...(fromIso ? [gte(healthEvent.eventAt, new Date(fromIso))] : []),
            ...(toIso ? [lte(healthEvent.eventAt, new Date(toIso))] : []),
          ),
        ),
      db
        .select({
          id: metricSample.id,
          sampledAt: metricSample.sampledAt,
          numericValue: metricSample.numericValue,
          textValue: metricSample.textValue,
          unit: metricSample.unit,
          metadataJson: metricSample.metadataJson,
          metricCode: metricDefinition.code,
          metricDisplayName: metricDefinition.displayName,
          metricCategory: metricDefinition.category,
          dataSource: sourceFields,
        })
        .from(metricSample)
        .leftJoin(
          metricDefinition,
          and(
            eq(metricDefinition.organizationId, organizationId),
            eq(metricSample.metricDefinitionId, metricDefinition.id),
          ),
        )
        .leftJoin(
          dataSource,
          and(
            eq(dataSource.organizationId, organizationId),
            eq(metricSample.dataSourceId, dataSource.id),
          ),
        )
        .where(
          and(
            eq(metricSample.organizationId, organizationId),
            ...(fromIso ? [gte(metricSample.sampledAt, new Date(fromIso))] : []),
            ...(toIso ? [lte(metricSample.sampledAt, new Date(toIso))] : []),
          ),
        ),
      db.select().from(provenanceLink).where(eq(provenanceLink.organizationId, organizationId)),
      createDomainTimelineReader(db).read(organizationId),
    ]);
    const items = [...events.map(canonicalEvent), ...metrics.map(canonicalMetric)];
    const linksByTarget = new Map<string, typeof links>();
    for (const link of links) {
      const key = `${link.targetTable}:${link.targetId}`;
      const targetLinks = linksByTarget.get(key) ?? [];
      targetLinks.push(link);
      linksByTarget.set(key, targetLinks);
    }
    for (const item of items) {
      item.provenanceRefs = (linksByTarget.get(item.id) ?? []).map(
        ({ sourceTable, sourceId, relation }) => ({ sourceTable, sourceId, relation }),
      );
      item.relatedRefs = item.provenanceRefs
        .filter((ref) => ref.sourceTable === "health_event" || ref.sourceTable === "metric_sample")
        .map((ref) => ({ table: ref.sourceTable, id: ref.sourceId, relation: ref.relation }));
    }
    const excluded = new Set(excludedIds);
    return buildTimelinePage(
      [...items, ...buildDomainTimelineItems(domainRows)].filter((item) => !excluded.has(item.id)),
      filters,
    );
  }
  return {
    listTimeline,
    // Preserve anchor's meaning: occurrence window since latest weekStart, NOT
    // a database mutation diff. No deleted/updated claims without history.
    async listChangesSinceReview(
      organizationId: string,
      options: { limit?: number; now?: Date } = {},
    ) {
      const [review] = await db
        .select({ id: weeklyReview.id, weekStart: weeklyReview.weekStart })
        .from(weeklyReview)
        .where(eq(weeklyReview.organizationId, organizationId))
        .orderBy(desc(weeklyReview.weekStart), desc(weeklyReview.id))
        .limit(1);
      const fallback = new Date(options.now ?? new Date());
      fallback.setUTCDate(fallback.getUTCDate() - 7);
      const from = review?.weekStart ?? fallback.toISOString().slice(0, 10);
      const limit = Math.min(200, Math.max(1, Math.trunc(options.limit ?? 50)));
      const page = await listTimeline(
        organizationId,
        { from, limit },
        review ? [`weekly_review:${review.id}`] : [],
      );
      return {
        since: {
          reviewId: review?.id ?? null,
          reviewDate: from,
          mode: review ? ("latest_review" as const) : ("fallback_window" as const),
        },
        summary: buildTimelineChangeSummary(page.items),
        page: { limit, hasMore: page.nextCursor !== null },
        items: page.items,
      };
    },
    async writeProvenanceLink(link: ProvenanceLinkInsert) {
      if (link.metadataJson != null)
        throw new Error("Provenance metadata is not supported by the current schema.");
      return db.transaction(async (tx) => {
        for (const ref of [
          { table: link.targetTable, id: link.targetId },
          { table: link.sourceTable, id: link.sourceId },
        ]) {
          const table =
            ref.table === "health_event"
              ? healthEvent
              : ref.table === "metric_sample"
                ? metricSample
                : ref.table === "ingestion_raw_artifact"
                  ? ingestionRawArtifact
                  : null;
          if (!table) throw new ProvenanceReferenceError();
          const [owned] = await tx
            .select({ id: table.id })
            .from(table)
            .where(and(eq(table.organizationId, link.organizationId), eq(table.id, ref.id)))
            .limit(1)
            .for("share");
          if (!owned) throw new ProvenanceReferenceError();
        }
        const [row] = await tx
          .insert(provenanceLink)
          .values({
            organizationId: link.organizationId,
            targetTable: link.targetTable,
            targetId: link.targetId,
            sourceTable: link.sourceTable,
            sourceId: link.sourceId,
            relation: link.relation,
          })
          .returning();
        if (!row) throw new Error("Provenance insert returned no row.");
        return { ...row, createdAt: row.createdAt.toISOString() };
      });
    },
    /**
     * Read the tenant-scoped metric catalog. Pure read — no
     * mutations. The taxonomy module owns the canonical codes; this
     * method intersects with the active tenant rows.
     */
    async listMetrics(organizationId: string) {
      return listMetricDefinitions(db, organizationId);
    },
    /**
     * Resolve per-metric source-priority for the active org. Combines
     * the org-level (family-history) and user-level (manual override)
     * rows with the default orders.
     */
    async listSourcePriority(organizationId: string, userId: string) {
      const [catalog, preferences] = await Promise.all([
        listActiveMetricCodes(db, organizationId),
        listSourcePreferences(db, organizationId, userId),
      ]);
      return resolveSourcePriorityForCatalog(catalog, preferences);
    },
    /**
     * Upsert a tenant's metric source preference. The preference is
     * scoped by `userId` (when non-null) or by `organizationId`
     * (family-history) — the unique index on `(organizationId,
     * metricCode)` / `(organizationId, userId, metricCode)` enforces
     * that. Returns the inserted/updated row.
     *
     * The metric code must exist for the active tenant — the schema
     * foreign-key constraint enforces the catalog membership, and we
     * surface a `NOT_FOUND` error to the API when the metric is
     * missing.
     */
    async upsertSourcePreference(input: {
      organizationId: string;
      userId: string;
      metricCode: string;
      preferredSources: readonly string[];
    }) {
      const sanitized = sanitizeMetricSourcePreference({
        metricCode: input.metricCode,
        preferredSources: input.preferredSources,
      });
      if (!sanitized) throw new SourcePreferenceValidationError();
      const [definition] = await db
        .select({ id: metricDefinition.id, code: metricDefinition.code })
        .from(metricDefinition)
        .where(
          and(
            eq(metricDefinition.organizationId, input.organizationId),
            eq(metricDefinition.code, sanitized.canonicalMetricCode),
          ),
        )
        .limit(1);
      if (!definition) throw new SourcePreferenceValidationError("metric_not_found");
      const encoded = encodePreferredSourcesForRow(sanitized.preferredSources);
      const [row] = await db
        .insert(metricSourcePreference)
        .values({
          organizationId: input.organizationId,
          userId: input.userId,
          metricCode: sanitized.canonicalMetricCode,
          preferredSources: [...encoded],
        })
        .onConflictDoUpdate({
          target: [
            metricSourcePreference.organizationId,
            metricSourcePreference.userId,
            metricSourcePreference.metricCode,
          ],
          targetWhere: sql`${metricSourcePreference.userId} IS NOT NULL`,
          set: {
            preferredSources: [...encoded],
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!row) throw new SourcePreferenceValidationError("insert_returned_no_row");
      return {
        id: row.id,
        metricCode: row.metricCode,
        userId: row.userId,
        preferredSources: Array.isArray(row.preferredSources) ? row.preferredSources : [],
        scope: row.userId === null ? ("organization" as const) : ("user" as const),
        updatedAt: row.updatedAt.toISOString(),
      };
    },
    /**
     * Delete a tenant's metric source preference (user-scoped or
     * family-history entry). Returns `true` when a row was removed,
     * `false` when the row was already absent. The caller still audits
     * — the audit row is the durable record, not the DB row.
     */
    async deleteSourcePreference(input: {
      organizationId: string;
      userId: string;
      metricCode: string;
    }) {
      const target = await db
        .delete(metricSourcePreference)
        .where(
          and(
            eq(metricSourcePreference.organizationId, input.organizationId),
            eq(metricSourcePreference.userId, input.userId),
            eq(metricSourcePreference.metricCode, input.metricCode),
          ),
        )
        .returning({ id: metricSourcePreference.id });
      if (target.length > 0) return { removed: true as const, ids: target.map((row) => row.id) };
      const familyRow = await db
        .delete(metricSourcePreference)
        .where(
          and(
            eq(metricSourcePreference.organizationId, input.organizationId),
            isNull(metricSourcePreference.userId),
            eq(metricSourcePreference.metricCode, input.metricCode),
          ),
        )
        .returning({ id: metricSourcePreference.id });
      return {
        removed: familyRow.length > 0,
        ids: familyRow.map((row) => row.id),
      };
    },
  };
}

export class SourcePreferenceValidationError extends Error {
  readonly code: string;
  constructor(code = "invalid_source_preference") {
    super("Invalid metric source preference payload.");
    this.code = code;
  }
}

export type SourcePreferenceRowWithScope = SourcePreferenceRow;
export type SourcePriorityResolution = MetricSourcePriorityResolution;
export type TenantMetricDefinitionRead = TenantMetricDefinition;
export type TenantSourcePreferenceRead = TenantSourcePreferenceRow;

function resolveSourcePriorityForCatalog(
  catalog: readonly string[],
  preferences: readonly TenantSourcePreferenceRow[],
): MetricSourcePriorityResolution[] {
  const rows: SourcePreferenceRow[] = preferences.map((row) => ({
    metricCode: row.metricCode,
    scope: row.scope,
    preferredSources: row.preferredSources,
  }));
  const userRows = rows.filter((row) => row.scope === "user");
  const organizationRows = rows.filter((row) => row.scope === "organization");
  return resolveSourcePriorityList(catalog, { organizationRows, userRows });
}
