import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { createDb, sql } from "@openhealth/db";
import { member, organization, user } from "@openhealth/db/schema/auth";
import {
  healthEvent,
  ingestionBatch,
  ingestionError,
  ingestionJob,
  ingestionRawArtifact,
  metricDefinition,
  metricSample,
} from "@openhealth/db/schema/health-record";
import { mobileSyncSession, mobileSyncSessionChunk } from "@openhealth/db/schema/ingestion";
import { eq } from "drizzle-orm";

import { claimNextQueuedJob, reclaimStaleRunningJobs } from "./claim-jobs";
import { failClaimedJob } from "./job-runner-state";
import { createDatabaseIngestionTick } from "./orchestrator";
import { persistCanonicalRecords } from "./persist-canonical-records";
import { runRawPayloadPurge } from "./raw-payload-purge";
import { RawArtifactNotFoundError, requestReplay, runReplayJob } from "./replay";

const url = process.env.INGESTION_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/ingestion_cron"
  )
    throw new Error("Empty disposable loopback ingestion_cron database required.");
}

describe.skipIf(!url)("ingestion cron on disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/ingestion_cron" });
  const now = new Date("2026-09-30T12:00:00Z");
  const past = new Date("2026-09-01T00:00:00Z");
  const future = new Date("2027-01-01T00:00:00Z");
  const types = ["raw_artifact_replay"];

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    const root = new URL("../../db/src/migrations/", import.meta.url);
    for (const directory of (await readdir(root)).sort()) {
      if (!/^\d/.test(directory)) continue;
      const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
      for (const statement of text.split("--> statement-breakpoint"))
        if (statement.trim()) await db.execute(sql.raw(statement));
    }
    await db.insert(organization).values([
      { id: "org-a", name: "A", slug: "a" },
      { id: "org-b", name: "B", slug: "b" },
    ]);
    await db.insert(user).values({ id: "u1", name: "U", email: "u1@example.invalid" });
    await db
      .insert(member)
      .values({ id: "m1", organizationId: "org-a", userId: "u1", role: "owner" });
  }, 120000);
  beforeEach(async () => {
    await db.delete(metricSample);
    await db.delete(healthEvent);
    await db.delete(metricDefinition);
    await db.delete(mobileSyncSessionChunk);
    await db.delete(mobileSyncSession);
    await db.delete(ingestionRawArtifact);
    await db.delete(ingestionError);
    await db.delete(ingestionBatch);
    await db.delete(ingestionJob);
  });
  afterAll(async () => {
    await db.$client.end();
  });

  async function queue(jobType: string, createdAt: Date, org = "org-a") {
    const [row] = await db
      .insert(ingestionJob)
      .values({ organizationId: org, jobType, createdAt, updatedAt: createdAt })
      .returning();
    return row!;
  }

  test("claims oldest queued job of a supported type; unsupported types are left queued", async () => {
    await queue("sync_session_finalize", new Date("2026-09-01T00:00:00Z"));
    const older = await queue("raw_artifact_replay", new Date("2026-09-02T00:00:00Z"));
    await queue("raw_artifact_replay", new Date("2026-09-03T00:00:00Z"));
    const claimed = await db.transaction((tx) => claimNextQueuedJob(tx, { now, jobTypes: types }));
    expect(claimed).toMatchObject({ id: older.id, status: "running", organizationId: "org-a" });
    expect(claimed?.startedAt?.toISOString()).toBe(now.toISOString());
    const unsupported = await db
      .select({ status: ingestionJob.status })
      .from(ingestionJob)
      .where(eq(ingestionJob.jobType, "sync_session_finalize"));
    expect(unsupported).toEqual([{ status: "queued" }]);
    expect(await claimNextQueuedJob(db, { now, jobTypes: [] })).toBeNull();
  });

  test("concurrent claimers never receive the same job (skip locked)", async () => {
    await queue("raw_artifact_replay", new Date("2026-09-02T00:00:00Z"));
    await queue("raw_artifact_replay", new Date("2026-09-03T00:00:00Z"));
    const results = await Promise.all([
      db.transaction((tx) => claimNextQueuedJob(tx, { now, jobTypes: types })),
      db.transaction((tx) => claimNextQueuedJob(tx, { now, jobTypes: types })),
    ]);
    const ids = results.map((row) => row?.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => typeof id === "number")).toBe(true);
  });

  test("reclaims only running jobs older than the stale cutoff", async () => {
    const stale = await queue("raw_artifact_replay", past);
    const fresh = await queue("raw_artifact_replay", past);
    await db
      .update(ingestionJob)
      .set({ status: "running", updatedAt: past })
      .where(eq(ingestionJob.id, stale.id));
    await db
      .update(ingestionJob)
      .set({ status: "running", updatedAt: new Date(now.getTime() - 60_000) })
      .where(eq(ingestionJob.id, fresh.id));
    const reclaimed = await reclaimStaleRunningJobs(db, {
      staleBefore: new Date(now.getTime() - 15 * 60_000),
      now,
      limit: 5,
      jobTypes: types,
    });
    expect(reclaimed.map((job) => job.id)).toEqual([stale.id]);
    expect(reclaimed[0]?.updatedAt.toISOString()).toBe(now.toISOString());
  });

  test("failClaimedJob marks job + batch failed and stores only the error class", async () => {
    const job = await queue("raw_artifact_replay", past);
    await db.update(ingestionJob).set({ status: "running" }).where(eq(ingestionJob.id, job.id));
    await db.insert(ingestionBatch).values({ organizationId: "org-a", ingestionJobId: job.id });
    const marked = await failClaimedJob(db, job, new RangeError("glucose 212 for patient"), now);
    expect(marked).toBe(true);
    const [jobRow] = await db.select().from(ingestionJob).where(eq(ingestionJob.id, job.id));
    const [batchRow] = await db.select().from(ingestionBatch);
    const errors = await db.select().from(ingestionError);
    expect(jobRow?.status).toBe("failed");
    expect(batchRow?.status).toBe("failed");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      errorCode: "executor_unexpected_error",
      message: "RangeError",
    });
    expect(JSON.stringify(errors)).not.toContain("glucose");
  });

  test("failClaimedJob without a processing batch leaves the job running (source parity)", async () => {
    const job = await queue("raw_artifact_replay", past);
    await db.update(ingestionJob).set({ status: "running" }).where(eq(ingestionJob.id, job.id));
    expect(await failClaimedJob(db, job, new Error("x"), now)).toBe(false);
    const [row] = await db.select().from(ingestionJob);
    expect(row?.status).toBe("running");
  });

  test("purge redacts only expired, unpurged raw artifacts, across tenants, keeping rows", async () => {
    const base = { artifactType: "health_connect", sizeBytes: 10, payloadHash: "h" };
    await db.insert(ingestionRawArtifact).values([
      { ...base, organizationId: "org-a", payloadJson: { v: "expired-a" }, retentionUntil: past },
      { ...base, organizationId: "org-b", payloadJson: { v: "expired-b" }, retentionUntil: now },
      { ...base, organizationId: "org-a", payloadJson: { v: "future" }, retentionUntil: future },
      { ...base, organizationId: "org-a", payloadJson: { v: "no-retention" } },
    ]);
    expect(await runRawPayloadPurge(db, now)).toMatchObject({ rawArtifactsPurged: 2 });
    const rows = await db.select().from(ingestionRawArtifact);
    expect(rows).toHaveLength(4);
    const byValue = (value: string) =>
      rows.find((row) => JSON.stringify(row.payloadJson).includes(value));
    expect(byValue("future")?.purgedAt).toBeNull();
    expect(byValue("no-retention")?.purgedAt).toBeNull();
    expect(rows.filter((row) => JSON.stringify(row.payloadJson) === "{}")).toHaveLength(2);
    expect(rows.every((row) => row.payloadHash === "h")).toBe(true);
    expect(await runRawPayloadPurge(db, now)).toMatchObject({ rawArtifactsPurged: 0 });
  });

  test("mobile chunks are purged only after a succeeded finalize job for that session", async () => {
    for (const id of ["s-final", "s-pending"])
      await db.insert(mobileSyncSession).values({
        id,
        organizationId: "org-a",
        userId: "u1",
        deviceId: "d",
        payloadVersion: "1",
        timezone: "UTC",
        windowStart: "2026-09-01",
        windowEnd: "2026-09-02",
        expectedChunkCount: 1,
        expiresAt: future,
      });
    for (const sessionId of ["s-final", "s-pending"])
      await db.insert(mobileSyncSessionChunk).values({
        id: `${sessionId}-0`,
        sessionId,
        chunkIndex: 0,
        chunkCount: 1,
        chunkHash: "c",
        payloadJson: { hr: 61 },
        retentionUntil: past,
      });
    await db.insert(ingestionJob).values({
      organizationId: "org-a",
      jobType: "sync_session_finalize",
      status: "succeeded",
      completedAt: past,
      idempotencyKey: "mobile-sync-finalize:s-final",
    });
    expect(await runRawPayloadPurge(db, now)).toMatchObject({ mobileChunksPurged: 1 });
    const chunks = await db.select().from(mobileSyncSessionChunk);
    expect(chunks.find((chunk) => chunk.sessionId === "s-final")?.payloadJson).toEqual({});
    expect(chunks.find((chunk) => chunk.sessionId === "s-pending")?.payloadJson).toEqual({
      hr: 61,
    });
  });

  test("production tick with no runners purges but never touches queued jobs", async () => {
    await queue("raw_artifact_replay", past);
    const logs: string[] = [];
    const logger = {
      info: () => {},
      warn: (e: string) => logs.push(e),
      error: (e: string) => logs.push(e),
    };
    const tick = createDatabaseIngestionTick({ db, logger, runners: {}, now: () => now });
    expect(await tick("corr")).toMatchObject({ status: "ok", processed: 0 });
    const [row] = await db.select().from(ingestionJob);
    expect(row?.status).toBe("queued");
    expect(logs).toEqual([]);
  });

  // ── raw_artifact_replay ────────────────────────────────────────────────
  const records = [
    { type: "weight", startTime: "2026-09-29T07:00:00Z", weightKg: 81.2, externalRecordId: "w1" },
    { type: "steps", startTime: "2026-09-29T08:00:00Z", count: 4200 },
    { type: "heartRate", startTime: "2026-09-29T08:00:00Z", samples: [{ bpm: 62 }] },
    { type: "weight", startTime: "2026-09-29T09:00:00Z", weightKg: -3 },
    {
      type: "sleep_session",
      startTime: "2026-09-28T23:00:00Z",
      endTime: "2026-09-29T06:00:00Z",
      stages: [{ stage: "deep", start: "2026-09-29T01:00:00Z", end: "2026-09-29T02:00:00Z" }],
    },
    { type: "unknown", startTime: "2026-09-29T08:00:00Z" },
  ];
  async function rawArtifact(
    org = "org-a",
    payloadJson: unknown = { provider: "health_connect", records },
  ) {
    const [row] = await db
      .insert(ingestionRawArtifact)
      .values({
        organizationId: org,
        artifactType: "mobile_sync_chunk",
        payloadJson,
        sizeBytes: 1,
        retentionUntil: future,
      })
      .returning();
    return row!;
  }
  const tickFor = () =>
    createDatabaseIngestionTick({
      db,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      runners: { raw_artifact_replay: (input) => runReplayJob(db, input, () => now) },
      now: () => now,
    });

  test("replay request → cron tick persists canonical records into a new batch", async () => {
    const artifact = await rawArtifact();
    const request = await requestReplay(db, {
      organizationId: "org-a",
      rawArtifactId: artifact.id,
      requestedByUserId: "u1",
      now: past,
    });
    expect(request.status).toBe("queued");
    const result = await tickFor()("corr");
    expect(result).toMatchObject({
      status: "ok",
      processed: 1,
      succeeded: 1,
      jobIds: [request.jobId],
    });

    const [job] = await db.select().from(ingestionJob).where(eq(ingestionJob.id, request.jobId));
    const [batch] = await db
      .select()
      .from(ingestionBatch)
      .where(eq(ingestionBatch.ingestionJobId, request.jobId));
    expect(job?.status).toBe("succeeded");
    expect(batch).toMatchObject({
      status: "completed",
      recordCount: 6,
      acceptedCount: 4,
      rejectedCount: 2,
    });

    const samples = await db
      .select({
        code: metricDefinition.code,
        value: metricSample.numericValue,
        batch: metricSample.ingestionBatchId,
        org: metricSample.organizationId,
      })
      .from(metricSample)
      .innerJoin(metricDefinition, eq(metricDefinition.id, metricSample.metricDefinitionId));
    expect(samples.map((row) => [row.code, row.value]).sort()).toEqual([
      ["heart_rate", 62],
      ["steps", 4200],
      ["weight", 81.2],
    ]);
    expect(samples.every((row) => row.batch === batch!.id && row.org === "org-a")).toBe(true);
    const events = await db.select().from(healthEvent);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: "sleep_session", ingestionBatchId: batch!.id });
    expect(
      (events[0]!.payloadJson as { sleepStageIntervals: unknown[] }).sleepStageIntervals,
    ).toHaveLength(1);
  });

  test("replay requests are idempotent per artifact and tenant-scoped", async () => {
    const artifact = await rawArtifact();
    const first = await requestReplay(db, {
      organizationId: "org-a",
      rawArtifactId: artifact.id,
      requestedByUserId: "u1",
    });
    const second = await requestReplay(db, {
      organizationId: "org-a",
      rawArtifactId: artifact.id,
      requestedByUserId: "u1",
    });
    expect(second.jobId).toBe(first.jobId);
    expect(await db.select().from(ingestionJob)).toHaveLength(1);
    expect(
      (await db.select().from(ingestionRawArtifact)).filter(
        (row) => row.artifactType === "raw_artifact_replay_metadata",
      ),
    ).toHaveLength(1);
    await expect(
      requestReplay(db, {
        organizationId: "org-b",
        rawArtifactId: artifact.id,
        requestedByUserId: "u1",
      }),
    ).rejects.toBeInstanceOf(RawArtifactNotFoundError);
  });

  test("persisting the same records twice is idempotent; definitions are per organization", async () => {
    const first = await db.transaction((tx) =>
      persistCanonicalRecords(tx, {
        organizationId: "org-a",
        dataSourceId: null,
        ingestionBatchId: null,
        provider: "health_connect",
        records,
      }),
    );
    const again = await db.transaction((tx) =>
      persistCanonicalRecords(tx, {
        organizationId: "org-a",
        dataSourceId: null,
        ingestionBatchId: null,
        provider: "health_connect",
        records,
      }),
    );
    await db.transaction((tx) =>
      persistCanonicalRecords(tx, {
        organizationId: "org-b",
        dataSourceId: null,
        ingestionBatchId: null,
        provider: "health_connect",
        records,
      }),
    );
    expect(first).toMatchObject({ metricSampleCount: 3, healthEventCount: 1, duplicateCount: 0 });
    expect(again).toMatchObject({ metricSampleCount: 0, healthEventCount: 0, duplicateCount: 4 });
    const definitions = await db
      .select()
      .from(metricDefinition)
      .where(eq(metricDefinition.code, "weight"));
    expect(definitions.map((row) => row.organizationId).sort()).toEqual(["org-a", "org-b"]);
    const samples = await db.select().from(metricSample);
    for (const sample of samples) {
      const definition = (
        await db
          .select()
          .from(metricDefinition)
          .where(eq(metricDefinition.id, sample.metricDefinitionId))
      )[0];
      expect(definition?.organizationId).toBe(sample.organizationId);
    }
  });

  test("purged source artifact fails the job with a reference-only diagnostic", async () => {
    const artifact = await rawArtifact("org-a", {});
    const request = await requestReplay(db, {
      organizationId: "org-a",
      rawArtifactId: artifact.id,
      requestedByUserId: "u1",
    });
    expect(await tickFor()("corr")).toMatchObject({ processed: 1, failed: 1 });
    const [job] = await db.select().from(ingestionJob).where(eq(ingestionJob.id, request.jobId));
    const [batch] = await db.select().from(ingestionBatch);
    const [error] = await db.select().from(ingestionError);
    expect(job?.status).toBe("failed");
    expect(batch?.status).toBe("failed");
    expect(error).toMatchObject({
      errorCode: "replay_source_unreadable",
      rawPayloadJson: { sourceRawArtifactId: artifact.id },
    });
    expect(await db.select().from(metricSample)).toHaveLength(0);
  });

  test("missing replay metadata fails the job instead of looping as stale", async () => {
    const job = await queue("raw_artifact_replay", past);
    expect(await tickFor()("corr")).toMatchObject({ processed: 1, failed: 1 });
    const [row] = await db.select().from(ingestionJob).where(eq(ingestionJob.id, job.id));
    const [error] = await db.select().from(ingestionError);
    expect(row?.status).toBe("failed");
    expect(error?.errorCode).toBe("replay_metadata_unreadable");
  });

  test("sync_session_finalize jobs stay queued while replay runs", async () => {
    const finalize = await queue("sync_session_finalize", new Date("2026-08-01T00:00:00Z"));
    const artifact = await rawArtifact();
    await requestReplay(db, {
      organizationId: "org-a",
      rawArtifactId: artifact.id,
      requestedByUserId: "u1",
      now: past,
    });
    expect(await tickFor()("corr")).toMatchObject({ succeeded: 1 });
    const [row] = await db.select().from(ingestionJob).where(eq(ingestionJob.id, finalize.id));
    expect(row?.status).toBe("queued");
  });
});
