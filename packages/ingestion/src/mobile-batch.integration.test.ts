import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { createDb, sql } from "@openvalens/db";
import { member, organization, user } from "@openvalens/db/schema/auth";
import { dailyWeight, weightEvent } from "@openvalens/db/schema/body";
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
} from "@openvalens/db/schema/health-record";
import { providerConnection } from "@openvalens/db/schema/ingestion";
import { and, eq } from "drizzle-orm";

import {
  acceptMobileBatch,
  getMobileSyncStatus,
  ingestMobileBatch,
  MOBILE_INGEST_JOB_TYPE,
  MobileDeviceNotRegisteredError,
  MobileDeviceRevokedError,
  DirectDeviceMinuteConflictError,
  registerMobileDevice,
  runMobileIngestBatchJob,
  type MobileIngestBatch,
} from "./mobile-batch";
import { createDatabaseIngestionTick } from "./orchestrator";
import { directSourceIdentity, resolveDataSource } from "./mobile-data-source";
import {
  DirectDeviceContextMismatchError,
  DirectDeviceOwnershipError,
  ingestDirectDeviceBatch,
  registerDirectDevice,
} from "./direct-device";

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
    await db.insert(user).values([
      { id: "u1", name: "U1", email: "u1@example.invalid" },
      { id: "u2", name: "U2", email: "u2@example.invalid" },
    ]);
    await db.insert(member).values([
      { id: "m1", organizationId: "org-a", userId: "u1", role: "owner" },
      { id: "m2", organizationId: "org-a", userId: "u2", role: "member" },
    ]);
  }, 120000);
  beforeEach(async () => {
    await db.delete(dailyWeight);
    await db.delete(weightEvent);
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
      userId: "u1",
      deviceId: DEVICE,
      platform: "android",
      now,
    });

  const directContext = { userId: "u1", organizationId: "org-a" };
  const registerDirect = (deviceId = DEVICE, userId = "u1") =>
    registerDirectDevice(db, {
      deviceId,
      family: "zepp_os",
      modelId: "amazfit_helio_strap",
      expectedContext: { userId, organizationId: "org-a" },
      authenticatedContext: { userId, organizationId: "org-a" },
      now,
    });
  const registerLegacyDirect = (deviceId = DEVICE, userId = "u1") =>
    registerDirectDevice(db, {
      deviceId,
      family: "amazfit_helio_strap",
      expectedContext: { userId, organizationId: "org-a" },
      authenticatedContext: { userId, organizationId: "org-a" },
      now,
    });
  const directBatch = (deviceId = DEVICE) => ({
    schemaVersion: 1 as const,
    deviceId,
    deviceIdentity: { family: "zepp_os" as const, modelId: "amazfit_helio_strap" },
    provider: "direct_device" as const,
    recordType: "steps" as const,
    mode: "backfill" as const,
    clientTimezone: "UTC",
    upserts: [
      {
        type: "steps" as const,
        externalRecordId: "same-local-id",
        sourceApp: null,
        startTime: "2026-10-01T07:00:00Z",
        endTime: "2026-10-01T07:01:00Z",
        count: 10,
      },
    ],
    deletions: [] as [],
  });

  test("direct registration is idempotent under concurrent retries and expected-context mismatch writes nothing", async () => {
    const results = await Promise.all([registerDirect(), registerDirect()]);
    expect(results[0]?.providerConnectionId).toBe(results[1]?.providerConnectionId);
    expect(await db.select().from(providerConnection)).toHaveLength(1);
    await expect(
      registerDirectDevice(db, {
        deviceId: DEVICE,
        family: "amazfit_helio_strap",
        expectedContext: { userId: "u2", organizationId: "org-a" },
        authenticatedContext: directContext,
        now,
      }),
    ).rejects.toBeInstanceOf(DirectDeviceContextMismatchError);
    expect(await db.select().from(providerConnection)).toHaveLength(1);
  });

  test("legacy registration stays unconfirmed until explicit confirmation", async () => {
    await registerLegacyDirect();
    const [before] = await db.select().from(providerConnection);
    expect(before).toMatchObject({ directDeviceFamily: null, directDeviceModelId: null });
    const legacySourceId = await resolveDataSource(
      db,
      "org-a",
      before!.id,
      directSourceIdentity(DEVICE, { family: "zepp_os", modelId: "amazfit_helio_strap" }),
    );
    await db
      .update(dataSource)
      .set({ deviceModel: "old/unconfirmed value" })
      .where(eq(dataSource.id, legacySourceId));
    await expect(
      ingestDirectDeviceBatch(db, {
        expectedContext: directContext,
        authenticatedContext: directContext,
        batch: { ...directBatch(), deviceIdentity: undefined },
        traceId: "legacy-unconfirmed",
        now,
      }),
    ).rejects.toMatchObject({ reason: "IDENTITY_REQUIRED" });
    expect(await db.select().from(ingestionJob)).toHaveLength(0);
    await registerDirectDevice(db, {
      deviceId: DEVICE,
      family: "zepp_os",
      modelId: "amazfit_helio_strap",
      confirmLegacyIdentity: true,
      expectedContext: directContext,
      authenticatedContext: directContext,
      now,
    });
    const [after] = await db.select().from(providerConnection);
    expect(after).toMatchObject({
      directDeviceFamily: "zepp_os",
      directDeviceModelId: "amazfit_helio_strap",
    });
    const [updatedSource] = await db
      .select()
      .from(dataSource)
      .where(eq(dataSource.id, legacySourceId));
    expect(updatedSource?.deviceModel).toBe("Amazfit Helio Strap");
    await expect(
      registerDirectDevice(db, {
        deviceId: DEVICE,
        family: "xiaomi",
        modelId: "xiaomi_mi_band_10",
        expectedContext: directContext,
        authenticatedContext: directContext,
        now,
      }),
    ).rejects.toMatchObject({ reason: "IDENTITY_MISMATCH" });
    await expect(
      ingestDirectDeviceBatch(db, {
        expectedContext: directContext,
        authenticatedContext: directContext,
        batch: { ...directBatch(), deviceIdentity: undefined },
        traceId: "legacy-queued-shape",
        now,
      }),
    ).rejects.toMatchObject({ reason: "IDENTITY_REQUIRED" });
  });

  test("acceptance locks require matching identity before duplicate or job writes", async () => {
    await registerDirect();
    const accept = (payload: MobileIngestBatch, traceId: string) =>
      acceptMobileBatch(db, {
        organizationId: "org-a",
        batch: payload,
        traceId,
        now,
        expectedOwnerId: "u1",
      });
    await expect(
      accept({ ...directBatch(), deviceIdentity: undefined }, "missing"),
    ).rejects.toMatchObject({ reason: "IDENTITY_REQUIRED" });
    await expect(
      accept(
        { ...directBatch(), deviceIdentity: { family: "xiaomi", modelId: "xiaomi_mi_band_10" } },
        "mismatch",
      ),
    ).rejects.toMatchObject({ reason: "IDENTITY_MISMATCH" });
    await expect(
      accept(
        {
          ...directBatch(),
          upserts: [{ ...directBatch().upserts[0]!, endTime: "2026-10-01T07:02:00Z" }],
        },
        "duration",
      ),
    ).rejects.toBeInstanceOf(DirectDeviceMinuteConflictError);
    expect(await db.select().from(ingestionJob)).toHaveLength(0);
    expect(await db.select().from(ingestionRawArtifact)).toHaveLength(0);

    const accepted = await accept(directBatch(), "valid-direct");
    expect(accepted.status).toBe("accepted");
    const [artifact] = await db.select().from(ingestionRawArtifact);
    expect(artifact?.payloadJson).toMatchObject({
      deviceIdentity: { family: "zepp_os", modelId: "amazfit_helio_strap" },
      directDeviceOwnerId: "u1",
    });
    await expect(
      accept({ ...directBatch(), deviceIdentity: undefined }, "duplicate-without-identity"),
    ).rejects.toMatchObject({ reason: "IDENTITY_REQUIRED" });
    expect(await db.select().from(ingestionJob)).toHaveLength(1);
    expect(await db.select().from(ingestionRawArtifact)).toHaveLength(1);
  });

  test("direct replay reports queued work truthfully then a safe duplicate after success", async () => {
    await registerDirect();
    const accepted = await acceptMobileBatch(db, {
      organizationId: "org-a",
      batch: directBatch(),
      traceId: "queued-replay-first",
      now,
      expectedOwnerId: "u1",
    });
    expect(accepted.status).toBe("accepted");
    const queuedReplay = await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: directBatch(),
      traceId: "queued-replay-second",
      now,
      expectedOwnerId: "u1",
      apply: async () => {
        throw new Error("queued duplicate must not inline-apply");
      },
    });
    expect(queuedReplay.status).toBe("queued");
    const applied = await runMobileIngestBatchJob(
      db,
      { jobId: accepted.jobId, organizationId: "org-a" },
      () => now,
    );
    expect(applied.status).toBe("succeeded");
    const succeededReplay = await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: directBatch(),
      traceId: "succeeded-replay",
      now,
      expectedOwnerId: "u1",
    });
    expect(succeededReplay.status).toBe("duplicate");
    expect(await db.select().from(metricSample)).toHaveLength(1);
  });

  test("revoke between acceptance and worker returns terminal refusal, never queued", async () => {
    await registerDirect();
    await expect(
      ingestMobileBatch(db, {
        organizationId: "org-a",
        batch: directBatch(),
        traceId: "revoke-between-steps",
        now,
        expectedOwnerId: "u1",
        apply: async (database, jobInput, clock) => {
          await database
            .update(providerConnection)
            .set({ status: "revoked" })
            .where(
              and(
                eq(providerConnection.organizationId, "org-a"),
                eq(providerConnection.externalUserId, DEVICE),
              ),
            );
          return runMobileIngestBatchJob(database, jobInput, clock);
        },
      }),
    ).rejects.toBeInstanceOf(MobileDeviceRevokedError);
    expect((await db.select().from(ingestionJob))[0]?.status).toBe("failed");
    expect(await db.select().from(ingestionRawArtifact)).toHaveLength(1);
    expect(await db.select().from(metricSample)).toHaveLength(0);
  });

  test("identity change between acceptance and worker returns terminal mismatch, never queued", async () => {
    await registerDirect();
    await expect(
      ingestMobileBatch(db, {
        organizationId: "org-a",
        batch: directBatch(),
        traceId: "identity-change-between-steps",
        now,
        expectedOwnerId: "u1",
        apply: async (database, jobInput, clock) => {
          await database
            .update(providerConnection)
            .set({ directDeviceFamily: "xiaomi", directDeviceModelId: "xiaomi_mi_band_10" })
            .where(
              and(
                eq(providerConnection.organizationId, "org-a"),
                eq(providerConnection.externalUserId, DEVICE),
              ),
            );
          return runMobileIngestBatchJob(database, jobInput, clock);
        },
      }),
    ).rejects.toMatchObject({ reason: "IDENTITY_MISMATCH" });
    expect((await db.select().from(ingestionJob))[0]?.status).toBe("failed");
    expect(await db.select().from(ingestionRawArtifact)).toHaveLength(1);
    expect(await db.select().from(metricSample)).toHaveLength(0);
  });

  test("failed direct replay without a safe stored reason fails closed", async () => {
    await registerDirect();
    const accepted = await acceptMobileBatch(db, {
      organizationId: "org-a",
      batch: directBatch(),
      traceId: "unmapped-terminal-failure",
      now,
      expectedOwnerId: "u1",
    });
    await db
      .update(ingestionJob)
      .set({ status: "failed" })
      .where(and(eq(ingestionJob.id, accepted.jobId), eq(ingestionJob.organizationId, "org-a")));
    await expect(
      ingestMobileBatch(db, {
        organizationId: "org-a",
        batch: directBatch(),
        traceId: "unmapped-terminal-replay",
        now,
        expectedOwnerId: "u1",
      }),
    ).rejects.toBeInstanceOf(MobileDeviceNotRegisteredError);
    expect(await db.select().from(ingestionJob)).toHaveLength(1);
    expect(await db.select().from(ingestionRawArtifact)).toHaveLength(1);
  });

  test("legacy queued direct artifacts fail terminally after confirmation and remain retained", async () => {
    const { providerConnectionId } = await registerDirect();
    const legacy = { ...directBatch(), deviceIdentity: undefined };
    const [job] = await db
      .insert(ingestionJob)
      .values({
        organizationId: "org-a",
        providerConnectionId,
        jobType: MOBILE_INGEST_JOB_TYPE,
        status: "queued",
        triggeredBy: "mobile_device",
        idempotencyKey: "legacy-direct-worker",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: ingestionJob.id });
    const payloadJson = JSON.parse(JSON.stringify(legacy));
    await db.insert(ingestionRawArtifact).values({
      organizationId: "org-a",
      providerConnectionId,
      ingestionJobId: job!.id,
      artifactType: "mobile_health_batch",
      traceId: "legacy-worker-artifact",
      payloadJson,
      sizeBytes: Buffer.byteLength(JSON.stringify(payloadJson)),
      capturedAt: now,
      retentionUntil: new Date(now.getTime() + 86_400_000),
      retentionClass: "mobile_health_batch",
    });
    const result = await runMobileIngestBatchJob(
      db,
      { jobId: job!.id, organizationId: "org-a" },
      () => now,
    );
    expect(result).toMatchObject({ status: "failed", errorCode: "IDENTITY_REQUIRED" });
    expect(await db.select().from(ingestionRawArtifact)).toHaveLength(1);
    expect(await db.select().from(metricSample)).toHaveLength(0);
    await expect(
      runMobileIngestBatchJob(db, { jobId: job!.id, organizationId: "org-a" }, () => now),
    ).rejects.toThrow("pending mobile ingest job not found");
    expect(await db.select().from(ingestionRawArtifact)).toHaveLength(1);
  });

  test("Xiaomi identity produces catalog-derived raw and canonical source models", async () => {
    const deviceId = "5f1c2a3e-9b2d-4c1e-8f3a-2d7e5b9c0a14";
    await registerDirectDevice(db, {
      deviceId,
      family: "xiaomi",
      modelId: "xiaomi_mi_band_10",
      expectedContext: directContext,
      authenticatedContext: directContext,
      now,
    });
    const uploaded = await ingestDirectDeviceBatch(db, {
      expectedContext: directContext,
      authenticatedContext: directContext,
      batch: {
        ...directBatch(deviceId),
        deviceIdentity: { family: "xiaomi", modelId: "xiaomi_mi_band_10" },
        upserts: [
          Object.assign({}, directBatch(deviceId).upserts[0], {
            sourceDevice: { type: "spoof", model: "client controlled" },
          }),
        ] as never,
      },
      traceId: "xiaomi-source",
      now,
    });
    const artifact = await db
      .select()
      .from(ingestionRawArtifact)
      .where(eq(ingestionRawArtifact.id, uploaded.rawArtifactId));
    expect(artifact[0]?.payloadJson).toMatchObject({
      upserts: [{ sourceDevice: { type: "wearable", model: "Xiaomi Smart Band 10" } }],
    });
    const [source] = await db.select().from(dataSource);
    expect(source?.deviceModel).toBe("Xiaomi Smart Band 10");
  });

  test("direct binding refuses null, wrong, and revoked owners without transfer or reactivation", async () => {
    await registerDirect();
    await db.update(providerConnection).set({ userId: "u2" });
    await expect(registerDirect()).rejects.toBeInstanceOf(DirectDeviceOwnershipError);
    await expect(
      ingestDirectDeviceBatch(db, {
        expectedContext: directContext,
        authenticatedContext: directContext,
        batch: directBatch(),
        traceId: "wrong-owner",
        now,
      }),
    ).rejects.toBeInstanceOf(MobileDeviceNotRegisteredError);
    expect(await db.select().from(ingestionJob)).toHaveLength(0);
    await db.update(providerConnection).set({ userId: null });
    await expect(registerDirect()).rejects.toBeInstanceOf(DirectDeviceOwnershipError);
    await db.update(providerConnection).set({ userId: "u1", status: "revoked" });
    await expect(registerDirect()).rejects.toBeInstanceOf(MobileDeviceRevokedError);
    const [row] = await db.select().from(providerConnection);
    expect(row).toMatchObject({ userId: "u1", status: "revoked" });
  });

  test("direct owner check is transactional on acceptance and source identity is device-bound", async () => {
    const secondDevice = "7f1c2a3e-9b2d-4c1e-8f3a-2d7e5b9c0a12";
    const { providerConnectionId: firstConnection } = await registerDirect();
    const { providerConnectionId: secondConnection } = await registerDirect(secondDevice);
    const first = await ingestDirectDeviceBatch(db, {
      expectedContext: directContext,
      authenticatedContext: directContext,
      batch: directBatch(),
      traceId: "direct-1",
      now,
    });
    const replay = await ingestDirectDeviceBatch(db, {
      expectedContext: directContext,
      authenticatedContext: directContext,
      batch: directBatch(),
      traceId: "direct-2",
      now,
    });
    const rebatch = await ingestDirectDeviceBatch(db, {
      expectedContext: directContext,
      authenticatedContext: directContext,
      batch: {
        ...directBatch(),
        clientTimezone: "Europe/Lisbon",
        window: { from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z" },
      },
      traceId: "direct-rebatch",
      now,
    });
    await ingestDirectDeviceBatch(db, {
      expectedContext: directContext,
      authenticatedContext: directContext,
      batch: directBatch(secondDevice),
      traceId: "direct-3",
      now,
    });
    expect(replay.status).toBe("duplicate");
    expect(rebatch.status).toBe("duplicate");
    expect(await db.select().from(ingestionRawArtifact)).toHaveLength(2);
    const sources = await db.select().from(dataSource);
    expect(sources).toHaveLength(2);
    expect(new Set(sources.map((source) => source.sourceKey)).size).toBe(2);
    expect(sources.map((source) => source.providerConnectionId).sort()).toEqual(
      [firstConnection, secondConnection].sort(),
    );
    expect(sources.every((source) => source.importChannel === "direct_device")).toBe(true);
    const [artifact] = await db
      .select()
      .from(ingestionRawArtifact)
      .where(eq(ingestionRawArtifact.id, first.rawArtifactId));
    expect(artifact?.payloadJson).toMatchObject({
      deviceIdentity: { family: "zepp_os", modelId: "amazfit_helio_strap" },
      directDeviceOwnerId: "u1",
      upserts: [
        {
          externalRecordId: `dd:v1:${DEVICE}:steps:same-local-id`,
          sourceApp: null,
          sourceDevice: { model: "Amazfit Helio Strap" },
        },
      ],
    });
  });

  test("direct step minutes deduplicate across local ids and reject conflicting values", async () => {
    await registerDirect();
    const publish = (externalRecordId: string, count: number, traceId: string) =>
      ingestDirectDeviceBatch(db, {
        expectedContext: directContext,
        authenticatedContext: directContext,
        batch: {
          ...directBatch(),
          upserts: [{ ...directBatch().upserts[0]!, externalRecordId, count }],
        },
        traceId,
        now,
      });
    const first = await publish("page-a", 10, "minute-a");
    expect(first.status).toBe("applied");
    const duplicate = await publish("page-b", 10, "minute-b");
    expect(duplicate.status).toBe("applied");
    expect(duplicate.duplicates).toBe(0);
    expect(await db.select().from(metricSample)).toHaveLength(1);
    await expect(publish("page-c", 11, "minute-c")).rejects.toBeInstanceOf(
      DirectDeviceMinuteConflictError,
    );
    await expect(publish("page-c", 11, "minute-c")).rejects.toBeInstanceOf(
      DirectDeviceMinuteConflictError,
    );
    expect(await db.select().from(metricSample)).toHaveLength(1);
    expect(await db.select().from(ingestionJob)).toHaveLength(3);
    expect(await db.select().from(ingestionRawArtifact)).toHaveLength(3);
  });

  test("concurrent contradictory direct uploads serialize to one published value", async () => {
    await registerDirect();
    const upload = (externalRecordId: string, count: number, traceId: string) =>
      ingestDirectDeviceBatch(db, {
        expectedContext: directContext,
        authenticatedContext: directContext,
        batch: {
          ...directBatch(),
          upserts: [{ ...directBatch().upserts[0]!, externalRecordId, count }],
        },
        traceId,
        now,
      });
    const outcomes = await Promise.allSettled([
      upload("race-a", 10, "race-a"),
      upload("race-b", 11, "race-b"),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(
      DirectDeviceMinuteConflictError,
    );
    expect(await db.select().from(metricSample)).toHaveLength(1);
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

  test("legacy phone connections share a source for matching metadata while direct bindings stay fenced", async () => {
    const secondDevice = "7f1c2a3e-9b2d-4c1e-8f3a-2d7e5b9c0a12";
    const firstConnection = await register();
    const secondConnection = await registerMobileDevice(db, {
      organizationId: "org-a",
      userId: "u1",
      deviceId: secondDevice,
      platform: "android",
      now,
    });
    const phoneBatch = (deviceId: string, recordId: string): MobileIngestBatch => ({
      ...batch({
        upserts: [
          {
            type: "weight",
            externalRecordId: recordId,
            sourceApp: "com.withings.wiscale2",
            sourceDevice: { type: "scale", model: "Body+" },
            startTime: "2026-10-01T07:00:00.000Z",
            valueKg: 72.4,
          },
        ],
        deletions: [],
      }),
      deviceId,
    });
    expect(
      (
        await ingestMobileBatch(db, {
          organizationId: "org-a",
          batch: phoneBatch(DEVICE, "legacy-1"),
          traceId: "legacy-1",
          now,
        })
      ).status,
    ).toBe("applied");
    expect(
      (
        await ingestMobileBatch(db, {
          organizationId: "org-a",
          batch: phoneBatch(secondDevice, "legacy-2"),
          traceId: "legacy-2",
          now,
        })
      ).status,
    ).toBe("applied");

    const [source] = await db.select().from(dataSource);
    expect(await db.select().from(dataSource)).toHaveLength(1);
    expect(source?.providerConnectionId).toBe(firstConnection.providerConnectionId);
    expect((await db.select().from(metricSample)).map((sample) => sample.dataSourceId)).toEqual([
      source!.id,
      source!.id,
    ]);
    expect(secondConnection.providerConnectionId).not.toBe(firstConnection.providerConnectionId);

    const directDevice = "8f1c2a3e-9b2d-4c1e-8f3a-2d7e5b9c0a13";
    const directFirst = await registerDirect();
    const directSecond = await registerDirect(directDevice);
    await ingestDirectDeviceBatch(db, {
      expectedContext: directContext,
      authenticatedContext: directContext,
      batch: directBatch(),
      traceId: "direct-fence-first",
      now,
    });
    // A direct identity remains owned by its exact connection.
    await expect(
      resolveDataSource(
        db,
        "org-a",
        directSecond.providerConnectionId,
        directSourceIdentity(DEVICE, { family: "zepp_os", modelId: "amazfit_helio_strap" }),
      ),
    ).rejects.toThrow("Data source identity is already owned by another provider connection.");
    expect(directFirst.providerConnectionId).not.toBe(directSecond.providerConnectionId);
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
      userId: "u1",
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

  const days = () => db.select().from(dailyWeight);
  const autoEvents = () => db.select().from(weightEvent);

  test("phone weights feed the owner's daily weight on the local date", async () => {
    await register();
    await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({
        deletions: [],
        // 23:30 UTC on 30 Sep is 00:30 on 1 Oct in Lisbon.
        upserts: [
          {
            type: "weight",
            externalRecordId: "w-late",
            sourceApp: "com.withings.wiscale2",
            startTime: "2026-09-30T23:30:00.000Z",
            valueKg: 71.5,
          },
        ],
      }),
      traceId: "t",
      now,
    });
    const [event] = await autoEvents();
    expect(event).toMatchObject({
      userId: "u1",
      source: "auto",
      date: "2026-10-01",
      weightKg: 71.5,
      supersededAt: null,
    });
    const [sample] = await db.select().from(metricSample);
    expect(event?.metadataJson).toMatchObject({
      metricSampleId: sample!.id,
      externalRecordId: "w-late",
    });
    expect(await days()).toMatchObject([
      {
        userId: "u1",
        date: "2026-10-01",
        weightKg: 71.5,
        source: "auto",
        resolvedFromEventId: event!.id,
      },
    ]);
  });

  test("deleting a phone weight supersedes its auto event and clears the derived day", async () => {
    await register();
    await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({ deletions: [], upserts: [batch().upserts[0]!] }),
      traceId: "t",
      now,
    });
    expect(await days()).toHaveLength(1);
    await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({ upserts: [], deletions: [{ externalRecordId: "w-1" }] }),
      traceId: "t",
      now,
    });
    const [event] = await autoEvents();
    expect(event?.supersededAt).not.toBeNull();
    expect(await days()).toEqual([]);
  });

  test("an edited phone weight replaces the day's value", async () => {
    await register();
    type Weight = Extract<MobileIngestBatch["upserts"][number], { type: "weight" }>;
    const [w1] = batch().upserts as Weight[];
    await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({
        deletions: [],
        upserts: [{ ...w1!, lastModifiedAt: "2026-10-01T08:00:00.000Z" }],
      }),
      traceId: "t",
      now,
    });
    await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({
        deletions: [],
        upserts: [{ ...w1!, lastModifiedAt: "2026-10-01T09:00:00.000Z", valueKg: 70.9 }],
      }),
      traceId: "t",
      now,
    });
    expect((await days()).map((d) => d.weightKg)).toEqual([70.9]);
    const active = (await autoEvents()).filter((e) => e.supersededAt === null);
    expect(active.map((e) => e.weightKg)).toEqual([70.9]);
  });

  test("a device with no owner still ingests but skips the body bridge", async () => {
    await register();
    await db.update(providerConnection).set({ userId: null });
    const res = await ingestMobileBatch(db, {
      organizationId: "org-a",
      batch: batch({ deletions: [] }),
      traceId: "t",
      now,
    });
    expect(res.status).toBe("applied");
    expect(await autoEvents()).toEqual([]);
  });

  test("registering under another account moves ownership", async () => {
    await register();
    await registerMobileDevice(db, {
      organizationId: "org-a",
      userId: "u2",
      deviceId: DEVICE,
      platform: "android",
      now,
    });
    const [row] = await db.select().from(providerConnection);
    expect(row?.userId).toBe("u2");
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
