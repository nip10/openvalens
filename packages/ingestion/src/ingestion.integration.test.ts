import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { createDb, sql } from "@openhealth/db";
import { member, organization, user } from "@openhealth/db/schema/auth";
import {
  ingestionBatch,
  ingestionError,
  ingestionJob,
  ingestionRawArtifact,
} from "@openhealth/db/schema/health-record";
import { mobileSyncSession, mobileSyncSessionChunk } from "@openhealth/db/schema/ingestion";
import { eq } from "drizzle-orm";

import { claimNextQueuedJob, reclaimStaleRunningJobs } from "./claim-jobs";
import { failClaimedJob } from "./job-runner-state";
import { createDatabaseIngestionTick } from "./orchestrator";
import { runRawPayloadPurge } from "./raw-payload-purge";

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
});
