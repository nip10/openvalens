import type { Database } from "@openhealth/db";
import { metricDefinition, metricSample } from "@openhealth/db/schema/health-record";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import type { DailyActivitySummary, DailyActivityTotals } from "./types";

const DAY_MS = 86_400_000;
const DAY_NAMES = ["steps", "active_calories", "distance"] as const;

/**
 * Daily sums per metric code for the last `days` calendar days (inclusive of
 * today), in the org's local calendar derived from the row's UTC `sampledAt`.
 *
 * Only `metric_sample` rows that are NOT superseded are aggregated. Days with
 * no rows return `null` for the corresponding metric; the caller can decide
 * whether to render "—" or zero.
 */
export async function listDailyActivityTotals(
  db: Database,
  organizationId: string,
  days: number,
): Promise<DailyActivityTotals[]> {
  const safeDays = Math.max(1, Math.min(365, Math.floor(days)));
  // Anchor on UTC midnight of "today" so the window is a stable set of
  // calendar days, not a rolling `Date.now() - N*DAY_MS` that drifts.
  const todayUtc = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const since = new Date(todayUtc.getTime() - (safeDays - 1) * DAY_MS);

  const rows = await db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${metricSample.sampledAt}), 'YYYY-MM-DD')`,
      code: metricDefinition.code,
      total: sql<number>`coalesce(sum(${metricSample.numericValue}), 0)`,
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
        inArray(metricDefinition.code, [...DAY_NAMES]),
      ),
    )
    .groupBy(sql`date_trunc('day', ${metricSample.sampledAt})`, metricDefinition.code);

  const byDate = new Map<string, DailyActivityTotals>();
  for (let i = 0; i < safeDays; i += 1) {
    const date = new Date(todayUtc.getTime() - (safeDays - 1 - i) * DAY_MS)
      .toISOString()
      .slice(0, 10);
    byDate.set(date, {
      date,
      steps: null,
      activeCaloriesKcal: null,
      distanceMeters: null,
    });
  }

  for (const row of rows) {
    const existing = byDate.get(row.date);
    if (!existing) continue;
    if (row.code === "steps") existing.steps = row.total;
    if (row.code === "active_calories") existing.activeCaloriesKcal = row.total;
    if (row.code === "distance") existing.distanceMeters = row.total;
  }

  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Coalesces `null` totals to 0 for the chart and summary card. */
export function fillDailyActivityTotals(
  rows: readonly DailyActivityTotals[],
): DailyActivitySummary[] {
  return rows.map((row) => ({
    date: row.date,
    steps: row.steps ?? 0,
    activeCaloriesKcal: row.activeCaloriesKcal ?? 0,
    distanceMeters: row.distanceMeters ?? 0,
  }));
}
