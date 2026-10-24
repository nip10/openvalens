import { readdir } from "node:fs/promises";
import { afterEach, beforeAll, describe, expect, test as btest } from "bun:test";
import { createDb, sql } from "@openvalens/db";
import { organization } from "@openvalens/db/schema/auth";
import { metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import { and, eq } from "drizzle-orm";

import { listDailyVitals, listRecentHeartRateSamples } from "./queries";

const url = process.env.VITALS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/vitals_test")
    throw new Error("Empty disposable loopback vitals_test database required.");
}

describe.skipIf(!url)("vitals queries against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/vitals_test" });
  const ORG_A = "org-vitals-a";
  const ORG_B = "org-vitals-b";

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
      { id: ORG_A, name: "A", slug: "vitals-a" },
      { id: ORG_B, name: "B", slug: "vitals-b" },
    ]);
    await db.insert(metricDefinition).values([
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
        organizationId: ORG_A,
        code: "resting_heart_rate",
        displayName: "Resting heart rate",
        category: "vitals",
        unit: "bpm",
        valueType: "number",
        aggregationDefault: "avg",
      },
      {
        organizationId: ORG_A,
        code: "hrv_rmssd",
        displayName: "HRV (RMSSD)",
        category: "vitals",
        unit: "ms",
        valueType: "number",
        aggregationDefault: "avg",
      },
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
        organizationId: ORG_B,
        code: "heart_rate",
        displayName: "Heart rate",
        category: "vitals",
        unit: "bpm",
        valueType: "number",
        aggregationDefault: "avg",
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
    if (!row || row.id === undefined) throw new Error(`missing def for ${code}`);
    return row.id;
  }

  btest("computes per-day avg / min / max heart rate and resting heart rate", async () => {
    const hr = await defId("heart_rate");
    const rest = await defId("resting_heart_rate");
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86_400_000);

    await db.insert(metricSample).values([
      {
        organizationId: ORG_A,
        metricDefinitionId: hr,
        sampledAt: today,
        numericValue: 72,
        dedupeHash: "h-1",
      },
      {
        organizationId: ORG_A,
        metricDefinitionId: hr,
        sampledAt: today,
        numericValue: 88,
        dedupeHash: "h-2",
      },
      {
        organizationId: ORG_A,
        metricDefinitionId: hr,
        sampledAt: today,
        numericValue: 64,
        dedupeHash: "h-3",
      },
      {
        organizationId: ORG_A,
        metricDefinitionId: rest,
        sampledAt: yesterday,
        numericValue: 58,
        dedupeHash: "r-1",
      },
    ]);

    const days = await listDailyVitals(db, ORG_A, 2);
    const todayDate = today.toISOString().slice(0, 10);
    const yesterdayDate = yesterday.toISOString().slice(0, 10);

    const todayBucket = days.find((d) => d.date === todayDate);
    expect(todayBucket?.heartRate.avgBpm).toBeCloseTo((72 + 88 + 64) / 3);
    expect(todayBucket?.heartRate.minBpm).toBe(64);
    expect(todayBucket?.heartRate.maxBpm).toBe(88);
    expect(todayBucket?.heartRate.sampleCount).toBe(3);
    expect(todayBucket?.restingHeartRate.avgBpm).toBeNull();

    const yesterdayBucket = days.find((d) => d.date === yesterdayDate);
    expect(yesterdayBucket?.restingHeartRate.avgBpm).toBe(58);
    expect(yesterdayBucket?.restingHeartRate.sampleCount).toBe(1);
    expect(yesterdayBucket?.heartRate.avgBpm).toBeNull();
    expect(yesterdayBucket?.hrv).toEqual({ avgMs: null, sampleCount: 0 });
  });

  btest("averages overnight HRV (hrv_rmssd) per day in milliseconds", async () => {
    const hrv = await defId("hrv_rmssd");
    const today = new Date();
    await db.insert(metricSample).values([
      {
        organizationId: ORG_A,
        metricDefinitionId: hrv,
        sampledAt: today,
        numericValue: 40,
        dedupeHash: "v-1",
      },
      {
        organizationId: ORG_A,
        metricDefinitionId: hrv,
        sampledAt: today,
        numericValue: 50,
        dedupeHash: "v-2",
      },
    ]);

    const days = await listDailyVitals(db, ORG_A, 1);
    expect(days[0]?.hrv).toEqual({ avgMs: 45, sampleCount: 2 });
    expect(days[0]?.heartRate.sampleCount).toBe(0);
  });

  btest("excludes superseded samples", async () => {
    const hr = await defId("heart_rate");
    const today = new Date();
    await db.insert(metricSample).values([
      {
        organizationId: ORG_A,
        metricDefinitionId: hr,
        sampledAt: today,
        numericValue: 99,
        dedupeHash: "s-1",
        supersededAt: new Date(),
      },
      {
        organizationId: ORG_A,
        metricDefinitionId: hr,
        sampledAt: today,
        numericValue: 70,
        dedupeHash: "s-2",
      },
    ]);
    const days = await listDailyVitals(db, ORG_A, 1);
    expect(days[0]?.heartRate.avgBpm).toBe(70);
    expect(days[0]?.heartRate.sampleCount).toBe(1);
  });

  btest("scopes by organization", async () => {
    const hr = await defId("heart_rate", ORG_B);
    await db.insert(metricSample).values({
      organizationId: ORG_B,
      metricDefinitionId: hr,
      sampledAt: new Date(),
      numericValue: 200,
      dedupeHash: "x-1",
    });
    const days = await listDailyVitals(db, ORG_A, 1);
    expect(days[0]?.heartRate.avgBpm).toBeNull();
  });

  btest("returns zero count and null metrics for empty days", async () => {
    const days = await listDailyVitals(db, ORG_A, 3);
    expect(days).toHaveLength(3);
    for (const day of days) {
      expect(day.heartRate.avgBpm).toBeNull();
      expect(day.heartRate.sampleCount).toBe(0);
      expect(day.restingHeartRate.avgBpm).toBeNull();
      expect(day.restingHeartRate.sampleCount).toBe(0);
    }
  });

  btest("listRecentHeartRateSamples returns the most recent N, newest first", async () => {
    const hr = await defId("heart_rate");
    const t0 = Date.now();
    await db.insert(metricSample).values([
      {
        organizationId: ORG_A,
        metricDefinitionId: hr,
        sampledAt: new Date(t0 - 3 * 86_400_000),
        numericValue: 60,
        dedupeHash: "r-1",
      },
      {
        organizationId: ORG_A,
        metricDefinitionId: hr,
        sampledAt: new Date(t0 - 86_400_000),
        numericValue: 70,
        dedupeHash: "r-2",
      },
      {
        organizationId: ORG_A,
        metricDefinitionId: hr,
        sampledAt: new Date(t0 - 2 * 86_400_000),
        numericValue: 80,
        dedupeHash: "r-3",
      },
    ]);
    const samples = await listRecentHeartRateSamples(db, ORG_A, 2);
    expect(samples).toHaveLength(2);
    expect(samples[0]?.heartRateBpm).toBe(70);
    expect(samples[1]?.heartRateBpm).toBe(80);
  });
});
