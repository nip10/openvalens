import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { createDb, sql } from "@openhealth/db";
import { organization } from "@openhealth/db/schema/auth";
import {
  ingestionError,
  metricDefinition,
  metricSample,
  provenanceLink,
} from "@openhealth/db/schema/health-record";
import { eq } from "drizzle-orm";
import { CanonicalMetricNotFoundError } from "./ingest";
import { createHealthRecordRepository } from "./repository";
import { createMetricMaintenanceRunner, type MetricMaintenanceAudit } from "./scheduler";

const url = process.env.MAINTENANCE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/maintenance_issue17"
  )
    throw new Error("Empty disposable loopback maintenance_issue17 database required.");
}
describe.skipIf(!url)("scheduler disposable PostgreSQL schema", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/maintenance_issue17" });
  const repo = createHealthRecordRepository(db);
  const now = new Date("2026-09-30T12:00:00Z");
  const scope = { organizationId: "org-a", actorUserId: null };
  const request = { metricCode: "weight", dueAt: now };
  const events: MetricMaintenanceAudit[] = [];
  const run = createMetricMaintenanceRunner({
    repository: repo,
    authorizeRetention: async (tenant, policy) =>
      tenant.organizationId === "org-a" && policy.retentionDays === 7,
    writeAudit: async (event) => {
      events.push(event);
      return events.length;
    },
  });
  let a = 0;
  let b = 0;
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
    const rows = await db
      .insert(metricDefinition)
      .values([
        { organizationId: "org-a", code: "weight", displayName: "Weight" },
        { organizationId: "org-b", code: "weight", displayName: "Weight" },
        { organizationId: "org-b", code: "height", displayName: "Height" },
        { organizationId: "org-a", code: "sleep_session", displayName: "Sleep", isActive: false },
      ])
      .returning();
    a = rows.find((row) => row.organizationId === "org-a" && row.code === "weight")!.id;
    b = rows.find((row) => row.organizationId === "org-b" && row.code === "weight")!.id;
  }, 120000);
  beforeEach(async () => {
    events.length = 0;
    await db.delete(provenanceLink);
    await db.delete(ingestionError);
    await db.delete(metricSample);
  });
  afterAll(async () => {
    await db.$client.end();
  });
  async function sample(hash: string, date = "2020-01-01T00:00:00Z", org = "org-a") {
    const [row] = await db
      .insert(metricSample)
      .values({
        organizationId: org,
        metricDefinitionId: org === "org-a" ? a : b,
        sampledAt: new Date(date),
        numericValue: 80,
        dedupeHash: hash,
        metadataJson: { payload: "clinical secret", email: "patient@example.invalid" },
      })
      .returning();
    if (!row) throw new Error("Missing sample.");
    return row;
  }
  async function hashes() {
    return (await db.select({ hash: metricSample.dedupeHash }).from(metricSample))
      .map((row) => row.hash)
      .sort();
  }
  test("absent opt-in preserves even ancient clinical samples and reports no prune", async () => {
    await sample("ancient");
    const result = await run(scope, request, now);
    expect(result).toMatchObject({ status: "completed", retention: null, auditWritten: true });
    expect(await hashes()).toEqual(["ancient"]);
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("clinical secret");
    expect(JSON.stringify(events)).not.toContain("patient@example");
  });
  test("explicit authorized prune is tenant-isolated, bounded, inclusive and repeatable", async () => {
    await sample("old-a-1");
    await sample("old-a-2");
    await sample("old-b", undefined, "org-b");
    await sample("boundary", "2026-09-23T12:00:00Z");
    await sample("recent", "2026-09-30T12:00:00Z");
    const result = await run(scope, { ...request, retentionDays: 7, maxDeleteCount: 1 }, now);
    expect(result).toMatchObject({
      status: "completed",
      retention: { deletedCount: 1, retentionDays: 7, fromUtc: "2026-09-23T12:00:00.000Z" },
    });
    expect(await hashes()).toEqual(["boundary", "old-a-2", "old-b", "recent"]);
    await run(scope, { ...request, retentionDays: 7, maxDeleteCount: 1 }, now);
    expect(await hashes()).toEqual(["boundary", "old-b", "recent"]);
  });
  test("unapproved retention policy does not reach deletion or audit", async () => {
    await sample("old");
    await expect(run(scope, { ...request, retentionDays: 1 }, now)).rejects.toThrow(
      "not authorized",
    );
    expect(await hashes()).toEqual(["old"]);
    expect(events).toHaveLength(0);
  });
  test("both provenance directions and diagnostic references are preserved", async () => {
    const target = await sample("target");
    const source = await sample("source");
    const diagnostic = await sample("diagnostic");
    await sample("unlinked");
    await db.insert(provenanceLink).values({
      organizationId: "org-a",
      targetTable: "metric_sample",
      targetId: target.id,
      sourceTable: "metric_sample",
      sourceId: source.id,
    });
    await db.insert(ingestionError).values({
      organizationId: "org-a",
      metricSampleId: diagnostic.id,
      errorCode: "test",
      message: "clinical secret",
    });
    await run(scope, { ...request, retentionDays: 7 }, now);
    expect(await hashes()).toEqual(["diagnostic", "source", "target"]);
    expect(await db.select().from(provenanceLink)).toHaveLength(1);
    expect(await db.select().from(ingestionError)).toHaveLength(1);
  });
  test("unknown, inactive and foreign-only definitions reject without success audit", async () => {
    for (const metricCode of ["invented", "sleep_session", "height"])
      await expect(run(scope, { ...request, metricCode }, now)).rejects.toBeInstanceOf(
        CanonicalMetricNotFoundError,
      );
    expect(events).toHaveLength(0);
  });
  test("real unique constraint blocks same-org duplicates; different hashes and tenants stay intact", async () => {
    await sample("shared");
    await sample("shared", undefined, "org-b");
    await sample("different");
    await expect(sample("shared")).rejects.toThrow();
    await run(scope, request, now);
    expect(await hashes()).toEqual(["different", "shared", "shared"]);
    expect(events[0]?.metadata.removedDuplicates).toBe(0);
  });
  test("transaction advisory lock excludes overlapping cooperating tenant runs", async () => {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"health-record-maintenance:org-a"}, 0))`,
      );
      expect(await run(scope, request, now)).toEqual({ status: "busy" });
      expect(events).toHaveLength(0);
      // Another tenant is independently runnable.
      expect(await run({ organizationId: "org-b", actorUserId: null }, request, now)).toMatchObject(
        { status: "completed" },
      );
    });
    expect(await run(scope, request, now)).toMatchObject({ status: "completed" });
  });
  test("failed transactional policy calculation leaves samples untouched", async () => {
    await sample("old");
    await expect(
      repo.runMetricMaintenance({
        organizationId: "org-a",
        metricCode: "weight",
        now,
        retentionDays: 0,
        maxDeleteCount: 1,
      }),
    ).rejects.toThrow();
    expect(await hashes()).toEqual(["old"]);
  });
  test("future due instant has no database maintenance or audit effects", async () => {
    await sample("old");
    expect(await run(scope, { ...request, dueAt: new Date(now.getTime() + 1) }, now)).toEqual({
      status: "not_due",
    });
    expect(await hashes()).toEqual(["old"]);
    expect(events).toHaveLength(0);
    expect(
      (await db.select().from(metricDefinition).where(eq(metricDefinition.organizationId, "org-a")))
        .length,
    ).toBe(2);
  });
});
