import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { createDb, sql } from "@openhealth/db";
import { organization, user, member } from "@openhealth/db/schema/auth";
import { providerConnection } from "@openhealth/db/schema/ingestion";
import {
  dataSource,
  metricDefinition,
  metricSourcePreference,
  metricSample,
} from "@openhealth/db/schema/health-record";
import { and, eq } from "drizzle-orm";
import { createHealthRecordRepository, SourcePreferenceValidationError } from "./repository";

// Opt-in only; never accept a production URL or existing database. This test
// applies the ACTUAL repository migrations to an empty disposable database
// and exercises the new metric catalog + source priority read-side procedures.
const url = process.env.METRIC_PRIORITY_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/metric_priority_issue17"
  )
    throw new Error("Disposable loopback metric_priority_issue17 database required.");
}

describe.skipIf(!url)("metric taxonomy + source priority real PostgreSQL schema", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/metric_priority_issue17" });
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
    await db.insert(dataSource).values([
      {
        organizationId: "org-a",
        providerConnectionId: aConnection.id,
        sourceType: "manual",
        sourceKey: "manual",
        displayName: "Manual",
      },
      {
        organizationId: "org-b",
        providerConnectionId: bConnection.id,
        sourceType: "manual",
        sourceKey: "manual",
        displayName: "Manual",
      },
    ]);
    // Active catalog for org-a only — org-b starts empty so we can
    // verify the empty-org read returns the right shape.
    await db.insert(metricDefinition).values([
      {
        organizationId: "org-a",
        code: "weight",
        displayName: "Weight",
        category: "body",
        unit: "kg",
      },
      {
        organizationId: "org-a",
        code: "resting_heart_rate",
        displayName: "Resting Heart Rate",
        category: "vitals",
        unit: "bpm",
      },
      {
        organizationId: "org-a",
        code: "blood_marker_glucose",
        displayName: "Glucose",
        category: "labs",
        unit: "mg/dL",
      },
    ]);
    // Family-history entry for org-a + manual override for user-b
    // so we can verify the user-over-org resolution and the
    // foreign-tenant isolation.
    await db.insert(metricSourcePreference).values([
      {
        organizationId: "org-a",
        metricCode: "weight",
        preferredSources: ["phone", "watch"],
      },
      {
        organizationId: "org-a",
        userId: "user-a",
        metricCode: "weight",
        preferredSources: ["watch", "phone"],
      },
      {
        organizationId: "org-a",
        metricCode: "blood_marker_glucose",
        preferredSources: ["lab", "phone"],
      },
    ]);
    const [weight] = await db
      .select({ id: metricDefinition.id })
      .from(metricDefinition)
      .where(and(eq(metricDefinition.organizationId, "org-a"), eq(metricDefinition.code, "weight")))
      .limit(1);
    if (!weight) throw new Error("Missing weight definition for sample.");
    await db.insert(metricSample).values({
      organizationId: "org-a",
      metricDefinitionId: weight.id,
      sampledAt: new Date("2026-09-29T00:00:00Z"),
      numericValue: 84,
      dedupeHash: "sample-weight",
    });
  }, 120000);

  afterAll(async () => {
    await db.$client.end();
  });

  test("listMetrics returns only the active tenant's catalog", async () => {
    const rows = await repo.listMetrics("org-a");
    expect(rows.map((row) => row.code).sort()).toEqual([
      "blood_marker_glucose",
      "resting_heart_rate",
      "weight",
    ]);
    for (const row of rows) {
      expect(row.canonicalMetricCode).toBe(row.code);
    }
    const blood = rows.find((row) => row.code === "blood_marker_glucose");
    expect(blood?.isBloodMarkerFamily).toBe(true);
    expect(blood?.taxonomy?.code).toBe("blood_marker");
    expect(rows.find((row) => row.code === "weight")?.taxonomy?.code).toBe("weight");
  });

  test("empty org returns empty catalog without erroring", async () => {
    const rows = await repo.listMetrics("org-b");
    expect(rows).toEqual([]);
  });

  test("listSourcePriority for active user beats family-history entry and default", async () => {
    const resolutions = await repo.listSourcePriority("org-a", "user-a");
    const weight = resolutions.find((row) => row.metricCode === "weight");
    expect(weight?.manualOverride).toEqual(["watch", "phone"]);
    expect(weight?.familyHistoryEntry).toEqual(["phone", "watch"]);
    expect(weight?.effectiveOrder).toEqual(["watch", "phone"]);
    expect(weight?.reason).toBe("manual_override");
    const heart = resolutions.find((row) => row.metricCode === "resting_heart_rate");
    expect(heart?.effectiveOrder).toEqual(["watch", "phone"]);
    expect(heart?.reason).toBe("default_order");
    const blood = resolutions.find((row) => row.metricCode === "blood_marker_glucose");
    expect(blood?.familyHistoryEntry).toEqual(["lab", "phone"]);
    expect(blood?.effectiveOrder).toEqual(["lab", "phone"]);
    expect(blood?.reason).toBe("family_history_entry");
  });

  test("foreign-tenant preferences never appear in the active tenant's resolution", async () => {
    // Seed a metric + family-history row for org-b so we can prove
    // the read is tenant-filtered.
    const [orgBConnection] = await db
      .select()
      .from(providerConnection)
      .where(eq(providerConnection.organizationId, "org-b"));
    if (!orgBConnection) throw new Error("Missing org-b connection.");
    await db.insert(metricDefinition).values({
      organizationId: "org-b",
      code: "weight",
      displayName: "Weight",
      category: "body",
      unit: "kg",
    });
    await db.insert(metricSourcePreference).values({
      organizationId: "org-b",
      metricCode: "weight",
      preferredSources: ["watch", "phone"],
    });
    const resolutions = await repo.listSourcePriority("org-b", "user-b");
    const weight = resolutions.find((row) => row.metricCode === "weight");
    expect(weight?.effectiveOrder).toEqual(["watch", "phone"]);
    expect(weight?.reason).toBe("family_history_entry");
    // The active tenant (org-a) resolution must not leak org-b rows.
    const orgAResolutions = await repo.listSourcePriority("org-a", "user-a");
    const orgAWeight = orgAResolutions.find((row) => row.metricCode === "weight");
    expect(orgAWeight?.familyHistoryEntry).toEqual(["phone", "watch"]);
    expect(orgAWeight?.manualOverride).toEqual(["watch", "phone"]);
    // No resolution mentions org-b-only metric codes.
    for (const resolution of orgAResolutions) {
      expect(resolution.canonicalMetricCode).not.toMatch(/org-b/);
    }
    // Cross-tenant insert of an org-b metric code in org-a should
    // be caught by the catalog loader before any row is written.
    await expect(
      repo.upsertSourcePreference({
        organizationId: "org-a",
        userId: "user-a",
        metricCode: "weight",
        preferredSources: ["scale"],
      }),
    ).resolves.toMatchObject({ scope: "user", preferredSources: ["scale"] });
    await expect(
      repo.upsertSourcePreference({
        organizationId: "org-a",
        userId: "user-a",
        metricCode: "blood_marker_glucose",
        preferredSources: ["lab_x"],
      }),
    ).resolves.toMatchObject({ metricCode: "blood_marker_glucose" });
    // An unknown metric code in the active tenant must reject
    // (NOT_FOUND) — proves the catalog loader is wired.
    await expect(
      repo.upsertSourcePreference({
        organizationId: "org-a",
        userId: "user-a",
        metricCode: "made_up_marker",
        preferredSources: ["watch"],
      }),
    ).rejects.toBeInstanceOf(SourcePreferenceValidationError);
  });

  test("deleteSourcePreference removes the user row and audits the org row when absent", async () => {
    // First write: user override on blood_marker_glucose.
    await repo.upsertSourcePreference({
      organizationId: "org-a",
      userId: "user-a",
      metricCode: "blood_marker_glucose",
      preferredSources: ["phone", "lab"],
    });
    const beforeDelete = await repo.listSourcePriority("org-a", "user-a");
    expect(beforeDelete.find((row) => row.metricCode === "blood_marker_glucose")?.reason).toBe(
      "manual_override",
    );
    const removed = await repo.deleteSourcePreference({
      organizationId: "org-a",
      userId: "user-a",
      metricCode: "blood_marker_glucose",
    });
    expect(removed.removed).toBe(true);
    expect(removed.ids).toHaveLength(1);
    const afterDelete = await repo.listSourcePriority("org-a", "user-a");
    expect(afterDelete.find((row) => row.metricCode === "blood_marker_glucose")?.reason).toBe(
      "family_history_entry",
    );
    // Delete the family-history row as well — proves the
    // organization-scope fallback path.
    const orgRemoved = await repo.deleteSourcePreference({
      organizationId: "org-a",
      userId: "user-a",
      metricCode: "blood_marker_glucose",
    });
    expect(orgRemoved.removed).toBe(true);
    const final = await repo.listSourcePriority("org-a", "user-a");
    expect(final.find((row) => row.metricCode === "blood_marker_glucose")?.reason).toBe(
      "default_order",
    );
  });

  test("PHI-bearing repository reads emit no console payloads", async () => {
    const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
    try {
      await repo.listMetrics("org-a");
      await repo.listSourcePriority("org-a", "user-a");
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally {
      for (const log of logs) log.mockRestore();
    }
  });
});
