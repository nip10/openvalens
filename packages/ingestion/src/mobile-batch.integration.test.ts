import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { createDb, sql } from "@openhealth/db";
import { organization } from "@openhealth/db/schema/auth";
import {
  dataSource,
  healthEvent,
  ingestionBatch,
  ingestionError,
  ingestionJob,
  ingestionRawArtifact,
  metricDefinition,
  metricSample,
  provenanceLink,
} from "@openhealth/db/schema/health-record";
import { providerConnection } from "@openhealth/db/schema/ingestion";
import { and, eq } from "drizzle-orm";

import {
  acceptMobileBatch,
  getMobileSyncStatus,
  ingestMobileBatch,
  MOBILE_INGEST_JOB_TYPE,
  MobileDeviceNotRegisteredError,
  MobileDeviceRevokedError,
  registerMobileDevice,
  runMobileIngestBatchJob,
  type MobileIngestBatch,
} from "./mobile-batch";
import { createDatabaseIngestionTick } from "./orchestrator";

const url = process.env.MOBILE_INGEST_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/mobile_ingest_issue7"
  )
    throw new Error("Empty disposable loopback mobile_ingest_issue7 database required.");
}

const DEVICE = "6f1c2a3e-9b2d-4c1e-8f3a-2d7e5b9c0a11";
const now = new Date("2026-10-01T12:00:00.000Z");

function batch(overrides: Partial<MobileIngestBatch> = {}): MobileIngestBatch {
  return {
    schemaVersion: 1,
    deviceId: DEVICE,
    provider: "health_connect",
    recordType: "weight",
    mode: "changes",
    clientTimezone: "Europe/Lisbon",
    upserts: [
      {
        type: "weight",
        externalRecordId: "w-1",
        sourceApp: "com.withings.wiscale2",
        sourceDevice: { type: "scale", model: "Body+" },
        startTime: "2026-10-01T07:00:00.000Z",
        valueKg: 72.4,
      },
      {
        type: "weight",
        externalRecordId: "w-2",
        sourceApp: "com.google.android.apps.fitness",
        startTime: "2026-10-01T08:00:00.000Z",
        valueKg: 72.1,
      },
    ],
    deletions: [{ externalRecordId: "w-0" }],
    ...overrides,
  };
}

