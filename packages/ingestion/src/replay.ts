import type { Database } from "@openhealth/db";
import {
  ingestionBatch,
  ingestionError,
  ingestionJob,
  ingestionRawArtifact,
} from "@openhealth/db/schema/health-record";
import { and, desc, eq } from "drizzle-orm";

import { parseMobileIngestionEnvelope } from "./health-connect";
import { IngestionStateError } from "./job-runner-state";
import { persistCanonicalRecords } from "./persist-canonical-records";
import type { RunClaimedJobResult } from "./run-job";

/**
 * `raw_artifact_replay` — re-run canonical persistence for a stored raw
 * Health Connect artifact. Ported from anchovy `replay-artifact.ts` and
 * `run-replay-job.ts`, with two source bugs fixed (each made replay a
 * permanent no-op there):
 *
 * 1. Batch: the source runner required a `processing` batch that nothing in
 *    the replay flow created, so the job was never found, never failed, and
 *    was re-claimed as stale forever. The runner now creates the batch.
 * 2. Metadata lookup: the request stored `raw_artifact_replay_metadata`
 *    artifacts but the runner looked up `replay_metadata`. One name is used.
 *
 * PHI: `ingestion_error.raw_payload_json` stores only the replay metadata
 * (ids) or a source artifact reference, never the source health payload.
 * Messages are fixed strings, never `error.message`.
 */
export const RAW_ARTIFACT_REPLAY_JOB_TYPE = "raw_artifact_replay";
export const REPLAY_METADATA_ARTIFACT_TYPE = "raw_artifact_replay_metadata";

type ReplayFailureCode = "replay_metadata_unreadable" | "replay_source_unreadable";

function parseReplayMetadata(payload: unknown): { sourceRawArtifactId: number } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const id = (payload as { sourceRawArtifactId?: unknown }).sourceRawArtifactId;
  return typeof id === "number" && Number.isInteger(id) && id > 0
    ? { sourceRawArtifactId: id }
    : null;
}

export async function runReplayJob(
  db: Database,
  input: { jobId: number; organizationId: string },
  now: () => Date = () => new Date(),
): Promise<RunClaimedJobResult> {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select({ id: ingestionJob.id, providerConnectionId: ingestionJob.providerConnectionId })
      .from(ingestionJob)
      .where(
        and(
          eq(ingestionJob.id, input.jobId),
          eq(ingestionJob.organizationId, input.organizationId),
          eq(ingestionJob.status, "running"),
          eq(ingestionJob.jobType, RAW_ARTIFACT_REPLAY_JOB_TYPE),
        ),
      )
      .limit(1)
      .for("update");
    if (!job) throw new IngestionStateError("running replay ingestion job not found");

    const startedAt = now();
    let [batch] = await tx
      .select({ id: ingestionBatch.id, dataSourceId: ingestionBatch.dataSourceId })
      .from(ingestionBatch)
      .where(
        and(
          eq(ingestionBatch.organizationId, input.organizationId),
          eq(ingestionBatch.ingestionJobId, job.id),
          eq(ingestionBatch.status, "processing"),
        ),
      )
      .orderBy(desc(ingestionBatch.id))
      .limit(1);
    if (!batch) {
      [batch] = await tx
        .insert(ingestionBatch)
        .values({
          organizationId: input.organizationId,
          ingestionJobId: job.id,
          status: "processing",
          startedAt,
        })
        .returning({ id: ingestionBatch.id, dataSourceId: ingestionBatch.dataSourceId });
    }
    const batchId = batch!.id;

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
          and(
            eq(ingestionBatch.id, batchId),
            eq(ingestionBatch.organizationId, input.organizationId),
          ),
        );
      await tx
        .update(ingestionJob)
        .set({ status: outcome.job, completedAt, updatedAt: completedAt })
        .where(
          and(eq(ingestionJob.id, job.id), eq(ingestionJob.organizationId, input.organizationId)),
        );
      return completedAt;
    };

    const fail = async (
      errorCode: ReplayFailureCode,
      rawPayloadJson: unknown,
    ): Promise<RunClaimedJobResult> => {
      const completedAt = await finish(
        { job: "failed", batch: "failed" },
        { record: 0, accepted: 0, rejected: 0 },
      );
      await tx.insert(ingestionError).values({
        organizationId: input.organizationId,
        ingestionJobId: job.id,
        ingestionBatchId: batchId,
        errorCode,
        message:
          errorCode === "replay_metadata_unreadable"
            ? "Replay metadata artifact missing or unreadable."
            : "Source raw artifact missing, purged, or not a mobile ingestion envelope.",
        rawPayloadJson,
        occurredAt: completedAt,
      });
      return {
        jobId: job.id,
        jobType: RAW_ARTIFACT_REPLAY_JOB_TYPE,
        batchId,
        status: "failed",
        counts: null,
        errorCode,
      };
    };

    const [metadataArtifact] = await tx
      .select({ payloadJson: ingestionRawArtifact.payloadJson })
      .from(ingestionRawArtifact)
      .where(
        and(
          eq(ingestionRawArtifact.organizationId, input.organizationId),
          eq(ingestionRawArtifact.ingestionJobId, job.id),
          eq(ingestionRawArtifact.artifactType, REPLAY_METADATA_ARTIFACT_TYPE),
        ),
      )
      .limit(1);
    const metadata = parseReplayMetadata(metadataArtifact?.payloadJson);
    if (!metadata) return fail("replay_metadata_unreadable", metadataArtifact?.payloadJson ?? null);

    const [source] = await tx
      .select({ payloadJson: ingestionRawArtifact.payloadJson })
      .from(ingestionRawArtifact)
      .where(
        and(
          eq(ingestionRawArtifact.organizationId, input.organizationId),
          eq(ingestionRawArtifact.id, metadata.sourceRawArtifactId),
        ),
      )
      .limit(1);
    const envelope = parseMobileIngestionEnvelope(source?.payloadJson);
    if (!envelope || envelope.provider !== "health_connect")
      return fail("replay_source_unreadable", {
        sourceRawArtifactId: metadata.sourceRawArtifactId,
      });

    const persisted = await persistCanonicalRecords(tx, {
      organizationId: input.organizationId,
      dataSourceId: batch!.dataSourceId,
      ingestionBatchId: batchId,
      provider: "health_connect",
      records: envelope.records,
    });
    const acceptedCount = persisted.metricSampleCount + persisted.healthEventCount;
    await finish(
      { job: "succeeded", batch: "completed" },
      {
        record: envelope.records.length,
        accepted: acceptedCount,
        rejected: persisted.rejectedCount,
      },
    );
    return {
      jobId: job.id,
      jobType: RAW_ARTIFACT_REPLAY_JOB_TYPE,
      batchId,
      status: "succeeded",
      counts: {
        acceptedCount,
        rejectedCount: persisted.rejectedCount,
        metricSampleCount: persisted.metricSampleCount,
        healthEventCount: persisted.healthEventCount,
      },
      errorCode: null,
    };
  });
}

