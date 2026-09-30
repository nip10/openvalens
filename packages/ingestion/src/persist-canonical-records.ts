import { createHash } from "node:crypto";
import type { Database } from "@openhealth/db";
import { healthEvent, metricDefinition, metricSample } from "@openhealth/db/schema/health-record";
import {
  buildIngestDefinitionRow,
  normalizeMetricSample,
  resolveCanonicalMetricCode,
  stableSerialize,
} from "@openhealth/health-record";
import { and, eq } from "drizzle-orm";

import { adaptHealthConnectCanonicalRecords } from "./health-connect";

/**
 * Persist Health Connect records as canonical `metric_sample` /
 * `health_event` rows, ported from anchovy `persist-canonical-records.ts`.
 *
 * Deviations:
 * - Metric definitions are resolved (or registered) per organization. The
 *   source passed hardcoded ids `{ weight: 1, steps: 2, heart_rate: 3 }`,
 *   which are serial ids of arbitrary tenants.
 * - Inserts skip `(organization_id, dedupe_hash)` conflicts, so replaying
 *   an artifact is idempotent; skipped rows are counted as duplicates. The
 *   source's plain insert would fail the whole job on a re-run.
 * Dedupe hashes are computed exactly as in the source.
 */
type Tx = Pick<Database, "select" | "insert">;

export type PersistCanonicalRecordsResult = {
  metricSampleCount: number;
  healthEventCount: number;
  duplicateCount: number;
  rejectedCount: number;
};

function dedupeHash(kind: "metric_sample" | "health_event", payload: Record<string, unknown>) {
  return createHash("sha256")
    .update(`${kind}:${stableSerialize(payload)}`)
    .digest("hex");
}

async function metricDefinitionId(
  tx: Tx,
  organizationId: string,
  code: string,
  cache: Map<string, number>,
) {
  const cached = cache.get(code);
  if (cached !== undefined) return cached;
  const resolved = resolveCanonicalMetricCode({ metricCode: code });
  if (!resolved) throw new Error(`Unknown canonical metric: ${code}`);
  const row = buildIngestDefinitionRow({ organizationId, resolved });
  await tx
    .insert(metricDefinition)
    .values({ ...row, valueType: row.valueType as "number" | "text" | "boolean" | "json" })
    .onConflictDoNothing({ target: [metricDefinition.organizationId, metricDefinition.code] });
  const [definition] = await tx
    .select({ id: metricDefinition.id })
    .from(metricDefinition)
    .where(
      and(eq(metricDefinition.organizationId, organizationId), eq(metricDefinition.code, row.code)),
    )
    .limit(1);
  if (!definition) throw new Error("Metric definition was not resolvable.");
  cache.set(code, definition.id);
  return definition.id;
}

export async function persistCanonicalRecords(
  tx: Tx,
  input: {
    organizationId: string;
    dataSourceId: number | null;
    ingestionBatchId: number | null;
    provider: "health_connect";
    records: unknown[];
  },
): Promise<PersistCanonicalRecordsResult> {
  const intents = adaptHealthConnectCanonicalRecords(input.records);
  const definitions = new Map<string, number>();
  const result: PersistCanonicalRecordsResult = {
    metricSampleCount: 0,
    healthEventCount: 0,
    duplicateCount: 0,
    rejectedCount: input.records.length - intents.length,
  };

  for (const intent of intents) {
    if (intent.kind === "metric_sample") {
      const normalized = normalizeMetricSample({
        metricCode: intent.canonicalType,
        value: intent.value,
        unit: intent.unit,
      });
      const flags = normalized.qualityFlags;
      if (
        flags.includes("unknown_metric") ||
        flags.includes("non_finite_value") ||
        flags.includes("negative_value")
      ) {
        result.rejectedCount += 1;
        continue;
      }
      const inserted = await tx
        .insert(metricSample)
        .values({
          organizationId: input.organizationId,
          metricDefinitionId: await metricDefinitionId(
            tx,
            input.organizationId,
            intent.canonicalType,
            definitions,
          ),
          dataSourceId: input.dataSourceId,
          ingestionBatchId: input.ingestionBatchId,
          sampledAt: new Date(intent.sampledAt),
          numericValue: normalized.value,
          textValue: null,
          unit: normalized.unit,
          externalSampleId: intent.externalId,
          dedupeHash: dedupeHash("metric_sample", {
            canonicalType: intent.canonicalType,
            sampledAt: intent.sampledAt,
            value: normalized.value,
            unit: normalized.unit,
            externalId: intent.externalId,
            rawRecord: intent.rawRecord,
          }),
          metadataJson: {
            provider: input.provider,
            canonicalType: intent.canonicalType,
            sourceApp: intent.sourceApp,
            rawRecord: intent.rawRecord,
            ...(flags.length ? { normalizationFlags: flags } : {}),
          },
        })
        .onConflictDoNothing({ target: [metricSample.organizationId, metricSample.dedupeHash] })
        .returning({ id: metricSample.id });
      if (inserted.length) result.metricSampleCount += 1;
      else result.duplicateCount += 1;
      continue;
    }

    const inserted = await tx
      .insert(healthEvent)
      .values({
        organizationId: input.organizationId,
        dataSourceId: input.dataSourceId,
        ingestionBatchId: input.ingestionBatchId,
        eventType: intent.canonicalType,
        eventAt: new Date(intent.eventAt),
        title: intent.title,
        payloadJson: {
          provider: input.provider,
          canonicalType: intent.canonicalType,
          sourceApp: intent.sourceApp,
          ...(intent.endAt ? { endAt: intent.endAt } : {}),
          ...intent.payloadJson,
          rawRecord: intent.rawRecord,
        },
        sourceEventId: intent.sourceEventId,
        dedupeHash: dedupeHash("health_event", {
          canonicalType: intent.canonicalType,
          eventAt: intent.eventAt,
          endAt: intent.endAt,
          title: intent.title,
          sourceEventId: intent.sourceEventId,
          payloadJson: intent.payloadJson,
          rawRecord: intent.rawRecord,
        }),
      })
      .onConflictDoNothing({ target: [healthEvent.organizationId, healthEvent.dedupeHash] })
      .returning({ id: healthEvent.id });
    if (inserted.length) result.healthEventCount += 1;
    else result.duplicateCount += 1;
  }
  return result;
}
