import type { Database } from "@openvalens/db";
import {
  healthEvent,
  metricSample,
  metricDefinition,
  dataSource,
  provenanceLink,
  ingestionRawArtifact,
} from "@openvalens/db/schema/health-record";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  buildClinicalExportBundle,
  normalizeClinicalExportLimit,
  selectCanonicalRecords,
  type CanonicalRecordRow,
} from "./build-bundle";

/** Read-only boundary. Organization authority must come from the records:read guard. */
export function createClinicalExportRepository(db: Database) {
  return {
    async buildBundle(
      organizationId: string,
      options: { limit?: number; now?: Date; userId?: string } = {},
    ) {
      const limit = normalizeClinicalExportLimit(options.limit);
      return db.transaction(
        async (tx) => {
          const [events, metrics] = await Promise.all([
            tx
              .select({
                id: healthEvent.id,
                at: healthEvent.eventAt,
                eventType: healthEvent.eventType,
                title: healthEvent.title,
                payloadJson: healthEvent.payloadJson,
              })
              .from(healthEvent)
              .where(
                and(
                  eq(healthEvent.organizationId, organizationId),
                  isNull(healthEvent.supersededAt),
                  sql`(${healthEvent.dataSourceId} is null or exists (
              select 1 from ${dataSource} where ${dataSource.id} = ${healthEvent.dataSourceId}
              and ${dataSource.organizationId} = ${organizationId}))`,
                ),
              )
              .orderBy(desc(healthEvent.eventAt), asc(healthEvent.id))
              .limit(limit),
            tx
              .select({
                id: metricSample.id,
                at: metricSample.sampledAt,
                metricDefinitionId: metricSample.metricDefinitionId,
                numericValue: metricSample.numericValue,
                textValue: metricSample.textValue,
                unit: metricSample.unit,
                metadataJson: metricSample.metadataJson,
              })
              .from(metricSample)
              .where(
                and(
                  eq(metricSample.organizationId, organizationId),
                  isNull(metricSample.supersededAt),
                  sql`exists (select 1 from ${metricDefinition}
              where ${metricDefinition.id} = ${metricSample.metricDefinitionId}
              and ${metricDefinition.organizationId} = ${organizationId})`,
                  sql`(${metricSample.dataSourceId} is null or exists (
              select 1 from ${dataSource} where ${dataSource.id} = ${metricSample.dataSourceId}
              and ${dataSource.organizationId} = ${organizationId}))`,
                ),
              )
              .orderBy(desc(metricSample.sampledAt), asc(metricSample.id))
              .limit(limit),
          ]);
          // Each bounded source query uses the same numeric tie-break as this merge.
          const candidates: CanonicalRecordRow[] = [
            ...events.map((event) => ({
              table: "health_event" as const,
              id: event.id,
              at: event.at,
              canonicalSnapshot: {
                eventType: event.eventType,
                title: event.title,
                payload: event.payloadJson,
              },
            })),
            ...metrics.map((metric) => ({
              table: "metric_sample" as const,
              id: metric.id,
              at: metric.at,
              canonicalSnapshot: {
                metricDefinitionId: metric.metricDefinitionId,
                value: metric.numericValue ?? metric.textValue,
                unit: metric.unit,
                metadata: metric.metadataJson,
              },
            })),
          ];
          const records = selectCanonicalRecords(candidates, limit);
          if (!records.length)
            return buildClinicalExportBundle(organizationId, [], [], options.now ?? new Date());
          const eventIds = records.filter((r) => r.table === "health_event").map((r) => r.id);
          const metricIds = records.filter((r) => r.table === "metric_sample").map((r) => r.id);
          const links = await tx
            .select({
              targetTable: provenanceLink.targetTable,
              targetId: provenanceLink.targetId,
              sourceTable: provenanceLink.sourceTable,
              sourceId: provenanceLink.sourceId,
              relation: provenanceLink.relation,
            })
            .from(provenanceLink)
            .where(
              and(
                eq(provenanceLink.organizationId, organizationId),
                or(
                  ...(eventIds.length
                    ? [
                        and(
                          eq(provenanceLink.targetTable, "health_event"),
                          inArray(provenanceLink.targetId, eventIds),
                        ),
                      ]
                    : []),
                  ...(metricIds.length
                    ? [
                        and(
                          eq(provenanceLink.targetTable, "metric_sample"),
                          inArray(provenanceLink.targetId, metricIds),
                        ),
                      ]
                    : []),
                ),
                // Polymorphic provenance has no reference FK. Fail closed for dangling,
                // foreign or unsupported source tables; never dereference their payloads.
                or(
                  and(
                    eq(provenanceLink.sourceTable, "health_event"),
                    sql`exists (
              select 1 from ${healthEvent} where ${healthEvent.id} = ${provenanceLink.sourceId}
              and ${healthEvent.organizationId} = ${organizationId})`,
                  ),
                  and(
                    eq(provenanceLink.sourceTable, "metric_sample"),
                    sql`exists (
              select 1 from ${metricSample} where ${metricSample.id} = ${provenanceLink.sourceId}
              and ${metricSample.organizationId} = ${organizationId})`,
                  ),
                  and(
                    eq(provenanceLink.sourceTable, "ingestion_raw_artifact"),
                    sql`exists (
              select 1 from ${ingestionRawArtifact} where ${ingestionRawArtifact.id} = ${provenanceLink.sourceId}
              and ${ingestionRawArtifact.organizationId} = ${organizationId})`,
                  ),
                ),
              ),
            );
          // Target predicate above admits only these literal table names.
          return buildClinicalExportBundle(
            organizationId,
            records,
            links.map((link) => ({
              ...link,
              targetTable: link.targetTable === "health_event" ? "health_event" : "metric_sample",
            })),
            options.now ?? new Date(),
          );
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  };
}
