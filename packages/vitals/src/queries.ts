import type { Database } from "@openvalens/db";
import { dataSource, metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import type { DailyVitalsSummary, VitalsSample } from "./types";

const DAY_MS = 86_400_000;

const CODES = ["heart_rate", "resting_heart_rate"] as const;

/**
 * Daily summaries for the most recent `days` UTC calendar days (inclusive of
 * today). Days with no samples return nulls and a zero count. Only non
 * superseded rows are aggregated.
 *
 * The query produces one row per (date, code) tuple so we can collapse the
 * two heart-rate codes into a single day shape on the JS side.
 */
export async function listDailyVitals(
  db: Database,
  organizationId: string,
  days: number,
): Promise<DailyVitalsSummary[]> {
  const safeDays = Math.max(1, Math.min(365, Math.floor(days)));
  const todayUtc = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const since = new Date(todayUtc.getTime() - (safeDays - 1) * DAY_MS);

  const rows = await db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${metricSample.sampledAt}), 'YYYY-MM-DD')`,
      code: metricDefinition.code,
      avg: sql<number | null>`avg(${metricSample.numericValue})::float8`,
      min: sql<number | null>`min(${metricSample.numericValue})::float8`,
      max: sql<number | null>`max(${metricSample.numericValue})::float8`,
      count: sql<number>`count(*)::int8`,
    })
    .from(metricSample)
    .innerJoin(
      metricDefinition,
      and(
        eq(metricDefinition.id, metricSample.metricDefinitionId),
        eq(metricDefinition.organizationId, metricSample.organizationId),
      ),
    )
    .where(
      and(
        eq(metricSample.organizationId, organizationId),
        isNull(metricSample.supersededAt),
        gte(metricSample.sampledAt, since),
        inArray(metricDefinition.code, [...CODES]),
      ),
    )
    .groupBy(sql`date_trunc('day', ${metricSample.sampledAt})`, metricDefinition.code);

  const byDate = new Map<string, DailyVitalsSummary>();
  for (let i = 0; i < safeDays; i += 1) {
    const date = new Date(todayUtc.getTime() - (safeDays - 1 - i) * DAY_MS)
      .toISOString()
      .slice(0, 10);
    byDate.set(date, {
      date,
      heartRate: { avgBpm: null, minBpm: null, maxBpm: null, sampleCount: 0 },
      restingHeartRate: { avgBpm: null, sampleCount: 0 },
    });
  }

  for (const row of rows) {
    const bucket = byDate.get(row.date);
    if (!bucket) continue;
    if (row.code === "heart_rate") {
      bucket.heartRate = {
        avgBpm: row.avg,
        minBpm: row.min,
        maxBpm: row.max,
        sampleCount: Number(row.count),
      };
    } else if (row.code === "resting_heart_rate") {
      bucket.restingHeartRate = {
        avgBpm: row.avg,
        sampleCount: Number(row.count),
      };
    }
  }

  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Most recent `limit` heart-rate samples for the org, newest first. The source
 * label is the data source's `sourceKey` (e.g. `health_connect`, `apple_health`).
 */
export async function listRecentHeartRateSamples(
  db: Database,
  organizationId: string,
  limit: number,
): Promise<VitalsSample[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = await db
    .select({
      sampledAt: metricSample.sampledAt,
      heartRateBpm: metricSample.numericValue,
      source: dataSource.sourceKey,
    })
    .from(metricSample)
    .innerJoin(
      metricDefinition,
      and(
        eq(metricDefinition.id, metricSample.metricDefinitionId),
        eq(metricDefinition.organizationId, metricSample.organizationId),
      ),
    )
    .leftJoin(dataSource, eq(dataSource.id, metricSample.dataSourceId))
    .where(
      and(
        eq(metricSample.organizationId, organizationId),
        isNull(metricSample.supersededAt),
        eq(metricDefinition.code, "heart_rate"),
      ),
    )
    .orderBy(desc(metricSample.sampledAt), desc(metricSample.id))
    .limit(safeLimit);

  return rows
    .filter((row): row is typeof row & { heartRateBpm: number } => row.heartRateBpm !== null)
    .map((row) => ({
      sampledAt: row.sampledAt.toISOString(),
      heartRateBpm: row.heartRateBpm,
      source: row.source ?? null,
    }));
}
