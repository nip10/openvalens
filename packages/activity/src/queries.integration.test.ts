import { readdir } from "node:fs/promises";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createDb, sql } from "@openhealth/db";
import { organization } from "@openhealth/db/schema/auth";
import { metricDefinition, metricSample } from "@openhealth/db/schema/health-record";
import { eq, and } from "drizzle-orm";

import { fillDailyActivityTotals, listDailyActivityTotals } from "./queries";

const url = process.env.ACTIVITY_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/activity_test")
    throw new Error("Empty disposable loopback activity_test database required.");
}

describe.skipIf(!url)("activity queries against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/activity_test" });
  const ORG_A = "org-activity-a";
  const ORG_B = "org-activity-b";

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
      { id: ORG_A, name: "A", slug: "activity-a" },
      { id: ORG_B, name: "B", slug: "activity-b" },
    ]);
    await db.insert(metricDefinition).values([
      {
        organizationId: ORG_A,
        code: "steps",
        displayName: "Steps",
        category: "activity",
        unit: "count",
        valueType: "number",
        aggregationDefault: "sum",
      },
      {
        organizationId: ORG_A,
        code: "active_calories",
        displayName: "Active calories",
        category: "activity",
        unit: "kcal",
        valueType: "number",
        aggregationDefault: "sum",
      },
      {
        organizationId: ORG_A,
        code: "distance",
        displayName: "Distance",
        category: "activity",
        unit: "m",
        valueType: "number",
        aggregationDefault: "sum",
      },
      {
        organizationId: ORG_A,
        code: "heart_rate",
        displayName: "Heart rate",
        category: "vitals",
        unit: "bpm",
        valueType: "number",
        aggregationDefault: "avg",
      },
      {
        organizationId: ORG_B,
        code: "steps",
        displayName: "Steps",
        category: "activity",
        unit: "count",
        valueType: "number",
        aggregationDefault: "sum",
      },
    ]);
  });

  afterEach(async () => {
    await db.delete(metricSample).where(eq(metricSample.organizationId, ORG_A));
    await db.delete(metricSample).where(eq(metricSample.organizationId, ORG_B));
  });

  async function defId(code: string, org: string = ORG_A) {
    const [row] = await db
      .select({ id: metricDefinition.id })
      .from(metricDefinition)
      .where(and(eq(metricDefinition.code, code), eq(metricDefinition.organizationId, org)));
    if (!row || row.id === undefined) throw new Error(`missing def for ${code} in ${org}`);
    return row.id;
  }

  test("sums steps, distance and calories per day for the requested window", async () => {
    const steps = await defId("steps");
    const kcal = await defId("active_calories");
    const distance = await defId("distance");
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86_400_000);

    await db.insert(metricSample).values([
      {
        organizationId: ORG_A,
        metricDefinitionId: steps,
        sampledAt: today,
        numericValue: 4200,
        dedupeHash: "a-1",
      },
      {
        organizationId: ORG_A,
        metricDefinitionId: steps,
        sampledAt: today,
        numericValue: 800,
        dedupeHash: "a-2",
      },
      {
        organizationId: ORG_A,
        metricDefinitionId: kcal,
        sampledAt: yesterday,
        numericValue: 320,
        dedupeHash: "b-1",
      },
      {
        organizationId: ORG_A,
        metricDefinitionId: distance,
        sampledAt: yesterday,
        numericValue: 5400,
        dedupeHash: "b-2",
      },
    ]);

    const rows = await listDailyActivityTotals(db, ORG_A, 2);
    expect(rows).toHaveLength(2);
    const todayDate = today.toISOString().slice(0, 10);
    const yesterdayDate = yesterday.toISOString().slice(0, 10);
    expect(rows.find((r) => r.date === todayDate)?.steps).toBe(5000);
    expect(rows.find((r) => r.date === yesterdayDate)?.activeCaloriesKcal).toBe(320);
    expect(rows.find((r) => r.date === yesterdayDate)?.distanceMeters).toBe(5400);
  });

  test("excludes superseded rows from the totals", async () => {
    const steps = await defId("steps");
    const today = new Date();
    await db.insert(metricSample).values([
      {
        organizationId: ORG_A,
        metricDefinitionId: steps,
        sampledAt: today,
        numericValue: 4000,
        dedupeHash: "s-1",
        supersededAt: new Date(),
      },
      {
        organizationId: ORG_A,
        metricDefinitionId: steps,
        sampledAt: today,
        numericValue: 1500,
        dedupeHash: "s-2",
      },
    ]);
    const rows = await listDailyActivityTotals(db, ORG_A, 1);
    expect(rows[0]?.steps).toBe(1500);
  });

  test("scopes rows by organization", async () => {
    const steps = await defId("steps", ORG_B);
    await db.insert(metricSample).values({
      organizationId: ORG_B,
      metricDefinitionId: steps,
      sampledAt: new Date(),
      numericValue: 9999,
      dedupeHash: "x-1",
    });
    const rows = await listDailyActivityTotals(db, ORG_A, 1);
    expect(rows[0]?.steps).toBeNull();
  });

  test("ignores codes outside the activity family", async () => {
    const heartRate = await defId("heart_rate");
    await db.insert(metricSample).values({
      organizationId: ORG_A,
      metricDefinitionId: heartRate,
      sampledAt: new Date(),
      numericValue: 72,
      dedupeHash: "hr-1",
    });
    const rows = await listDailyActivityTotals(db, ORG_A, 1);
    expect(rows[0]?.steps).toBeNull();
    expect(rows[0]?.activeCaloriesKcal).toBeNull();
    expect(rows[0]?.distanceMeters).toBeNull();
  });

  test("returns null for a day with no rows", async () => {
    const rows = await listDailyActivityTotals(db, ORG_A, 3);
    expect(rows).toHaveLength(3);
    expect(
      rows.every(
        (r) => r.steps === null && r.activeCaloriesKcal === null && r.distanceMeters === null,
      ),
    ).toBe(true);
  });
});

describe("fillDailyActivityTotals", () => {
  test("coalesces nulls to zero", () => {
    const filled = fillDailyActivityTotals([
      { date: "2026-10-01", steps: 5000, activeCaloriesKcal: null, distanceMeters: null },
      { date: "2026-09-30", steps: null, activeCaloriesKcal: 320, distanceMeters: null },
    ]);
    expect(filled[0]).toEqual({
      date: "2026-10-01",
      steps: 5000,
      activeCaloriesKcal: 0,
      distanceMeters: 0,
    });
    expect(filled[1]?.steps).toBe(0);
  });
});
