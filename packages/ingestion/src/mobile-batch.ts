import { createHash } from "node:crypto";
import type { Database } from "@openvalens/db";
import {
  dataSource,
  ingestionBatch,
  ingestionError,
  ingestionJob,
  ingestionRawArtifact,
  provenanceLink,
} from "@openvalens/db/schema/health-record";
import { providerConnection } from "@openvalens/db/schema/ingestion";
import { createAutoReconciliationService } from "@openvalens/body";
import { buildDataSourceIdentity, stableSerialize } from "@openvalens/health-record";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";

import type { MOBILE_INGESTION_PROVIDERS } from "./health-connect";
import { IngestionStateError } from "./job-runner-state";
import {
  adaptMobileHealthRecords,
  type MobileHealthRecord,
  type MobileHealthRecordType,
} from "./mobile-records";
import { persistCanonicalIntents, type CanonicalRowRef } from "./persist-canonical-records";
import type { RunClaimedJobResult } from "./run-job";

/**
 * `mobile.ingestBatch` domain logic (issue #7, decided in
 * docs/architecture/mobile-sync-decision.md).
 *
 * The device sends batches read from Health Connect / HealthKit change
 * cursors and advances a cursor only after the server acknowledges. The
 * server makes that safe in two transactions:
 *
 * 1. **Accept** (durable): an `ingestion_job` keyed on the batch content hash
 *    plus an `ingestion_raw_artifact` holding the validated batch. A repeat of
 *    the same content hits the job's idempotency key and returns `duplicate`.
 * 2. **Apply**: canonical rows via `persistCanonicalIntents` (per-record
 *    dedupe), one `data_source` per source app/device, and one
 *    `provenance_link` per inserted row. If apply throws, the job stays
 *    `queued` and the `mobile_ingest_batch` cron runner retries it.
 *
 * Supersession (#44): canonical rows are never deleted. A deletion from the
 * device, or a newer version of a record (later `lastModifiedAt`), sets
 * `superseded_at` on the affected rows of the same device connection and
 * links them to the batch with a `superseded_by_raw_artifact` provenance
 * link. Read paths skip superseded rows.
 * PHI: errors store ids and fixed codes, never the payload.
 */
export const MOBILE_INGEST_JOB_TYPE = "mobile_ingest_batch";
export const MOBILE_BATCH_ARTIFACT_TYPE = "mobile_health_batch";
/** Raw batches are purged after this many days; canonical rows are kept. */
export const MOBILE_BATCH_RETENTION_DAYS = 30;

const IDEMPOTENCY_PREFIX = "mobile-ingest:";

export type MobileProvider = (typeof MOBILE_INGESTION_PROVIDERS)[number];

export type MobileIngestBatch = {
  schemaVersion: 1;
  deviceId: string;
  provider: MobileProvider;
  recordType: MobileHealthRecordType;
  mode: "changes" | "backfill";
  window?: { from: string; to: string };
  upserts: MobileHealthRecord[];
  deletions: { externalRecordId: string }[];
  clientTimezone: string;
};

export class MobileDeviceNotRegisteredError extends Error {
  constructor() {
    super("Mobile device is not registered in the active organization.");
    this.name = "MobileDeviceNotRegisteredError";
  }
}

export class MobileDeviceRevokedError extends Error {
  constructor() {
    super("Mobile device access has been revoked.");
    this.name = "MobileDeviceRevokedError";
  }
}

const PLATFORM_PROVIDER: Record<"android" | "ios", MobileProvider> = {
  android: "health_connect",
  ios: "apple_health",
};

/**
 * Upsert the device's `provider_connection` (`external_user_id = deviceId`).
 * A revoked or disconnected device stays that way: re-registering must not
 * silently undo a revocation.
 */
