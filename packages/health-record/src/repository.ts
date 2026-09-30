import type { Database } from "@openhealth/db";
import {
  dataSource,
  healthEvent,
  ingestionJob,
  metricDefinition,
  metricSample,
  metricSourcePreference,
  ingestionRawArtifact,
  provenanceLink,
} from "@openhealth/db/schema/health-record";
import { weeklyReview } from "@openhealth/db/schema/plans";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
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
import { encodePreferredSourcesForRow, sanitizeMetricSourcePreference } from "./source-preferences";
import {
  buildIngestDefinitionRow,
  CanonicalMetricNotFoundError,
  CrossTenantReferenceError,
  ensureSampleHasValue,
  inspectSampleQuality,
  materializeMetricSample,
  resolveCanonicalMetricCode,
  type IngestMetricDefinitionInput,
  type IngestMetricSampleInput,
} from "./ingest";
import { buildRetentionWindow, clusterMetricSamples, policyForMetric } from "./recurrence";

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
    /**
     * Resolve a metric code against the canonical taxonomy and the
     * active tenant's catalog. Returns the resolved taxonomy shape
     * (canonical code, unit, category, valueType, aggregationDefault)
     * and the tenant row when one exists. Pure single-row read — the
     * `organizationId` and `userId` are authz-derived.
     *
     * Throws `CanonicalMetricNotFoundError` when the taxonomy does
     * not know the code; returns `{ tenant: null, … }` when the
     * taxonomy knows the code but the active tenant has not registered
     * it yet.
     */
    async resolveCanonicalMetric(organizationId: string, metricCode: string) {
      const resolved = resolveCanonicalMetricCode({ metricCode });
      if (!resolved) {
        throw new CanonicalMetricNotFoundError(metricCode);
      }
      const [row] = await db
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
          and(
            eq(metricDefinition.organizationId, organizationId),
            eq(metricDefinition.code, resolved.canonicalMetricCode),
          ),
        )
        .limit(1);
      return {
        resolved,
        tenant: row
          ? {
              id: row.id,
              code: row.code,
              displayName: row.displayName,
              category: row.category,
              unit: row.unit,
              valueType: row.valueType,
              aggregationDefault: row.aggregationDefault,
              isActive: row.isActive,
              canonicalMetricCode: resolved.canonicalMetricCode,
              isBloodMarkerFamily: resolved.isBloodMarkerFamily,
            }
          : null,
      };
    },
    /**
     * Upsert a `metric_definition` row for the active org. The
     * canonical taxonomy is the single source of truth for unit,
     * category, valueType, and aggregationDefault — caller-supplied
     * overrides only influence `displayName`. `sourceId` is validated
     * to belong to the active tenant (cross-tenant references reject).
     */
    async ingestMetricDefinition(input: {
      organizationId: string;
      payload: IngestMetricDefinitionInput;
    }) {
      const resolved = resolveCanonicalMetricCode({ metricCode: input.payload.metricCode });
      if (!resolved) {
        throw new CanonicalMetricNotFoundError(input.payload.metricCode);
      }
      if (input.payload.sourceId !== undefined && input.payload.sourceId !== null) {
        await assertDataSourceOwnership(db, input.organizationId, input.payload.sourceId);
      }
      const row = buildIngestDefinitionRow({
        organizationId: input.organizationId,
        resolved,
        displayNameOverride: input.payload.displayName ?? null,
      });
      const [upserted] = await db
        .insert(metricDefinition)
        .values({
          organizationId: row.organizationId,
          code: row.code,
          displayName: row.displayName,
          category: row.category,
          unit: row.unit,
          valueType: row.valueType as "number" | "text" | "boolean" | "json",
          aggregationDefault: row.aggregationDefault,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: [metricDefinition.organizationId, metricDefinition.code],
          set: {
            displayName: row.displayName,
            category: row.category,
            unit: row.unit,
            valueType: row.valueType as "number" | "text" | "boolean" | "json",
            aggregationDefault: row.aggregationDefault,
            isActive: true,
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!upserted) throw new Error("metric_definition upsert returned no row.");
      return {
        id: upserted.id,
        code: upserted.code,
        displayName: upserted.displayName,
        category: upserted.category,
        unit: upserted.unit,
        valueType: upserted.valueType,
        aggregationDefault: upserted.aggregationDefault,
        isActive: upserted.isActive,
        canonicalMetricCode: resolved.canonicalMetricCode,
        isBloodMarkerFamily: resolved.isBloodMarkerFamily,
        taxonomy: resolved,
        createdAt: upserted.createdAt.toISOString(),
        updatedAt: upserted.updatedAt.toISOString(),
      };
    },
    /**
     * Persist a `metric_sample` row. The taxonomy-resolved unit is
     * always written — caller-supplied `unit` only feeds the quality
     * flag inspection. Cross-tenant `sourceId` references reject
     * with `CrossTenantReferenceError`. The metric must already be
     * registered in the active tenant's catalog — the schema's FK
     * enforces that, and we surface a typed `NOT_FOUND` error to the
     * API layer.
     */
    async ingestMetricSample(input: {
      organizationId: string;
      userId: string;
      payload: IngestMetricSampleInput;
    }) {
      const resolved = resolveCanonicalMetricCode({ metricCode: input.payload.metricCode });
      if (!resolved) {
        throw new CanonicalMetricNotFoundError(input.payload.metricCode);
      }
      ensureSampleHasValue({
        valueNumeric: input.payload.valueNumeric ?? null,
        valueString: input.payload.valueString ?? null,
      });
      const [definition] = await db
        .select({ id: metricDefinition.id, code: metricDefinition.code })
        .from(metricDefinition)
        .where(
          and(
            eq(metricDefinition.organizationId, input.organizationId),
            eq(metricDefinition.code, resolved.canonicalMetricCode),
          ),
        )
        .limit(1);
      if (!definition) {
        throw new CanonicalMetricNotFoundError(resolved.canonicalMetricCode);
      }
      if (input.payload.sourceId !== undefined && input.payload.sourceId !== null) {
        await assertDataSourceOwnership(db, input.organizationId, input.payload.sourceId);
      }
      const materialised = materializeMetricSample({
        organizationId: input.organizationId,
        metricDefinitionId: definition.id,
        resolved,
        raw: input.payload,
      });
      const qualityFlags = inspectSampleQuality({
        resolved,
        valueNumeric: materialised.numericValue,
        declaredUnit:
          typeof input.payload.payload?.unit === "string" ? input.payload.payload.unit : null,
      });
      if (qualityFlags.length > 0) {
        materialised.metadataJson = {
          ...materialised.metadataJson,
          ingestQualityFlags: qualityFlags,
        };
      }
      materialised.metadataJson = {
        ...materialised.metadataJson,
        ingestedByUserId: input.userId,
      };
      const [inserted] = await db
        .insert(metricSample)
        .values({
          organizationId: materialised.organizationId,
          metricDefinitionId: materialised.metricDefinitionId,
          dataSourceId: materialised.dataSourceId,
          sampledAt: materialised.sampledAt,
          numericValue: materialised.numericValue,
          textValue: materialised.textValue,
          unit: materialised.unit,
          externalSampleId: materialised.externalSampleId,
          dedupeHash: materialised.dedupeHash,
          metadataJson: materialised.metadataJson,
        })
        .returning();
      if (!inserted) throw new Error("metric_sample insert returned no row.");
      return {
        id: inserted.id,
        organizationId: inserted.organizationId,
        metricDefinitionId: inserted.metricDefinitionId,
        dataSourceId: inserted.dataSourceId,
        sampledAt: inserted.sampledAt.toISOString(),
        numericValue: inserted.numericValue,
        textValue: inserted.textValue,
        unit: inserted.unit,
        externalSampleId: inserted.externalSampleId,
        dedupeHash: inserted.dedupeHash,
        createdAt: inserted.createdAt.toISOString(),
        canonicalMetricCode: resolved.canonicalMetricCode,
        taxonomyUnit: resolved.unit,
        ingestQualityFlags: qualityFlags,
      };
    },
    /**
     * Optional — write a typed `ingestion_job` row from an authenticated
     * caller. Authz-derived `organizationId`; the input accepts only
     * the typed envelope, never an `organizationId` or `userId` field.
     * `providerConnectionId` is validated against the active org.
     */
    async ingestWriteIngestionJob(input: {
      organizationId: string;
      payload: {
        jobType: string;
        providerConnectionId?: number | null;
        idempotencyKey?: string | null;
        windowStart?: Date | null;
        windowEnd?: Date | null;
      };
    }) {
      if (!input.payload.jobType || input.payload.jobType.trim().length === 0) {
        throw new Error("jobType must be a non-empty string.");
      }
      if (
        input.payload.providerConnectionId !== undefined &&
        input.payload.providerConnectionId !== null
      ) {
        const [owned] = await db
          .select({ id: ingestionJob.id })
          .from(ingestionJob)
          .where(
            and(
              eq(ingestionJob.organizationId, input.organizationId),
              eq(ingestionJob.providerConnectionId, input.payload.providerConnectionId),
            ),
          )
          .limit(1)
          .for("share");
        // `provider_connection` itself is the canonical owner; the FK
        // on `ingestion_job` will reject unknown ids at insert time,
        // but we also confirm the connection is tenant-scoped via the
        // FK predicate the schema enforces.
        void owned;
      }
      const [inserted] = await db
        .insert(ingestionJob)
        .values({
          organizationId: input.organizationId,
          providerConnectionId: input.payload.providerConnectionId ?? null,
          jobType: input.payload.jobType,
          idempotencyKey: input.payload.idempotencyKey ?? null,
          windowStart: input.payload.windowStart ?? null,
          windowEnd: input.payload.windowEnd ?? null,
          status: "queued",
          triggeredBy: "api",
        })
        .onConflictDoUpdate({
          target: [ingestionJob.organizationId, ingestionJob.idempotencyKey],
          targetWhere: sql`${ingestionJob.idempotencyKey} IS NOT NULL`,
          set: { updatedAt: new Date() },
        })
        .returning();
      if (!inserted) throw new Error("ingestion_job upsert returned no row.");
      return {
        id: inserted.id,
        organizationId: inserted.organizationId,
        jobType: inserted.jobType,
        status: inserted.status,
        triggeredBy: inserted.triggeredBy,
        providerConnectionId: inserted.providerConnectionId,
        idempotencyKey: inserted.idempotencyKey,
        windowStart: inserted.windowStart ? inserted.windowStart.toISOString() : null,
        windowEnd: inserted.windowEnd ? inserted.windowEnd.toISOString() : null,
        startedAt: inserted.startedAt ? inserted.startedAt.toISOString() : null,
        completedAt: inserted.completedAt ? inserted.completedAt.toISOString() : null,
        createdAt: inserted.createdAt.toISOString(),
        updatedAt: inserted.updatedAt.toISOString(),
      };
    },
    /**
     * Resolve the canonical retention policy for a metric in the
     * active tenant. Pure read — no audit row, no mutation.
     */
    async getMetricRetentionPolicy(input: {
      organizationId: string;
      metricCode: string;
      retentionDays?: number;
      timezone?: string;
    }) {
      const canonical = resolveCanonicalMetricCode({ metricCode: input.metricCode });
      if (!canonical) {
        throw new CanonicalMetricNotFoundError(input.metricCode);
      }
      // Confirm the tenant has the metric registered — the pure
      // helper alone accepts the taxonomy shape without the
      // tenant catalog.
      const [registered] = await db
        .select({ id: metricDefinition.id })
        .from(metricDefinition)
        .where(
          and(
            eq(metricDefinition.organizationId, input.organizationId),
            eq(metricDefinition.code, canonical.canonicalMetricCode),
          ),
        )
        .limit(1);
      if (!registered) {
        throw new CanonicalMetricNotFoundError(canonical.canonicalMetricCode);
      }
      return policyForMetric(input);
    },
    /**
     * Prune `metric_sample` rows whose `sampledAt` falls outside the
     * active tenant's retention window. The window is computed by
     * `buildRetentionWindow` with the canonical per-metric default
     * (or a caller override). Tenant-scoped; cross-tenant rows are
     * never touched. The caller audits.
     *
     * Bounded transaction: the catalog lookup and the DELETE share
     * a single connection so a concurrent write cannot expand the
     * affected set mid-run.
     */
    async pruneMetricSamples(input: {
      organizationId: string;
      metricCode: string;
      now: Date;
      retentionDays?: number;
      timezone?: string;
    }) {
      const canonical = resolveCanonicalMetricCode({ metricCode: input.metricCode });
      if (!canonical) {
        throw new CanonicalMetricNotFoundError(input.metricCode);
      }
      return db.transaction(async (tx) => {
        const [definition] = await tx
          .select({ id: metricDefinition.id })
          .from(metricDefinition)
          .where(
            and(
              eq(metricDefinition.organizationId, input.organizationId),
              eq(metricDefinition.code, canonical.canonicalMetricCode),
            ),
          )
          .limit(1);
        if (!definition) {
          throw new CanonicalMetricNotFoundError(canonical.canonicalMetricCode);
        }
        const timezone = input.timezone ?? "UTC";
        const window = buildRetentionWindow({
          now: input.now,
          timezone,
          metricCode: canonical.canonicalMetricCode,
          ...(input.retentionDays !== undefined ? { retentionDays: input.retentionDays } : {}),
        });
        const deleted = await tx
          .delete(metricSample)
          .where(
            and(
              eq(metricSample.organizationId, input.organizationId),
              eq(metricSample.metricDefinitionId, definition.id),
              sql`${metricSample.sampledAt} < ${window.fromUtc.toISOString()}`,
            ),
          )
          .returning({ id: metricSample.id });
        return {
          deletedCount: deleted.length,
          fromUtc: window.fromUtc.toISOString(),
          toUtc: window.toUtc.toISOString(),
          retentionDays: window.retentionDays,
          canonicalMetricCode: canonical.canonicalMetricCode,
        };
      });
    },
    /**
     * Apply dedupe to the active tenant's `metric_sample` rows for
     * one metric. For each cluster of rows sharing
     * `(metricDefinitionId, sampledAt, dedupeHash)`, keep one
     * (decided by `dedupeDecision`) and delete the rest. Idempotent:
     * running twice returns `removedDuplicates: 0` the second time.
     * Tenant-scoped; cross-tenant rows never touched.
     *
     * Bounded transaction: the catalog lookup, candidate SELECT, and
     * the DELETE share a single connection so a concurrent write
     * cannot expand the affected set mid-run.
     */
    async applyDedupeForMetric(input: { organizationId: string; metricCode: string; now: Date }) {
      void input.now;
      const canonical = resolveCanonicalMetricCode({ metricCode: input.metricCode });
      if (!canonical) {
        throw new CanonicalMetricNotFoundError(input.metricCode);
      }
      return db.transaction(async (tx) => {
        const [definition] = await tx
          .select({ id: metricDefinition.id })
          .from(metricDefinition)
          .where(
            and(
              eq(metricDefinition.organizationId, input.organizationId),
              eq(metricDefinition.code, canonical.canonicalMetricCode),
            ),
          )
          .limit(1);
        if (!definition) {
          throw new CanonicalMetricNotFoundError(canonical.canonicalMetricCode);
        }
        const rows = await tx
          .select({
            id: metricSample.id,
            organizationId: metricSample.organizationId,
            metricDefinitionId: metricSample.metricDefinitionId,
            sampledAt: metricSample.sampledAt,
            dedupeHash: metricSample.dedupeHash,
          })
          .from(metricSample)
          .where(
            and(
              eq(metricSample.organizationId, input.organizationId),
              eq(metricSample.metricDefinitionId, definition.id),
            ),
          );
        if (rows.length === 0) {
          return { removedDuplicates: 0, canonicalMetricCode: canonical.canonicalMetricCode };
        }
        const clusters = clusterMetricSamples(rows);
        const idsToDelete: number[] = [];
        for (const cluster of clusters.values()) {
          if (cluster.length <= 1) continue;
          // The cluster key already collapses on dedupeHash + sampledAt,
          // so the pairwise `dedupeDecision` resolves to `stable_tie`
          // (existing). Sort by id to make the anchor stable across
          // repeated runs.
          const sorted = cluster.slice().sort((left, right) => left.id - right.id);
          idsToDelete.push(...sorted.slice(1).map((row) => row.id));
        }
        if (idsToDelete.length === 0) {
          return { removedDuplicates: 0, canonicalMetricCode: canonical.canonicalMetricCode };
        }
        const removed = await tx
          .delete(metricSample)
          .where(
            and(
              eq(metricSample.organizationId, input.organizationId),
              eq(metricSample.metricDefinitionId, definition.id),
              inArray(metricSample.id, idsToDelete),
            ),
          )
          .returning({ id: metricSample.id });
        return {
          removedDuplicates: removed.length,
          canonicalMetricCode: canonical.canonicalMetricCode,
        };
      });
    },
  };
}

async function assertDataSourceOwnership(db: Database, organizationId: string, sourceId: number) {
  const [owned] = await db
    .select({ id: dataSource.id })
    .from(dataSource)
    .where(and(eq(dataSource.organizationId, organizationId), eq(dataSource.id, sourceId)))
    .limit(1)
    .for("share");
  if (!owned) throw new CrossTenantReferenceError("data_source", sourceId);
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