export class RawArtifactNotFoundError extends Error {
  constructor() {
    super("Raw artifact not found in the active organization.");
    this.name = "RawArtifactNotFoundError";
  }
}

/**
 * Queue a replay of one of the organization's raw artifacts. Idempotent per
 * artifact via `ingestion_job_org_idempotency_key`
 * (`raw-artifact-replay:<org>:<artifactId>`): a repeat request returns the
 * existing job, whatever its status.
 */
export async function requestReplay(
  db: Database,
  input: { organizationId: string; rawArtifactId: number; requestedByUserId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const idempotencyKey = `raw-artifact-replay:${input.organizationId}:${input.rawArtifactId}`;
  return db.transaction(async (tx) => {
    const [artifact] = await tx
      .select({
        id: ingestionRawArtifact.id,
        providerConnectionId: ingestionRawArtifact.providerConnectionId,
        artifactType: ingestionRawArtifact.artifactType,
        traceId: ingestionRawArtifact.traceId,
      })
      .from(ingestionRawArtifact)
      .where(
        and(
          eq(ingestionRawArtifact.organizationId, input.organizationId),
          eq(ingestionRawArtifact.id, input.rawArtifactId),
        ),
      )
      .limit(1);
    if (!artifact || artifact.artifactType === REPLAY_METADATA_ARTIFACT_TYPE)
      throw new RawArtifactNotFoundError();

    await tx
      .insert(ingestionJob)
      .values({
        organizationId: input.organizationId,
        providerConnectionId: artifact.providerConnectionId,
        jobType: RAW_ARTIFACT_REPLAY_JOB_TYPE,
        status: "queued",
        triggeredBy: "replay_request",
        idempotencyKey,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [ingestionJob.organizationId, ingestionJob.idempotencyKey],
      });
    const [job] = await tx
      .select({ id: ingestionJob.id, status: ingestionJob.status })
      .from(ingestionJob)
      .where(
        and(
          eq(ingestionJob.organizationId, input.organizationId),
          eq(ingestionJob.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (!job) throw new Error("Replay job was not resolvable.");

    const [existingMetadata] = await tx
      .select({ id: ingestionRawArtifact.id })
      .from(ingestionRawArtifact)
      .where(
        and(
          eq(ingestionRawArtifact.organizationId, input.organizationId),
          eq(ingestionRawArtifact.ingestionJobId, job.id),
          eq(ingestionRawArtifact.artifactType, REPLAY_METADATA_ARTIFACT_TYPE),
        ),
      )
      .limit(1);
    if (!existingMetadata) {
      const payloadJson = {
        sourceRawArtifactId: artifact.id,
        replayTag: "replayed",
        requestedByUserId: input.requestedByUserId,
        dedupeScope: `raw_artifact:${artifact.id}`,
        dedupeKey: idempotencyKey,
        sourceTraceId: artifact.traceId,
        sourceArtifactType: artifact.artifactType,
      };
      const serialized = JSON.stringify(payloadJson);
      await tx.insert(ingestionRawArtifact).values({
        organizationId: input.organizationId,
        providerConnectionId: artifact.providerConnectionId,
        ingestionJobId: job.id,
        artifactType: REPLAY_METADATA_ARTIFACT_TYPE,
        traceId: artifact.traceId,
        payloadJson,
        sizeBytes: Buffer.byteLength(serialized, "utf8"),
        capturedAt: now,
      });
    }
    return { jobId: job.id, status: job.status, idempotencyKey };
  });
}
