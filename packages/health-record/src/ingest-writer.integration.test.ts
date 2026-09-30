import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { createDb, sql } from "@openhealth/db";
import { organization, user, member } from "@openhealth/db/schema/auth";
import { providerConnection } from "@openhealth/db/schema/ingestion";
import {
  dataSource,
  ingestionJob,
  metricDefinition,
  metricSample,
} from "@openhealth/db/schema/health-record";
import { eq } from "drizzle-orm";
import { CanonicalMetricNotFoundError, CrossTenantReferenceError } from "./ingest";
import { createHealthRecordRepository } from "./repository";

// Opt-in only; never accept a production URL or existing database. This test
// applies the ACTUAL repository migrations to an empty disposable database
// and exercises the bounded ingest write seam.
const url = process.env.INGEST_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/ingest_seam_issue17"
  )
    throw new Error("Disposable loopback ingest_seam_issue17 database required.");
}

describe.skipIf(!url)("ingest write seam real PostgreSQL schema", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/ingest_seam_issue17" });
  const repo = createHealthRecordRepository(db);

  beforeAll(async () => {
    const existing = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (existing.rows.length) throw new Error("Integration database must be empty.");
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
      { id: "user-a", email: "a@example.invalid", name: "A" },
      { id: "user-b", email: "b@example.invalid", name: "B" },
    ]);
    await db.insert(member).values([
      { id: "member-a", userId: "user-a", organizationId: "org-a", role: "owner" },
      { id: "member-b", userId: "user-b", organizationId: "org-b", role: "owner" },
    ]);
    await db.insert(providerConnection).values([
      { organizationId: "org-a", provider: "manual", externalUserId: "u" },
      { organizationId: "org-b", provider: "manual", externalUserId: "u" },
    ]);
    const [aConnection] = await db
      .select()
      .from(providerConnection)
      .where(eq(providerConnection.organizationId, "org-a"));
    const [bConnection] = await db
      .select()
      .from(providerConnection)
      .where(eq(providerConnection.organizationId, "org-b"));
    if (!aConnection || !bConnection) throw new Error("Missing seed connection.");
    const [aSource] = await db
      .insert(dataSource)
      .values({
        organizationId: "org-a",
        providerConnectionId: aConnection.id,
        sourceType: "manual",
        sourceKey: "manual",
        displayName: "Manual",
      })
      .returning();
    const [bSource] = await db
      .insert(dataSource)
      .values({
        organizationId: "org-b",
        providerConnectionId: bConnection.id,
        sourceType: "manual",
        sourceKey: "manual",
        displayName: "Manual",
      })
      .returning();
    if (!aSource || !bSource) throw new Error("Missing seed data source.");
  }, 120000);

  afterAll(async () => {
    await db.$client.end();
  });

  test("ingestMetricDefinition upserts with taxonomy-derived unit/category/valueType", async () => {
    const row = await repo.ingestMetricDefinition({
      organizationId: "org-a",
      payload: {
        metricCode: "weight",
        displayName: "Body Mass",
        sourceId: null,
      },
    });
    expect(row.code).toBe("weight");
    expect(row.displayName).toBe("Body Mass");
    expect(row.unit).toBe("kg");
    expect(row.category).toBe("body");
    expect(row.valueType).toBe("number");
    expect(row.aggregationDefault).toBe("latest");
    expect(row.canonicalMetricCode).toBe("weight");
    expect(row.isBloodMarkerFamily).toBe(false);

    const [stored] = await db
      .select({
        code: metricDefinition.code,
        unit: metricDefinition.unit,
        category: metricDefinition.category,
      })
      .from(metricDefinition)
      .where(eq(metricDefinition.organizationId, "org-a"));
    expect(stored?.code).toBe("weight");
    expect(stored?.unit).toBe("kg");
    expect(stored?.category).toBe("body");
  });

  test("ingestMetricDefinition rejects a foreign-tenant sourceId with CrossTenantReferenceError", async () => {
    // First, look up the foreign data source id from org-b.
    const [bSource] = await db
      .select({ id: dataSource.id })
      .from(dataSource)
      .where(eq(dataSource.organizationId, "org-b"));
    if (!bSource) throw new Error("Missing org-b data source.");
    await expect(
      repo.ingestMetricDefinition({
        organizationId: "org-a",
        payload: {
          metricCode: "resting_heart_rate",
          sourceId: bSource.id,
        },
      }),
    ).rejects.toBeInstanceOf(CrossTenantReferenceError);
  });

  test("ingestMetricDefinition rejects unknown taxonomy codes with CanonicalMetricNotFoundError", async () => {
    await expect(
      repo.ingestMetricDefinition({
        organizationId: "org-a",
        payload: {
          metricCode: "made_up_marker",
        },
      }),
    ).rejects.toBeInstanceOf(CanonicalMetricNotFoundError);
  });

  test("ingestMetricSample writes taxonomy-derived unit and a deterministic dedupe hash", async () => {
    const sample = await repo.ingestMetricSample({
      organizationId: "org-a",
      userId: "user-a",
      payload: {
        metricCode: "weight",
        observedAt: "2026-09-29T12:00:00.000Z",
        valueNumeric: 84,
        sourceId: null,
      },
    });
    expect(sample.unit).toBe("kg");
    expect(sample.numericValue).toBe(84);
    expect(sample.canonicalMetricCode).toBe("weight");
    expect(sample.taxonomyUnit).toBe("kg");
    expect(sample.ingestQualityFlags).toEqual([]);
    expect(sample.dedupeHash).toMatch(/^[0-9a-f]{64}$/);

    const [stored] = await db
      .select({
        unit: metricSample.unit,
        numericValue: metricSample.numericValue,
        dedupeHash: metricSample.dedupeHash,
      })
      .from(metricSample)
      .where(eq(metricSample.organizationId, "org-a"));
    expect(stored?.unit).toBe("kg");
    expect(stored?.numericValue).toBe(84);
    expect(stored?.dedupeHash).toBe(sample.dedupeHash);
  });

  test("ingestMetricSample flags unit_mismatch when the declared unit contradicts the taxonomy", async () => {
    const sample = await repo.ingestMetricSample({
      organizationId: "org-a",
      userId: "user-a",
      payload: {
        metricCode: "weight",
        observedAt: "2026-09-29T13:00:00.000Z",
        valueNumeric: 84,
        payload: { unit: "lb" },
      },
    });
    expect(sample.ingestQualityFlags).toContain("unit_mismatch");
    expect(sample.unit).toBe("kg");
  });

  test("ingestMetricSample rejects a foreign-tenant sourceId with CrossTenantReferenceError", async () => {
    const [bSource] = await db
      .select({ id: dataSource.id })
      .from(dataSource)
      .where(eq(dataSource.organizationId, "org-b"));
    if (!bSource) throw new Error("Missing org-b data source.");
    await expect(
      repo.ingestMetricSample({
        organizationId: "org-a",
        userId: "user-a",
        payload: {
          metricCode: "weight",
          observedAt: "2026-09-29T14:00:00.000Z",
          valueNumeric: 84,
          sourceId: bSource.id,
        },
      }),
    ).rejects.toBeInstanceOf(CrossTenantReferenceError);
  });

  test("ingestMetricSample rejects when the metric is not in the active tenant catalog", async () => {
    // org-b has no metric_definition yet — registering weight for org-a
    // and then trying to ingest from org-b must surface NOT_FOUND.
    await repo.ingestMetricDefinition({
      organizationId: "org-a",
      payload: { metricCode: "weight" },
    });
    await expect(
      repo.ingestMetricSample({
        organizationId: "org-b",
        userId: "user-b",
        payload: {
          metricCode: "weight",
          observedAt: "2026-09-29T15:00:00.000Z",
          valueNumeric: 84,
        },
      }),
    ).rejects.toBeInstanceOf(CanonicalMetricNotFoundError);
  });

  test("ingestMetricSample cross-tenant isolation: org-b samples never appear in org-a reads", async () => {
    // Register weight for org-b and ingest a sample.
    await repo.ingestMetricDefinition({
      organizationId: "org-b",
      payload: { metricCode: "weight" },
    });
    await repo.ingestMetricSample({
      organizationId: "org-b",
      userId: "user-b",
      payload: {
        metricCode: "weight",
        observedAt: "2026-09-29T16:00:00.000Z",
        valueNumeric: 70,
      },
    });
    // The DB-level FK plus the per-org catalog check must keep the
    // org-b row out of org-a's view.
    const orgARows = await db
      .select({
        organizationId: metricSample.organizationId,
        numericValue: metricSample.numericValue,
      })
      .from(metricSample)
      .where(eq(metricSample.organizationId, "org-a"));
    for (const row of orgARows) {
      expect(row.organizationId).toBe("org-a");
      expect(row.numericValue).not.toBe(70);
    }
  });

  test("ingestWriteIngestionJob writes a typed ingestion_job row", async () => {
    const row = await repo.ingestWriteIngestionJob({
      organizationId: "org-a",
      payload: {
        jobType: "health_connect",
        idempotencyKey: "test-key-1",
      },
    });
    expect(row.jobType).toBe("health_connect");
    expect(row.status).toBe("queued");
    expect(row.triggeredBy).toBe("api");
    expect(row.organizationId).toBe("org-a");
    expect(row.idempotencyKey).toBe("test-key-1");

    const [stored] = await db
      .select({
        organizationId: ingestionJob.organizationId,
        jobType: ingestionJob.jobType,
        triggeredBy: ingestionJob.triggeredBy,
      })
      .from(ingestionJob)
      .where(eq(ingestionJob.id, row.id));
    expect(stored?.organizationId).toBe("org-a");
    expect(stored?.jobType).toBe("health_connect");
    expect(stored?.triggeredBy).toBe("api");
  });

  test("resolveCanonicalMetric returns the tenant row when registered, null otherwise", async () => {
    const registered = await repo.resolveCanonicalMetric("org-a", "weight");
    expect(registered.tenant?.id).toBeDefined();
    expect(registered.resolved.unit).toBe("kg");
    expect(registered.resolved.isBloodMarkerFamily).toBe(false);

    const unregistered = await repo.resolveCanonicalMetric("org-a", "resting_heart_rate");
    expect(unregistered.tenant).toBeNull();
    expect(unregistered.resolved.canonicalMetricCode).toBe("resting_heart_rate");

    const bloodFamily = await repo.resolveCanonicalMetric("org-a", "blood_marker_glucose");
    expect(bloodFamily.tenant).toBeNull();
    expect(bloodFamily.resolved.canonicalMetricCode).toBe("blood_marker_glucose");
    expect(bloodFamily.resolved.isBloodMarkerFamily).toBe(true);

    await expect(repo.resolveCanonicalMetric("org-a", "made_up_marker")).rejects.toBeInstanceOf(
      CanonicalMetricNotFoundError,
    );
  });

  test("PHI-bearing ingest writes emit no console payloads", async () => {
    const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
    try {
      await repo.ingestMetricSample({
        organizationId: "org-a",
        userId: "user-a",
        payload: {
          metricCode: "weight",
          observedAt: "2026-09-29T17:00:00.000Z",
          valueNumeric: 84,
        },
      });
      await repo.ingestMetricDefinition({
        organizationId: "org-a",
        payload: { metricCode: "weight" },
      });
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally {
      for (const log of logs) log.mockRestore();
    }
  });
});
