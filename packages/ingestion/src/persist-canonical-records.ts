import { createHash } from "node:crypto";
import type { Database } from "@openvalens/db";
import { healthEvent, metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import {
  buildIngestDefinitionRow,
  normalizeMetricSample,
  resolveCanonicalMetricCode,
  stableSerialize,
} from "@openvalens/health-record";
import { and, eq } from "drizzle-orm";

import {
  adaptHealthConnectCanonicalRecords,
  type CanonicalWriteIntent,
  type MOBILE_INGESTION_PROVIDERS,
} from "./health-connect";

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
 * Dedupe hashes:
 * - `legacy` (anchovy envelope replay): computed exactly as in the source,
 *   including the full raw record.
 * - `mobile` (`mobile.ingestBatch`): keyed on provider, type, external record
 *   id, source revision (`lastModifiedAt`) and time/value, so re-serializing
 *   a record client-side never creates a duplicate row, while an edited
 *   record (new `lastModifiedAt`) is stored as a new version.
 */
type Tx = Pick<Database, "select" | "insert">;

export type PersistCanonicalRecordsResult = {
  metricSampleCount: number;
  healthEventCount: number;
  duplicateCount: number;
  rejectedCount: number;
};

export type CanonicalRowRef =
  | {
      table: "metric_sample";
      id: number;
      /** What was stored, for domain bridges (e.g. body weight). */
      metric: {
        code: string;
        sampledAt: string;
        value: number;
        externalId: string | null;
        sourceApp: string | null;
      };
    }
  | { table: "health_event"; id: number };

export type PersistCanonicalIntentsResult = PersistCanonicalRecordsResult & {
  /** Rows actually inserted by this call (duplicates excluded), for provenance links. */
  inserted: CanonicalRowRef[];
};

type Provider = (typeof MOBILE_INGESTION_PROVIDERS)[number];

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
  const { inserted: _inserted, ...result } = await persistCanonicalIntents(tx, {
    ...input,
    intents,
    dedupe: "legacy",
  });
  return { ...result, rejectedCount: result.rejectedCount + input.records.length - intents.length };
}

export async function persistCanonicalIntents(
  tx: Tx,
  input: {
    organizationId: string;
    dataSourceId: number | null;
    ingestionBatchId: number | null;
    provider: Provider;
    intents: CanonicalWriteIntent[];
    dedupe: "legacy" | "mobile";
  },
): Promise<PersistCanonicalIntentsResult> {
  const { intents } = input;
  const definitions = new Map<string, number>();
  const result: PersistCanonicalIntentsResult = {
    metricSampleCount: 0,
    healthEventCount: 0,
    duplicateCount: 0,
    rejectedCount: 0,
    inserted: [],
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
          dedupeHash: dedupeHash(
            "metric_sample",
            input.dedupe === "mobile"
              ? {
                  provider: input.provider,
                  canonicalType: intent.canonicalType,
                  externalId: intent.externalId,
                  lastModifiedAt: intent.lastModifiedAt ?? null,
                  sampledAt: intent.sampledAt,
                  value: normalized.value,
                  unit: normalized.unit,
                }
              : {
                  canonicalType: intent.canonicalType,
                  sampledAt: intent.sampledAt,
                  value: normalized.value,
                  unit: normalized.unit,
                  externalId: intent.externalId,
                  rawRecord: intent.rawRecord,
                },
          ),
          metadataJson: {
            provider: input.provider,
            canonicalType: intent.canonicalType,
            sourceApp: intent.sourceApp,
            ...(intent.endAt ? { endAt: intent.endAt } : {}),
            ...(intent.lastModifiedAt ? { lastModifiedAt: intent.lastModifiedAt } : {}),
            rawRecord: intent.rawRecord,
            ...(flags.length ? { normalizationFlags: flags } : {}),
          },
        })
        .onConflictDoNothing({ target: [metricSample.organizationId, metricSample.dedupeHash] })
        .returning({ id: metricSample.id });
      if (inserted[0]) {
        result.metricSampleCount += 1;
        result.inserted.push({
          table: "metric_sample",
          id: inserted[0].id,
          metric: {
            code: intent.canonicalType,
            sampledAt: intent.sampledAt,
            value: normalized.value,
            externalId: intent.externalId,
            sourceApp: intent.sourceApp,
          },
        });
      } else result.duplicateCount += 1;
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
          ...(intent.lastModifiedAt ? { lastModifiedAt: intent.lastModifiedAt } : {}),
          ...intent.payloadJson,
          rawRecord: intent.rawRecord,
        },
        sourceEventId: intent.sourceEventId,
        dedupeHash: dedupeHash(
          "health_event",
          input.dedupe === "mobile"
            ? {
                provider: input.provider,
                canonicalType: intent.canonicalType,
                externalId: intent.sourceEventId,
                lastModifiedAt: intent.lastModifiedAt ?? null,
                eventAt: intent.eventAt,
                endAt: intent.endAt,
              }
            : {
                canonicalType: intent.canonicalType,
                eventAt: intent.eventAt,
                endAt: intent.endAt,
                title: intent.title,
                sourceEventId: intent.sourceEventId,
                payloadJson: intent.payloadJson,
                rawRecord: intent.rawRecord,
              },
        ),
      })
      .onConflictDoNothing({ target: [healthEvent.organizationId, healthEvent.dedupeHash] })
      .returning({ id: healthEvent.id });
    if (inserted[0]) {
      result.healthEventCount += 1;
      result.inserted.push({ table: "health_event", id: inserted[0].id });
    } else result.duplicateCount += 1;
  }
  return result;
}
