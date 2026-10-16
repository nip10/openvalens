import type { Database } from "@openvalens/db";
import { sql } from "drizzle-orm";

import type { CanonicalHealthEventWriteIntent } from "./health-connect";
import {
  groupSleepSegments,
  isUsableSleepSegment,
  SLEEP_SESSION_MAX_GAP_MS,
  type HealthKitSleepSegment,
} from "./healthkit-sleep";
import type { MobileIngestBatch, MobileProvider } from "./mobile-batch";
import { resolveDataSource, sourceIdentity } from "./mobile-data-source";
import type { MobileHealthRecord } from "./mobile-records";
import { persistCanonicalIntents, type CanonicalRowRef } from "./persist-canonical-records";

/**
 * Applies a `sleep_segment` batch (#131) inside the batch runner's
 * transaction. The algorithm (pure parts in `healthkit-sleep.ts`):
 *
 * 1. Lock sleep regrouping for this device connection, so two batches never
 *    regroup the same night concurrently.
 * 2. Load the active HealthKit sleep sessions of this connection that
 *    contain an uploaded or deleted segment UUID, or lie within the session
 *    gap of an uploaded segment. Sessions keep their member segments in
 *    `payload_json.rawRecord.segments`, so a deletion (a bare UUID) is always
 *    resolvable and the device stores no health data.
 * 3. Pool their segments with the uploaded ones, drop the deleted UUIDs, and
 *    regroup per data source.
 * 4. A regrouped session whose id (a hash of its members) is already active
 *    is unchanged. Loaded sessions that are not regrouped are superseded.
 *    New ids are inserted; an id whose row was superseded earlier (a segment
 *    added, then deleted again) is restored instead.
 *
 * Replaying a batch, or any batch whose segments are already stored, changes
 * nothing. Every query is scoped to the organization and the connection.
 */
export type ApplySleepSegmentsResult = {
  /** Segments in the batch, for the batch record count. */
  recordCount: number;
  /** Session rows inserted or restored. */
  inserted: CanonicalRowRef[];
  /** Uploaded segments that were already stored. */
  duplicateCount: number;
  /** Uploaded segments that grouping cannot use (bad interval). */
  rejectedCount: number;
  /** Session rows this batch replaced or deleted. */
  superseded: number[];
};

type PooledSegment = {
  segment: HealthKitSleepSegment;
  dataSourceId: number;
  sourceApp: string | null;
  sourceDevice: string | null;
};

type StoredSession = {
  id: number;
  dataSourceId: number;
  sourceEventId: string;
  payload: Record<string, unknown>;
};

const SLEEP_SEGMENT = "sleep_segment";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Segments stored in a session row; malformed entries are skipped. */
function storedSegments(payload: Record<string, unknown>): HealthKitSleepSegment[] {
  const raw = isRecord(payload.rawRecord) ? payload.rawRecord.segments : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const { id, value, startTime, endTime, timeZone } = entry;
    if (
      typeof id !== "string" ||
      typeof value !== "string" ||
      typeof startTime !== "string" ||
      typeof endTime !== "string"
    )
      return [];
    return [
      {
        id,
        value: value as HealthKitSleepSegment["value"],
        startTime,
        endTime,
        ...(typeof timeZone === "string" ? { timeZone } : {}),
      },
    ];
  });
}

const textArray = (values: string[]) =>
  sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;