export async function registerMobileDevice(
  db: Database,
  input: {
    organizationId: string;
    /** The signed-in user registering the device becomes its owner. */
    userId: string;
    deviceId: string;
    platform: "android" | "ios";
    now?: Date;
  },
): Promise<{ providerConnectionId: number }> {
  const now = input.now ?? new Date();
  const provider = PLATFORM_PROVIDER[input.platform];
  await db
    .insert(providerConnection)
    .values({
      organizationId: input.organizationId,
      provider,
      externalUserId: input.deviceId,
      userId: input.userId,
      status: "active",
      connectedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [
        providerConnection.organizationId,
        providerConnection.provider,
        providerConnection.externalUserId,
      ],
    });
  const connection = await findConnection(db, input.organizationId, provider, input.deviceId);
  if (!connection) throw new Error("Provider connection was not resolvable.");
  if (connection.status !== "active") throw new MobileDeviceRevokedError();
  // The latest account to register this install owns it (sign-out then
  // sign-in as someone else re-registers the same device id).
  if (connection.userId !== input.userId)
    await db
      .update(providerConnection)
      .set({ userId: input.userId, updatedAt: now })
      .where(
        and(
          eq(providerConnection.id, connection.id),
          eq(providerConnection.organizationId, input.organizationId),
        ),
      );
  return { providerConnectionId: connection.id };
}

