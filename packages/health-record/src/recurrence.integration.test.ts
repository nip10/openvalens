import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { createDb, sql } from "@openvalens/db";
import { organization, user, member } from "@openvalens/db/schema/auth";
import { providerConnection } from "@openvalens/db/schema/ingestion";
import { dataSource, metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import { eq } from "drizzle-orm";
import { CanonicalMetricNotFoundError } from "./ingest";
import { RetentionPolicyRequiredError } from "./recurrence";
import { createHealthRecordRepository } from "./repository";

// Opt-in only; never accept a production URL or existing database. This test
// applies the ACTUAL repository migrations to an empty disposable database
// and exercises the bounded retention/dedupe surface across two tenants.
const url = process.env.RECURRENCE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/recurrence_issue17"
  )
    throw new Error("Disposable loopback recurrence_issue17 database required.");
}

describe.skipIf(!url)("recurrence real PostgreSQL schema", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/recurrence_issue17" });
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
    await db.insert(metricDefinition).values([
      {
        organizationId: "org-a",
        code: "weight",
        displayName: "Weight",
        category: "body",
        unit: "kg",
      },
      {
        organizationId: "org-b",
        code: "weight",
        displayName: "Weight",
        category: "body",
        unit: "kg",
      },
    ]);
  }, 120000);

  afterAll(async () => {
    await db.$client.end();
  });

  test("getMetricRetentionPolicy reports no default retention for weight + UTC", async () => {
    const policy = await repo.getMetricRetentionPolicy({
      organizationId: "org-a",
      metricCode: "weight",
    });
    expect(policy.canonicalMetricCode).toBe("weight");
    // No invented clinical retention: nothing is configured by default.
    expect(policy.retentionDays).toBeNull();
    expect(policy.timezone).toBe("UTC");
    expect(policy.category).toBe("body");
    expect(policy.unit).toBe("kg");
  });

  test("getMetricRetentionPolicy rejects an unknown taxonomy code with CanonicalMetricNotFoundError", async () => {
    await expect(
      repo.getMetricRetentionPolicy({
        organizationId: "org-a",
        metricCode: "made_up_marker",
      }),
    ).rejects.toBeInstanceOf(CanonicalMetricNotFoundError);
  });

  test("getMetricRetentionPolicy rejects an unregistered tenant metric", async () => {
    // `resting_heart_rate` is in the taxonomy but never registered
    // for either org — the catalog gap must surface as
    // CanonicalMetricNotFoundError.
    await expect(
      repo.getMetricRetentionPolicy({
        organizationId: "org-a",
        metricCode: "resting_heart_rate",
      }),
    ).rejects.toBeInstanceOf(CanonicalMetricNotFoundError);
  });

  test("pruneMetricSamples without explicit retention throws and deletes nothing, even for ancient samples", async () => {
    const [aDefinition] = await db
      .select()
      .from(metricDefinition)
      .where(eq(metricDefinition.organizationId, "org-a"));
    if (!aDefinition) throw new Error("Missing org-a definition.");
    await db.insert(metricSample).values({
      organizationId: "org-a",
      metricDefinitionId: aDefinition.id,
      sampledAt: new Date("1990-01-01T00:00:00Z"),
      numericValue: 81,
      unit: "kg",
      dedupeHash: "ancient-no-policy",
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        repo.pruneMetricSamples({
          organizationId: "org-a",
          metricCode: "weight",
          now: new Date("2026-09-30T12:00:00Z"),
        } as never),
      ).rejects.toThrow(RetentionPolicyRequiredError);
    }
    const survivors = await db
      .select({ id: metricSample.id })
      .from(metricSample)
      .where(eq(metricSample.dedupeHash, "ancient-no-policy"));
    expect(survivors).toHaveLength(1);
    await db.delete(metricSample).where(eq(metricSample.dedupeHash, "ancient-no-policy"));
  });

  test("pruneMetricSamples deletes only out-of-window rows and leaves foreign-tenant rows alone", async () => {
    // Seed: org-a weight samples — one inside the window, two outside.
    // Org-b weight sample (registered up front for the isolation check) — must NOT be touched.
    const [aDefinition] = await db
      .select()
      .from(metricDefinition)
      .where(eq(metricDefinition.organizationId, "org-a"));
    if (!aDefinition) throw new Error("Missing org-a definition.");

    // Register weight for org-b so the cross-tenant isolation test
    // exercises an actual second-tenant row (not just the catalog gap).
    await repo.ingestMetricDefinition({
      organizationId: "org-b",
      payload: { metricCode: "weight" },
    });
    const [bDefinition] = await db
      .select()
      .from(metricDefinition)
      .where(eq(metricDefinition.organizationId, "org-b"));
    if (!bDefinition) throw new Error("Missing org-b definition.");

    const insideWindow = new Date("2026-09-29T12:00:00Z"); // within the last 365d of `now`
    const outsideWindow = new Date("2025-08-01T00:00:00Z"); // ~14 months before `now`
    const farOutsideWindow = new Date("2020-01-01T00:00:00Z");

    // Use direct inserts with deterministic dedupeHash values so we can
    // rely on the unique-constraint key without racing the ingest seam.
    await db.insert(metricSample).values([
      {
        organizationId: "org-a",
        metricDefinitionId: aDefinition.id,
        sampledAt: insideWindow,
        numericValue: 80,
        unit: "kg",
        dedupeHash: "prune-inside-a",
      },
      {
        organizationId: "org-a",
        metricDefinitionId: aDefinition.id,
        sampledAt: outsideWindow,
        numericValue: 81,
        unit: "kg",
        dedupeHash: "prune-outside-a",
      },
      {
        organizationId: "org-a",
        metricDefinitionId: aDefinition.id,
        sampledAt: farOutsideWindow,
        numericValue: 82,
        unit: "kg",
        dedupeHash: "prune-far-a",
      },
      {
        organizationId: "org-b",
        metricDefinitionId: bDefinition.id,
        sampledAt: farOutsideWindow,
        numericValue: 70,
        unit: "kg",
        dedupeHash: "prune-outside-b",
      },
    ]);

    const now = new Date("2026-09-30T12:00:00Z");
    const result = await repo.pruneMetricSamples({
      organizationId: "org-a",
      metricCode: "weight",
      now,
      retentionDays: 365,
    });

    expect(result.canonicalMetricCode).toBe("weight");
    expect(result.deletedCount).toBe(2);
    expect(result.retentionDays).toBe(365);
    expect(result.fromUtc).toBe(new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString());
    expect(result.toUtc).toBe(now.toISOString());

    const remainingA = await db
      .select({ id: metricSample.id, dedupeHash: metricSample.dedupeHash })
      .from(metricSample)
      .where(eq(metricSample.organizationId, "org-a"));
    expect(remainingA.map((row) => row.dedupeHash).sort()).toEqual(["prune-inside-a"]);
    // Cross-tenant row survived untouched.
    const remainingB = await db
      .select({ id: metricSample.id, dedupeHash: metricSample.dedupeHash })
      .from(metricSample)
      .where(eq(metricSample.organizationId, "org-b"));
    expect(remainingB.map((row) => row.dedupeHash).sort()).toEqual(["prune-outside-b"]);
  });

  test("pruneMetricSamples is a no-op when called twice with the same window (idempotency)", async () => {
    // Continue from the previous test: org-a now holds only the inside-window row.
    const now = new Date("2026-09-30T12:00:00Z");
    const first = await repo.pruneMetricSamples({
      organizationId: "org-a",
      metricCode: "weight",
      now,
      retentionDays: 365,
    });
    expect(first.deletedCount).toBe(0);
    const second = await repo.pruneMetricSamples({
      organizationId: "org-a",
      metricCode: "weight",
      now,
      retentionDays: 365,
    });
    expect(second.deletedCount).toBe(0);
    expect(second.canonicalMetricCode).toBe("weight");
    expect(second.retentionDays).toBe(365);
  });

  test("pruneMetricSamples respects a caller override of retentionDays", async () => {
    // Add an "older but inside default 365d" sample, then prune with
    // a 7-day override — the older sample must be deleted while the
    // recent one survives.
    const [aDefinition] = await db
      .select()
      .from(metricDefinition)
      .where(eq(metricDefinition.organizationId, "org-a"));
    if (!aDefinition) throw new Error("Missing org-a definition.");

    await db.insert(metricSample).values({
      organizationId: "org-a",
      metricDefinitionId: aDefinition.id,
      sampledAt: new Date("2026-09-22T12:00:00Z"), // 8d before now — outside the 7d window
      numericValue: 79,
      unit: "kg",
      dedupeHash: "override-7d",
    });

    const now = new Date("2026-09-30T12:00:00Z");
    const result = await repo.pruneMetricSamples({
      organizationId: "org-a",
      metricCode: "weight",
      now,
      retentionDays: 7,
    });
    expect(result.retentionDays).toBe(7);
    expect(result.deletedCount).toBe(1);

    const remaining = await db
      .select({ dedupeHash: metricSample.dedupeHash })
      .from(metricSample)
      .where(eq(metricSample.organizationId, "org-a"));
    // "prune-inside-a" remains; the 7d-bound row was deleted.
    expect(remaining.map((row) => row.dedupeHash).sort()).toEqual(["prune-inside-a"]);
  });

  test("applyDedupeForMetric is idempotent across repeated calls on a single-tenant fixture", async () => {
    const first = await repo.applyDedupeForMetric({
      organizationId: "org-a",
      metricCode: "weight",
      now: new Date("2026-09-30T12:00:00Z"),
    });
    expect(first.removedDuplicates).toBe(0);
    expect(first.canonicalMetricCode).toBe("weight");

    const second = await repo.applyDedupeForMetric({
      organizationId: "org-a",
      metricCode: "weight",
      now: new Date("2026-09-30T12:00:00Z"),
    });
    expect(second.removedDuplicates).toBe(0);
  });

  test("applyDedupeForMetric rejects unknown taxonomy with CanonicalMetricNotFoundError", async () => {
    await expect(
      repo.applyDedupeForMetric({
        organizationId: "org-a",
        metricCode: "made_up_marker",
        now: new Date(),
      }),
    ).rejects.toBeInstanceOf(CanonicalMetricNotFoundError);
  });

  test("applyDedupeForMetric rejects unregistered tenant metric with CanonicalMetricNotFoundError", async () => {
    // org-a has no `resting_heart_rate` definition registered.
    await expect(
      repo.applyDedupeForMetric({
        organizationId: "org-a",
        metricCode: "resting_heart_rate",
        now: new Date(),
      }),
    ).rejects.toBeInstanceOf(CanonicalMetricNotFoundError);
  });

  test("applyDedupeForMetric ignores foreign-tenant rows even when they share dedupeHash values", async () => {
    // Cross-tenant dedupeHash uniqueness is NOT enforced; we explicitly
    // seed both orgs with the same dedupeHash to confirm the per-tenant
    // predicate is honoured and no foreign rows are touched.
    const [aDefinition] = await db
      .select()
      .from(metricDefinition)
      .where(eq(metricDefinition.organizationId, "org-a"));
    const [bDefinition] = await db
      .select()
      .from(metricDefinition)
      .where(eq(metricDefinition.organizationId, "org-b"));
    if (!aDefinition || !bDefinition) throw new Error("Missing definitions.");

    await db.insert(metricSample).values([
      {
        organizationId: "org-a",
        metricDefinitionId: aDefinition.id,
        sampledAt: new Date("2026-09-28T12:00:00Z"),
        numericValue: 78,
        unit: "kg",
        dedupeHash: "shared-hash",
      },
      {
        organizationId: "org-b",
        metricDefinitionId: bDefinition.id,
        sampledAt: new Date("2026-09-28T12:00:00Z"),
        numericValue: 65,
        unit: "kg",
        dedupeHash: "shared-hash",
      },
    ]);

    const result = await repo.applyDedupeForMetric({
      organizationId: "org-a",
      metricCode: "weight",
      now: new Date("2026-09-30T12:00:00Z"),
    });
    expect(result.removedDuplicates).toBe(0);

    const sharedA = await db
      .select({ id: metricSample.id })
      .from(metricSample)
      .where(eq(metricSample.dedupeHash, "shared-hash"));
    expect(sharedA).toHaveLength(2);
  });

  test("PHI-bearing retention and dedupe calls emit no console payloads", async () => {
    const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
    try {
      await repo.pruneMetricSamples({
        organizationId: "org-a",
        metricCode: "weight",
        now: new Date("2026-09-30T12:00:00Z"),
        retentionDays: 365,
      });
      await repo.applyDedupeForMetric({
        organizationId: "org-a",
        metricCode: "weight",
        now: new Date("2026-09-30T12:00:00Z"),
      });
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally {
      for (const log of logs) log.mockRestore();
    }
  });
});