describe.skipIf(!url)("mobile ingest batch on disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/mobile_ingest_issue7" });

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
  }, 120000);
  beforeEach(async () => {
    await db.delete(provenanceLink);
    await db.delete(metricSample);
    await db.delete(healthEvent);
    await db.delete(metricDefinition);
    await db.delete(ingestionRawArtifact);
    await db.delete(ingestionError);
    await db.delete(ingestionBatch);
    await db.delete(ingestionJob);
    await db.delete(dataSource);
    await db.delete(providerConnection);
  });
  afterAll(async () => {
    await db.$client.end();
  });

  const register = () =>
    registerMobileDevice(db, {
      organizationId: "org-a",
      deviceId: DEVICE,
      platform: "android",
      now,
    });

  test("registerDevice creates one active connection and is idempotent", async () => {
    const first = await register();
    const second = await register();
    expect(second.providerConnectionId).toBe(first.providerConnectionId);
    const rows = await db.select().from(providerConnection);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: "org-a",
      provider: "health_connect",
      externalUserId: DEVICE,
      status: "active",
    });
  });

  test("a revoked device stays revoked when it registers again", async () => {
    await register();
    await db.update(providerConnection).set({ status: "revoked" });
    await expect(register()).rejects.toBeInstanceOf(MobileDeviceRevokedError);
    const [row] = await db.select().from(providerConnection);
    expect(row?.status).toBe("revoked");
  });

  test("an unregistered or revoked device cannot ingest and nothing is written", async () => {
    await expect(
      ingestMobileBatch(db, { organizationId: "org-a", batch: batch(), traceId: "t", now }),
    ).rejects.toBeInstanceOf(MobileDeviceNotRegisteredError);
    await register();
    await db.update(providerConnection).set({ status: "revoked" });
    await expect(
      ingestMobileBatch(db, { organizationId: "org-a", batch: batch(), traceId: "t", now }),
    ).rejects.toBeInstanceOf(MobileDeviceRevokedError);
    expect(await db.select().from(ingestionJob)).toHaveLength(0);
    expect(await db.select().from(ingestionRawArtifact)).toHaveLength(0);
  });

  test("a device registered in one org cannot ingest into another", async () => {
    await register();
    await expect(
      ingestMobileBatch(db, { organizationId: "org-b", batch: batch(), traceId: "t", now }),
    ).rejects.toBeInstanceOf(MobileDeviceNotRegisteredError);
  });

  test("applies a batch: raw artifact, canonical rows, data sources and provenance", async () => {
    const { providerConnectionId } = await register();
    const result = await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch(),
      traceId: "trace-1",
      now,
    });
    expect(result).toMatchObject({ status: "applied", accepted: 2, duplicates: 0, rejected: 0 });

    const [artifact] = await db.select().from(ingestionRawArtifact);
    expect(artifact).toMatchObject({
      id: result.rawArtifactId,
      organizationId: "org-a",
      providerConnectionId,
      artifactType: "mobile_health_batch",
      retentionClass: "mobile_health_batch",
      traceId: "trace-1",
    });
    expect(artifact?.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact?.retentionUntil?.getTime()).toBeGreaterThan(now.getTime());
    expect(artifact?.payloadJson).toMatchObject({ deletions: [{ externalRecordId: "w-0" }] });

    const samples = await db.select().from(metricSample);
    expect(samples.map((s) => s.numericValue).sort()).toEqual([72.1, 72.4]);
    expect(new Set(samples.map((s) => s.unit))).toEqual(new Set(["kg"]));

    const sources = await db.select().from(dataSource);
    expect(sources).toHaveLength(2);
    expect(sources.every((s) => s.providerConnectionId === providerConnectionId)).toBe(true);
    const scale = sources.find((s) => s.sourceAppId === "com.withings.wiscale2");
    expect(scale).toMatchObject({ sourceType: "scale", deviceModel: "Body+" });
    expect(samples.find((s) => s.numericValue === 72.4)?.dataSourceId).toBe(scale!.id);

    const links = await db.select().from(provenanceLink);
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.sourceTable === "ingestion_raw_artifact")).toBe(true);
    expect(links.every((l) => l.sourceId === result.rawArtifactId)).toBe(true);
    expect(links.map((l) => l.targetId).sort()).toEqual(samples.map((s) => s.id).sort());

    const [job] = await db.select().from(ingestionJob);
    expect(job).toMatchObject({ jobType: MOBILE_INGEST_JOB_TYPE, status: "succeeded" });
    const [connection] = await db.select().from(providerConnection);
    expect(connection?.lastSyncedAt?.toISOString()).toBe(now.toISOString());
  });

  test("replaying the same batch returns duplicate and writes nothing new", async () => {
    await register();
    const first = await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch(),
      traceId: "t",
      now,
    });
    const replay = await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch(),
      traceId: "t2",
      now,
    });
    expect(replay).toMatchObject({
      status: "duplicate",
      rawArtifactId: first.rawArtifactId,
      accepted: 0,
      duplicates: 2,
    });
    expect(await db.select().from(ingestionRawArtifact)).toHaveLength(1);
    expect(await db.select().from(metricSample)).toHaveLength(2);
    expect(await db.select().from(ingestionJob)).toHaveLength(1);
  });

  test("overlapping batches dedupe per record; an edited record is stored as a new version", async () => {
    await register();
    await ingestMobileBatch(db, { organizationId: "org-a", batch: batch(), traceId: "t", now });
    const [w1, w2] = batch().upserts;
    const overlap = await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({
        upserts: [
          w1!,
          { ...w2!, lastModifiedAt: "2026-10-01T09:00:00.000Z", valueKg: 72.0 } as typeof w2 &
            object,
        ],
        deletions: [],
      }),
      traceId: "t",
      now,
    });
    expect(overlap).toMatchObject({ status: "applied", accepted: 1, duplicates: 1 });
    expect(await db.select().from(metricSample)).toHaveLength(3);
  });

  test("heart rate, sleep and workouts land as samples and events", async () => {
    await register();
    const res = await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({
        recordType: "heart_rate",
        deletions: [],
        upserts: [
          {
            type: "heart_rate",
            externalRecordId: "hr-1",
            sourceApp: "com.samsung.health",
            startTime: "2026-10-01T07:00:00.000Z",
            endTime: "2026-10-01T07:02:00.000Z",
            samples: [
              { time: "2026-10-01T07:00:00.000Z", bpm: 61 },
              { time: "2026-10-01T07:01:00.000Z", bpm: 64 },
            ],
          },
        ],
      }),
      traceId: "t",
      now,
    });
    expect(res).toMatchObject({ status: "applied", accepted: 2 });
    const events = await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({
        recordType: "sleep_session",
        deletions: [],
        upserts: [
          {
            type: "sleep_session",
            externalRecordId: "s-1",
            sourceApp: "com.samsung.health",
            startTime: "2026-09-30T23:00:00.000Z",
            endTime: "2026-10-01T07:00:00.000Z",
            stages: [
              {
                stage: "deep",
                startTime: "2026-09-30T23:30:00.000Z",
                endTime: "2026-10-01T00:30:00.000Z",
              },
            ],
          },
        ],
      }),
      traceId: "t",
      now,
    });
    expect(events).toMatchObject({ status: "applied", accepted: 1 });
    const [event] = await db.select().from(healthEvent);
    expect(event).toMatchObject({ eventType: "sleep_session", sourceEventId: "s-1" });
    const links = await db
      .select()
      .from(provenanceLink)
      .where(eq(provenanceLink.targetTable, "health_event"));
    expect(links).toHaveLength(1);
  });

  test("an accepted batch whose apply failed stays queued and the cron tick applies it", async () => {
    await register();
    const res = await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch(),
      traceId: "t",
      now,
      apply: async () => {
        throw new Error("simulated apply failure");
      },
    });
    expect(res).toMatchObject({ status: "queued" });
    const [queued] = await db.select().from(ingestionJob);
    expect(queued?.status).toBe("queued");
    expect(await db.select().from(metricSample)).toHaveLength(0);

    const tick = createDatabaseIngestionTick({
      db,
      logger: { info() {}, warn() {}, error() {} },
      runners: { [MOBILE_INGEST_JOB_TYPE]: (input) => runMobileIngestBatchJob(db, input) },
      now: () => now,
    });
    expect(await tick("corr")).toMatchObject({ status: "ok", succeeded: 1 });
    expect(await db.select().from(metricSample)).toHaveLength(2);
    // The device retrying the same batch now gets a duplicate, not a second apply.
    const retry = await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch(),
      traceId: "t",
      now,
    });
    expect(retry.status).toBe("duplicate");
  });

  test("a purged artifact fails the job with a PHI-free error", async () => {
    await register();
    const accepted = await acceptMobileBatch(db, {
      organizationId: "org-a",
      batch: batch(),
      traceId: "t",
      now,
    });
    if (accepted.status !== "accepted") throw new Error("expected a new batch");
    await db.update(ingestionRawArtifact).set({ payloadJson: {}, purgedAt: now });
    const result = await runMobileIngestBatchJob(
      db,
      { jobId: accepted.jobId, organizationId: "org-a" },
      () => now,
    );
    expect(result).toMatchObject({ status: "failed", errorCode: "mobile_batch_unreadable" });
    const [error] = await db.select().from(ingestionError);
    expect(error?.rawPayloadJson).toEqual({ rawArtifactId: accepted.rawArtifactId });
  });

  test("a job from another org is never applied", async () => {
    await register();
    const accepted = await acceptMobileBatch(db, {
      organizationId: "org-a",
      batch: batch(),
      traceId: "t",
      now,
    });
    if (accepted.status !== "accepted") throw new Error("expected a new batch");
    await expect(
      runMobileIngestBatchJob(db, { jobId: accepted.jobId, organizationId: "org-b" }, () => now),
    ).rejects.toThrow();
    const [job] = await db
      .select()
      .from(ingestionJob)
      .where(and(eq(ingestionJob.id, accepted.jobId)));
    expect(job?.status).toBe("queued");
  });

  const active = async () =>
    (await db.select().from(metricSample)).filter((row) => row.supersededAt === null);

  test("a deletion supersedes the record's rows, keeps them, and links the deleting batch", async () => {
    await register();
    await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({ deletions: [] }),
      traceId: "t",
      now,
    });
    const res = await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({ upserts: [], deletions: [{ externalRecordId: "w-1" }] }),
      traceId: "t",
      now,
    });
    expect(res).toMatchObject({ status: "applied", superseded: 1 });
    const rows = await db.select().from(metricSample);
    expect(rows).toHaveLength(2);
    const gone = rows.find((row) => row.externalSampleId === "w-1");
    expect(gone?.supersededAt?.toISOString()).toBe(now.toISOString());
    expect((await active()).map((row) => row.externalSampleId)).toEqual(["w-2"]);
    const [link] = await db
      .select()
      .from(provenanceLink)
      .where(eq(provenanceLink.relation, "superseded_by_raw_artifact"));
    expect(link).toMatchObject({
      targetTable: "metric_sample",
      targetId: gone!.id,
      sourceTable: "ingestion_raw_artifact",
      sourceId: res.rawArtifactId,
    });
  });

  test("a deletion only affects rows from the same device", async () => {
    await register();
    await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({ deletions: [] }),
      traceId: "t",
      now,
    });
    const OTHER = "0b7e4d2a-1c3f-4a5b-9d8e-7f6a5b4c3d2e";
    await registerMobileDevice(db, {
      organizationId: "org-a",
      deviceId: OTHER,
      platform: "android",
      now,
    });
    const res = await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({ deviceId: OTHER, upserts: [], deletions: [{ externalRecordId: "w-1" }] }),
      traceId: "t",
      now,
    });
    expect(res.superseded).toBe(0);
    expect(await active()).toHaveLength(2);
  });

  test("deleting a heart-rate record supersedes every sample and deleting a sleep session supersedes the event", async () => {
    await register();
    const hr = {
      type: "heart_rate" as const,
      externalRecordId: "hr-1",
      sourceApp: "com.samsung.health",
      startTime: "2026-10-01T07:00:00.000Z",
      endTime: "2026-10-01T07:02:00.000Z",
      samples: [
        { time: "2026-10-01T07:00:00.000Z", bpm: 61 },
        { time: "2026-10-01T07:01:00.000Z", bpm: 64 },
      ],
    };
    await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({ recordType: "heart_rate", upserts: [hr], deletions: [] }),
      traceId: "t",
      now,
    });
    const res = await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({
        recordType: "heart_rate",
        upserts: [],
        deletions: [{ externalRecordId: "hr-1" }],
      }),
      traceId: "t",
      now,
    });
    expect(res.superseded).toBe(2);
    expect(await active()).toHaveLength(0);

    await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({
        recordType: "sleep_session",
        deletions: [],
        upserts: [
          {
            type: "sleep_session",
            externalRecordId: "s-1",
            sourceApp: "com.samsung.health",
            startTime: "2026-09-30T23:00:00.000Z",
            endTime: "2026-10-01T07:00:00.000Z",
          },
        ],
      }),
      traceId: "t",
      now,
    });
    await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({
        recordType: "sleep_session",
        upserts: [],
        deletions: [{ externalRecordId: "s-1" }],
      }),
      traceId: "t",
      now,
    });
    const [event] = await db.select().from(healthEvent);
    expect(event?.supersededAt).not.toBeNull();
  });

  test("an edited record supersedes the older version; an older version arriving late stays superseded", async () => {
    await register();
    type Weight = Extract<MobileIngestBatch["upserts"][number], { type: "weight" }>;
    const [w1] = batch().upserts as Weight[];
    const v1 = { ...w1!, lastModifiedAt: "2026-10-01T08:00:00.000Z" };
    const v2 = { ...w1!, lastModifiedAt: "2026-10-01T09:00:00Z", valueKg: 72.0 };
    await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({ upserts: [v1], deletions: [] }),
      traceId: "t",
      now,
    });
    const edit = await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({ upserts: [v2], deletions: [] }),
      traceId: "t",
      now,
    });
    expect(edit).toMatchObject({ accepted: 1, superseded: 1 });
    expect((await active()).map((row) => row.numericValue)).toEqual([72.0]);

    // A queued batch carrying the old version is applied after the edit.
    const late = await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({
        upserts: [
          { ...v1, lastModifiedAt: "2026-10-01T07:00:00.000Z", valueKg: 71.9 },
          batch().upserts[1]!,
        ],
        deletions: [],
      }),
      traceId: "t",
      now,
    });
    expect(late.status).toBe("applied");
    expect((await active()).map((row) => row.numericValue).sort()).toEqual([72.0, 72.1]);
  });

  test("syncStatus reports per-device, per-type metadata only", async () => {
    await register();
    await ingestMobileBatch(db, { organizationId: "org-a", batch: batch(), traceId: "t", now });
    const status = await getMobileSyncStatus(db, { organizationId: "org-a" });
    expect(status).toEqual({
      devices: [
        {
          deviceId: DEVICE,
          provider: "health_connect",
          status: "active",
          lastIngestAt: now.toISOString(),
          perType: { weight: { lastAt: now.toISOString(), lastStatus: "succeeded" } },
        },
      ],
    });
    expect(await getMobileSyncStatus(db, { organizationId: "org-b" })).toEqual({ devices: [] });
  });
});