export async function applyHealthKitSleepSegments(
  tx: Pick<Database, "select" | "insert" | "execute">,
  input: {
    organizationId: string;
    providerConnectionId: number;
    ingestionBatchId: number;
    provider: MobileProvider;
    batch: MobileIngestBatch;
    now: Date;
  },
): Promise<ApplySleepSegmentsResult> {
  const { organizationId, providerConnectionId, batch } = input;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`sleep_segment:${organizationId}:${providerConnectionId}`}))`,
  );

  const uploads = batch.upserts.filter(
    (record): record is Extract<MobileHealthRecord, { type: "sleep_segment" }> =>
      record.type === SLEEP_SEGMENT,
  );
  const incoming: PooledSegment[] = [];
  let rejectedCount = 0;
  const dataSources = new Map<string, number>();
  for (const record of uploads) {
    const segment: HealthKitSleepSegment = {
      id: record.externalRecordId,
      value: record.value,
      startTime: record.startTime,
      endTime: record.endTime,
      // Pin the zone now: a later regroup must not use a later batch's zone.
      timeZone: record.timeZone ?? batch.clientTimezone,
    };
    if (!isUsableSleepSegment(segment)) {
      rejectedCount += 1;
      continue;
    }
    const identity = sourceIdentity(input.provider, record);
    let dataSourceId = dataSources.get(identity.sourceKey);
    if (dataSourceId === undefined) {
      dataSourceId = await resolveDataSource(tx, organizationId, providerConnectionId, identity);
      dataSources.set(identity.sourceKey, dataSourceId);
    }
    incoming.push({
      segment,
      dataSourceId,
      sourceApp: record.sourceApp,
      sourceDevice: record.sourceDevice?.model ?? record.sourceDevice?.type ?? null,
    });
  }
  const deletedIds = new Set(batch.deletions.map((deletion) => deletion.externalRecordId));
  const touchedIds = [...new Set([...incoming.map((entry) => entry.segment.id), ...deletedIds])];
  if (touchedIds.length === 0)
    return {
      recordCount: uploads.length,
      inserted: [],
      duplicateCount: 0,
      rejectedCount,
      superseded: [],
    };

  const near = incoming.length
    ? (() => {
        const starts = incoming.map((entry) => new Date(entry.segment.startTime).getTime());
        const ends = incoming.map((entry) => new Date(entry.segment.endTime).getTime());
        // Whole-session regrouping makes this coarse window safe: sessions in
        // it that no upload touches regroup to themselves and stay as they are.
        const from = new Date(Math.min(...starts) - SLEEP_SESSION_MAX_GAP_MS);
        const to = new Date(Math.max(...ends) + SLEEP_SESSION_MAX_GAP_MS);
        return sql`or (r.event_at <= ${to} and (r.payload_json->>'endAt')::timestamptz >= ${from})`;
      })()
    : sql``;
  const loaded = await tx.execute(sql`
    select r.id, r.data_source_id, r.source_event_id, r.payload_json
    from health_event r
    join data_source d on d.id = r.data_source_id and d.organization_id = r.organization_id
    where r.organization_id = ${organizationId}
      and d.provider_connection_id = ${providerConnectionId}
      and r.event_type = 'sleep_session'
      and r.superseded_at is null
      and r.payload_json ? 'segmentIds'
      and ((r.payload_json->'segmentIds') ?| ${textArray(touchedIds)} ${near})
    order by r.id`);
  const sessions: StoredSession[] = (loaded.rows as Record<string, unknown>[]).map((row) => ({
    id: Number(row.id),
    dataSourceId: Number(row.data_source_id),
    sourceEventId: String(row.source_event_id),
    payload: isRecord(row.payload_json) ? row.payload_json : {},
  }));

  // Pool: stored segments, then uploads (a re-sent UUID is the same
  // immutable sample), minus deletions. Deletions win within one batch.
  const pool = new Map<string, PooledSegment>();
  for (const session of sessions) {
    const sourceApp =
      typeof session.payload.sourceApp === "string" ? session.payload.sourceApp : null;
    const sourceDevice =
      typeof session.payload.sourceDevice === "string" ? session.payload.sourceDevice : null;
    for (const segment of storedSegments(session.payload))
      pool.set(segment.id, {
        segment,
        dataSourceId: session.dataSourceId,
        sourceApp,
        sourceDevice,
      });
  }
  let duplicateCount = 0;
  for (const entry of incoming) {
    if (pool.has(entry.segment.id)) duplicateCount += 1;
    else pool.set(entry.segment.id, entry);
  }
  for (const id of deletedIds) pool.delete(id);

  const bySource = new Map<number, PooledSegment[]>();
  for (const entry of pool.values()) {
    const list = bySource.get(entry.dataSourceId);
    if (list) list.push(entry);
    else bySource.set(entry.dataSourceId, [entry]);
  }

  const active = new Set(sessions.map((session) => session.sourceEventId));
  const wanted = new Set<string>();
  const inserted: CanonicalRowRef[] = [];
  const toInsert = new Map<number, CanonicalHealthEventWriteIntent[]>();
  for (const [dataSourceId, entries] of bySource) {
    const { sourceApp, sourceDevice } = entries[0]!;
    for (const session of groupSleepSegments(
      entries.map((entry) => entry.segment),
      { fallbackTimeZone: batch.clientTimezone },
    )) {
      wanted.add(session.externalRecordId);
      if (active.has(session.externalRecordId)) continue;
      const intents = toInsert.get(dataSourceId) ?? [];
      intents.push({
        kind: "health_event",
        canonicalType: "sleep_session",
        eventAt: session.startTime,
        endAt: session.endTime,
        title: null,
        sourceEventId: session.externalRecordId,
        sourceApp,
        rawRecord: {
          type: "sleep_session",
          externalRecordId: session.externalRecordId,
          segments: session.segments,
        },
        payloadJson: {
          ...(session.stageIntervals.length ? { sleepStageIntervals: session.stageIntervals } : {}),
          segmentIds: session.segmentIds,
          ...(sourceDevice ? { sourceDevice } : {}),
          timeZone: session.timeZone,
          localDate: session.localDate,
        },
      });
      toInsert.set(dataSourceId, intents);
    }
  }

  const stale = sessions.filter((session) => !wanted.has(session.sourceEventId));
  let superseded: number[] = [];
  if (stale.length) {
    const result = await tx.execute(sql`
      update health_event set superseded_at = ${input.now}, updated_at = ${input.now}
      where organization_id = ${organizationId}
        and id in (${sql.join(
          stale.map((session) => sql`${session.id}`),
          sql`, `,
        )})
        and superseded_at is null
      returning id`);
    superseded = (result.rows as { id: number }[]).map((row) => Number(row.id));
  }

  const restore: string[] = [];
  for (const [dataSourceId, intents] of toInsert) {
    const persisted = await persistCanonicalIntents(tx, {
      organizationId,
      dataSourceId,
      ingestionBatchId: input.ingestionBatchId,
      provider: input.provider,
      intents,
      dedupe: "mobile",
    });
    inserted.push(...persisted.inserted);
    if (persisted.duplicateCount) restore.push(...intents.map((intent) => intent.sourceEventId!));
  }
  // Same members, same content: a superseded row with a wanted id is the
  // current truth again (e.g. a segment was added, then deleted).
  if (restore.length) {
    const result = await tx.execute(sql`
      update health_event r set superseded_at = null, updated_at = ${input.now}
      from data_source d
      where d.id = r.data_source_id and d.organization_id = r.organization_id
        and r.organization_id = ${organizationId}
        and d.provider_connection_id = ${providerConnectionId}
        and r.event_type = 'sleep_session'
        and r.source_event_id in (${sql.join(
          restore.map((id) => sql`${id}`),
          sql`, `,
        )})
        and r.superseded_at is not null
      returning r.id`);
    for (const row of result.rows as { id: number }[])
      inserted.push({ table: "health_event", id: Number(row.id) });
  }

  return { recordCount: uploads.length, inserted, duplicateCount, rejectedCount, superseded };
}