async function findConnection(
  db: Pick<Database, "select">,
  organizationId: string,
  provider: MobileProvider,
  deviceId: string,
) {
  const [row] = await db
    .select({
      id: providerConnection.id,
      status: providerConnection.status,
      userId: providerConnection.userId,
    })
    .from(providerConnection)
    .where(
      and(
        eq(providerConnection.organizationId, organizationId),
        eq(providerConnection.provider, provider),
        eq(providerConnection.externalUserId, deviceId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Content hash of a batch. Retrying after a crash re-reads the same changes
 * from the unadvanced cursor and produces the same hash.
 */
export function mobileBatchContentHash(organizationId: string, batch: MobileIngestBatch): string {
  return createHash("sha256")
    .update(
      [
        organizationId,
        batch.deviceId,
        batch.provider,
        batch.recordType,
        stableSerialize({ upserts: batch.upserts, deletions: batch.deletions }),
      ].join("|"),
    )
    .digest("hex");
}

/** The record type is kept in the job key so status survives the raw-payload purge. */
function idempotencyKey(recordType: string, hash: string) {
  return `${IDEMPOTENCY_PREFIX}${recordType}:${hash}`;
}

export type AcceptMobileBatchResult =
  | { status: "accepted"; jobId: number; rawArtifactId: number }
  | { status: "duplicate"; jobId: number; rawArtifactId: number };

/** Transaction 1: durably record the batch, or detect that it was seen before. */
export async function acceptMobileBatch(
  db: Database,
  input: { organizationId: string; batch: MobileIngestBatch; traceId: string; now?: Date },
): Promise<AcceptMobileBatchResult> {
  const now = input.now ?? new Date();
  const { batch, organizationId } = input;
  const connection = await findConnection(db, organizationId, batch.provider, batch.deviceId);
  if (!connection) throw new MobileDeviceNotRegisteredError();
  if (connection.status !== "active") throw new MobileDeviceRevokedError();

  const hash = mobileBatchContentHash(organizationId, batch);
  const key = idempotencyKey(batch.recordType, hash);
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(ingestionJob)
      .values({
        organizationId,
        providerConnectionId: connection.id,
        jobType: MOBILE_INGEST_JOB_TYPE,
        status: "queued",
        triggeredBy: "mobile_device",
        idempotencyKey: key,
        windowStart: batch.window ? new Date(batch.window.from) : null,
        windowEnd: batch.window ? new Date(batch.window.to) : null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [ingestionJob.organizationId, ingestionJob.idempotencyKey] })
      .returning({ id: ingestionJob.id });

    if (!created) {
      const [existing] = await tx
        .select({ jobId: ingestionJob.id, rawArtifactId: ingestionRawArtifact.id })
        .from(ingestionJob)
        .innerJoin(
          ingestionRawArtifact,
          and(
            eq(ingestionRawArtifact.ingestionJobId, ingestionJob.id),
            eq(ingestionRawArtifact.organizationId, ingestionJob.organizationId),
            eq(ingestionRawArtifact.artifactType, MOBILE_BATCH_ARTIFACT_TYPE),
          ),
        )
        .where(
          and(
            eq(ingestionJob.organizationId, organizationId),
            eq(ingestionJob.idempotencyKey, key),
          ),
        )
        .limit(1);
      if (!existing) throw new IngestionStateError("duplicate mobile batch has no raw artifact");
      return { status: "duplicate", ...existing };
    }

    const serialized = JSON.stringify(batch);
    const [artifact] = await tx
      .insert(ingestionRawArtifact)
      .values({
        organizationId,
        providerConnectionId: connection.id,
        ingestionJobId: created.id,
        artifactType: MOBILE_BATCH_ARTIFACT_TYPE,
        traceId: input.traceId,
        payloadJson: batch,
        payloadHash: hash,
        sizeBytes: Buffer.byteLength(serialized, "utf8"),
        capturedAt: now,
        retentionUntil: new Date(now.getTime() + MOBILE_BATCH_RETENTION_DAYS * 86_400_000),
        retentionClass: MOBILE_BATCH_ARTIFACT_TYPE,
      })
      .returning({ id: ingestionRawArtifact.id });
    return { status: "accepted", jobId: created.id, rawArtifactId: artifact!.id };
  });
}

function isMobileBatchPayload(payload: unknown): payload is MobileIngestBatch {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Partial<MobileIngestBatch>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.provider === "string" &&
    Array.isArray(candidate.upserts)
  );
}

/**
 * Transaction 2: apply a queued (inline call) or running (cron claim) batch.
 * Also the `mobile_ingest_batch` cron runner.
 */
export async function runMobileIngestBatchJob(
  db: Database,
  input: { jobId: number; organizationId: string },
  now: () => Date = () => new Date(),
): Promise<RunClaimedJobResult> {
  return db.transaction(async (tx) => {
    const { organizationId } = input;
    const [job] = await tx
      .select({ id: ingestionJob.id, providerConnectionId: ingestionJob.providerConnectionId })
      .from(ingestionJob)
      .where(
        and(
          eq(ingestionJob.id, input.jobId),
          eq(ingestionJob.organizationId, organizationId),
          eq(ingestionJob.jobType, MOBILE_INGEST_JOB_TYPE),
          inArray(ingestionJob.status, ["queued", "running"]),
        ),
      )
      .limit(1)
      .for("update");
    if (!job) throw new IngestionStateError("pending mobile ingest job not found");

    const startedAt = now();
    await tx
      .update(ingestionJob)
      .set({ status: "running", startedAt, updatedAt: startedAt })
      .where(and(eq(ingestionJob.id, job.id), eq(ingestionJob.organizationId, organizationId)));
    const [batchRow] = await tx
      .insert(ingestionBatch)
      .values({ organizationId, ingestionJobId: job.id, status: "processing", startedAt })
      .returning({ id: ingestionBatch.id });
    const batchId = batchRow!.id;

    const finish = async (
      outcome: { job: "succeeded"; batch: "completed" } | { job: "failed"; batch: "failed" },
      counts: { record: number; accepted: number; rejected: number },
    ) => {
      const completedAt = now();
      await tx
        .update(ingestionBatch)
        .set({
          status: outcome.batch,
          recordCount: counts.record,
          acceptedCount: counts.accepted,
          rejectedCount: counts.rejected,
          completedAt,
          updatedAt: completedAt,
        })
        .where(
          and(eq(ingestionBatch.id, batchId), eq(ingestionBatch.organizationId, organizationId)),
        );
      await tx
        .update(ingestionJob)
        .set({ status: outcome.job, completedAt, updatedAt: completedAt })
        .where(and(eq(ingestionJob.id, job.id), eq(ingestionJob.organizationId, organizationId)));
      return completedAt;
    };

    const [artifact] = await tx
      .select({ id: ingestionRawArtifact.id, payloadJson: ingestionRawArtifact.payloadJson })
      .from(ingestionRawArtifact)
      .where(
        and(
          eq(ingestionRawArtifact.organizationId, organizationId),
          eq(ingestionRawArtifact.ingestionJobId, job.id),
          eq(ingestionRawArtifact.artifactType, MOBILE_BATCH_ARTIFACT_TYPE),
        ),
      )
      .limit(1);
    if (!artifact || !isMobileBatchPayload(artifact.payloadJson)) {
      const completedAt = await finish(
        { job: "failed", batch: "failed" },
        { record: 0, accepted: 0, rejected: 0 },
      );
      await tx.insert(ingestionError).values({
        organizationId,
        ingestionJobId: job.id,
        ingestionBatchId: batchId,
        errorCode: "mobile_batch_unreadable",
        message: "Mobile batch raw artifact missing, purged, or unreadable.",
        rawPayloadJson: { rawArtifactId: artifact?.id ?? null },
        occurredAt: completedAt,
      });
      return {
        jobId: job.id,
        jobType: MOBILE_INGEST_JOB_TYPE,
        batchId,
        status: "failed",
        counts: null,
        errorCode: "mobile_batch_unreadable",
      };
    }
    const batch = artifact.payloadJson;
    if (job.providerConnectionId === null)
      throw new IngestionStateError("mobile ingest job has no provider connection");

    // One data_source per (source app, device) so source priority can tell a
    // scale from a watch.
    const groups = new Map<string, { identity: SourceIdentity; records: MobileHealthRecord[] }>();
    for (const record of batch.upserts) {
      const identity = sourceIdentity(batch.provider, record);
      const group = groups.get(identity.sourceKey);
      if (group) group.records.push(record);
      else groups.set(identity.sourceKey, { identity, records: [record] });
    }

    const totals = {
      metricSampleCount: 0,
      healthEventCount: 0,
      duplicateCount: 0,
      rejectedCount: 0,
    };
    const inserted: CanonicalRowRef[] = [];
    let intentCount = 0;
    for (const { identity, records } of groups.values()) {
      const dataSourceId = await resolveDataSource(
        tx,
        organizationId,
        job.providerConnectionId,
        identity,
      );
      const intents = adaptMobileHealthRecords(records);
      intentCount += intents.length;
      const persisted = await persistCanonicalIntents(tx, {
        organizationId,
        dataSourceId,
        ingestionBatchId: batchId,
        provider: batch.provider,
        intents,
        dedupe: "mobile",
      });
      totals.metricSampleCount += persisted.metricSampleCount;
      totals.healthEventCount += persisted.healthEventCount;
      totals.duplicateCount += persisted.duplicateCount;
      totals.rejectedCount += persisted.rejectedCount;
      inserted.push(...persisted.inserted);
    }

    if (inserted.length)
      await tx
        .insert(provenanceLink)
        .values(
          inserted.map((row) => ({
            organizationId,
            targetTable: row.table,
            targetId: row.id,
            sourceTable: "ingestion_raw_artifact",
            sourceId: artifact.id,
            relation: "derived_from_raw_artifact",
          })),
        )
        .onConflictDoNothing();

    // Body bridge: phone weights feed the per-user daily weight, as the old
    // Health Connect import did. Needs the device owner.
    const [owner] = await tx
      .select({ userId: providerConnection.userId })
      .from(providerConnection)
      .where(
        and(
          eq(providerConnection.id, job.providerConnectionId),
          eq(providerConnection.organizationId, organizationId),
        ),
      )
      .limit(1);
    const body = createAutoReconciliationService(tx);
    if (owner?.userId)
      for (const row of inserted) {
        if (row.table !== "metric_sample" || row.metric.code !== "weight") continue;
        await body.ingestAutoWeightEvent({
          organizationId,
          userId: owner.userId,
          date: localDate(row.metric.sampledAt, batch.clientTimezone),
          measuredAt: row.metric.sampledAt,
          weightKg: row.metric.value,
          sourceDetail: row.metric.sourceApp ?? batch.provider,
          metadataJson: {
            provider: batch.provider,
            metricSampleId: row.id,
            externalRecordId: row.metric.externalId,
          },
        });
      }

    const target = EVENT_TYPES.has(batch.recordType) ? TARGETS.health_event : TARGETS.metric_sample;
    const scope = {
      organizationId,
      providerConnectionId: job.providerConnectionId,
      now: now(),
    };
    const superseded = [
      ...(await supersede(tx, target, {
        ...scope,
        externalIds: [...new Set(batch.deletions.map((d) => d.externalRecordId))],
        mode: "deleted",
      })),
      ...(await supersede(tx, target, {
        ...scope,
        externalIds: [...new Set(batch.upserts.map((r) => r.externalRecordId))],
        mode: "older_versions",
      })),
    ];
    if (target.table === "metric_sample")
      await body.supersedeForMetricSamples({
        organizationId,
        metricSampleIds: superseded,
        supersededAt: scope.now,
      });
    if (superseded.length)
      await tx
        .insert(provenanceLink)
        .values(
          superseded.map((id) => ({
            organizationId,
            targetTable: target.table,
            targetId: id,
            sourceTable: "ingestion_raw_artifact",
            sourceId: artifact.id,
            relation: "superseded_by_raw_artifact",
          })),
        )
        .onConflictDoNothing();

    const accepted = totals.metricSampleCount + totals.healthEventCount;
    const completedAt = await finish(
      { job: "succeeded", batch: "completed" },
      { record: intentCount, accepted, rejected: totals.rejectedCount },
    );
    await tx
      .update(providerConnection)
      .set({ lastSyncedAt: completedAt, updatedAt: completedAt })
      .where(
        and(
          eq(providerConnection.id, job.providerConnectionId),
          eq(providerConnection.organizationId, organizationId),
        ),
      );
    return {
      jobId: job.id,
      jobType: MOBILE_INGEST_JOB_TYPE,
      batchId,
      status: "succeeded",
      counts: {
        acceptedCount: accepted,
        rejectedCount: totals.rejectedCount,
        metricSampleCount: totals.metricSampleCount,
        healthEventCount: totals.healthEventCount,
        duplicateCount: totals.duplicateCount,
        supersededCount: superseded.length,
      },
      errorCode: null,
    };
  });
}

type SourceIdentity = ReturnType<typeof sourceIdentity>;

function sourceIdentity(provider: MobileProvider, record: MobileHealthRecord) {
  const identity = buildDataSourceIdentity({
    provider,
    importChannel: "mobile_ingest",
    deviceType: record.sourceDevice?.type ?? null,
    deviceModel: record.sourceDevice?.model ?? null,
    sourceAppId: record.sourceApp,
  });
  return {
    ...identity,
    sourceType: record.sourceDevice?.type?.toLowerCase() || "unknown",
    deviceType: record.sourceDevice?.type ?? null,
    deviceModel: record.sourceDevice?.model ?? null,
    sourceAppId: record.sourceApp,
  };
}

async function resolveDataSource(
  tx: Pick<Database, "select" | "insert">,
  organizationId: string,
  providerConnectionId: number,
  identity: SourceIdentity,
) {
  await tx
    .insert(dataSource)
    .values({
      organizationId,
      providerConnectionId,
      sourceType: identity.sourceType,
      sourceKey: identity.sourceKey,
      importChannel: "mobile_ingest",
      deviceType: identity.deviceType,
      deviceModel: identity.deviceModel,
      sourceAppId: identity.sourceAppId,
      displayName: identity.sourceAppId,
    })
    .onConflictDoNothing({ target: [dataSource.organizationId, dataSource.sourceKey] });
  const [row] = await tx
    .select({ id: dataSource.id })
    .from(dataSource)
    .where(
      and(
        eq(dataSource.organizationId, organizationId),
        eq(dataSource.sourceKey, identity.sourceKey),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Data source was not resolvable.");
  return row.id;
}

const EVENT_TYPES = new Set<MobileHealthRecordType>(["sleep_session", "workout"]);

type SupersedeTarget = {
  table: "metric_sample" | "health_event";
  idColumn: string;
  versionColumn: string;
  touchesUpdatedAt: boolean;
};

const TARGETS = {
  metric_sample: {
    table: "metric_sample",
    idColumn: "external_sample_id",
    versionColumn: "metadata_json",
    touchesUpdatedAt: false,
  },
  health_event: {
    table: "health_event",
    idColumn: "source_event_id",
    versionColumn: "payload_json",
    touchesUpdatedAt: true,
  },
} satisfies Record<string, SupersedeTarget>;

/**
 * Marks active rows superseded and returns their ids. Only rows written for
 * this device connection (via `data_source`) are touched.
 * - `deleted`: every active row of the given source records.
 * - `older_versions`: rows whose `lastModifiedAt` is older than the newest
 *   version stored for the same source record (missing counts as oldest),
 *   so an edit hides the previous version and a late, older batch never
 *   resurfaces it.
 */
async function supersede(
  tx: Pick<Database, "execute">,
  target: SupersedeTarget,
  input: {
    organizationId: string;
    providerConnectionId: number;
    externalIds: string[];
    mode: "deleted" | "older_versions";
    now: Date;
  },
): Promise<number[]> {
  if (input.externalIds.length === 0) return [];
  const table = sql.identifier(target.table);
  const idColumn = sql.identifier(target.idColumn);
  const versionColumn = sql.identifier(target.versionColumn);
  const ids = sql.join(
    input.externalIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const version = (alias: string) =>
    sql`(${sql.identifier(alias)}.${versionColumn}->>'lastModifiedAt')::timestamptz`;
  const olderThanNewest =
    input.mode === "older_versions"
      ? sql`and coalesce(${version("r")}, '-infinity'::timestamptz) < (
          select max(${version("r2")}) from ${table} r2
          join data_source d2 on d2.id = r2.data_source_id and d2.organization_id = r2.organization_id
          where r2.organization_id = ${input.organizationId}
            and d2.provider_connection_id = ${input.providerConnectionId}
            and r2.${idColumn} = r.${idColumn})`
      : sql``;
  const touch = target.touchesUpdatedAt ? sql`, updated_at = ${input.now}` : sql``;
  const result = await tx.execute(sql`
    update ${table} r set superseded_at = ${input.now} ${touch}
    from data_source d
    where d.id = r.data_source_id and d.organization_id = r.organization_id
      and r.organization_id = ${input.organizationId}
      and d.provider_connection_id = ${input.providerConnectionId}
      and r.${idColumn} in (${ids})
      and r.superseded_at is null
      ${olderThanNewest}
    returning r.id`);
  return (result.rows as { id: number }[]).map((row) => Number(row.id));
}

/** `YYYY-MM-DD` of an instant in the device's time zone (falls back to UTC). */
function localDate(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export type IngestMobileBatchResult = {
  status: "applied" | "queued" | "duplicate";
  jobId: number;
  rawArtifactId: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  superseded: number;
};

/**
 * Accept then apply. A failed apply still returns `queued`: the raw artifact
 * is durable, so the device may advance its cursor and the cron runner
 * finishes the work.
 */
export async function ingestMobileBatch(
  db: Database,
  input: {
    organizationId: string;
    batch: MobileIngestBatch;
    traceId: string;
    now?: Date;
    /** Test seam: replaces the inline apply step. */
    apply?: typeof runMobileIngestBatchJob;
  },
): Promise<IngestMobileBatchResult> {
  const accepted = await acceptMobileBatch(db, input);
  const base = { jobId: accepted.jobId, rawArtifactId: accepted.rawArtifactId };
  if (accepted.status === "duplicate")
    return {
      status: "duplicate",
      ...base,
      accepted: 0,
      duplicates: input.batch.upserts.length,
      rejected: 0,
      superseded: 0,
    };

  const apply = input.apply ?? runMobileIngestBatchJob;
  const queued = {
    status: "queued" as const,
    ...base,
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    superseded: 0,
  };
  let result: RunClaimedJobResult;
  try {
    const clock = input.now ? () => input.now! : undefined;
    result = await apply(
      db,
      { jobId: accepted.jobId, organizationId: input.organizationId },
      clock,
    );
  } catch {
    return queued;
  }
  if (result.status !== "succeeded" || !result.counts) return queued;
  return {
    status: "applied",
    ...base,
    accepted: result.counts.acceptedCount,
    duplicates: result.counts.duplicateCount ?? 0,
    rejected: result.counts.rejectedCount,
    superseded: result.counts.supersededCount ?? 0,
  };
}

export type MobileSyncStatus = {
  devices: {
    deviceId: string;
    provider: string;
    status: string;
    lastIngestAt: string | null;
    perType: Record<string, { lastAt: string | null; lastStatus: string | null }>;
  }[];
};

/** Safe status metadata only: ids, timestamps and job statuses. No PHI. */
export async function getMobileSyncStatus(
  db: Database,
  input: { organizationId: string; jobsPerDevice?: number },
): Promise<MobileSyncStatus> {
  const connections = await db
    .select({
      id: providerConnection.id,
      deviceId: providerConnection.externalUserId,
      provider: providerConnection.provider,
      status: providerConnection.status,
      lastSyncedAt: providerConnection.lastSyncedAt,
    })
    .from(providerConnection)
    .where(
      and(
        eq(providerConnection.organizationId, input.organizationId),
        inArray(providerConnection.provider, ["health_connect", "apple_health"]),
      ),
    )
    .orderBy(providerConnection.id);

  const devices: MobileSyncStatus["devices"] = [];
  for (const connection of connections) {
    const jobs = await db
      .select({
        key: ingestionJob.idempotencyKey,
        status: ingestionJob.status,
        createdAt: ingestionJob.createdAt,
        completedAt: ingestionJob.completedAt,
      })
      .from(ingestionJob)
      .where(
        and(
          eq(ingestionJob.organizationId, input.organizationId),
          eq(ingestionJob.providerConnectionId, connection.id),
          eq(ingestionJob.jobType, MOBILE_INGEST_JOB_TYPE),
          like(ingestionJob.idempotencyKey, `${IDEMPOTENCY_PREFIX}%`),
        ),
      )
      .orderBy(desc(ingestionJob.createdAt), desc(ingestionJob.id))
      .limit(input.jobsPerDevice ?? 200);
    const perType: MobileSyncStatus["devices"][number]["perType"] = {};
    for (const job of jobs) {
      const recordType = job.key?.slice(IDEMPOTENCY_PREFIX.length).split(":")[0];
      if (!recordType || perType[recordType]) continue;
      perType[recordType] = {
        lastAt: (job.completedAt ?? job.createdAt).toISOString(),
        lastStatus: job.status,
      };
    }
    devices.push({
      deviceId: connection.deviceId,
      provider: connection.provider,
      status: connection.status,
      lastIngestAt: connection.lastSyncedAt?.toISOString() ?? null,
      perType,
    });
  }
  return { devices };
}
