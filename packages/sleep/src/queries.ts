import type { Database } from "@openhealth/db";
import { healthEvent } from "@openhealth/db/schema/health-record";
import { and, desc, eq, gte, lte } from "drizzle-orm";

import { deriveSleepDailySummaries } from "./derive-daily-summary";
import { summarizeSleepWindow } from "./scoring";
import type { SleepDailySummary, SleepSessionInput, SleepWindowSummary } from "./types";

/**
 * Sleep event-row shape read off `health_event`. The DB columns are mapped
 * verbatim — `eventAt` is a `timestamp with timezone` that Drizzle hands back
 * as `Date`.
 */
export type SleepEventRow = {
  id: number;
  eventAt: Date;
  title: string | null;
  payloadJson: unknown;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asStageIntervals(value: unknown): SleepSessionInput["stageIntervals"] {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((interval) => ({
    stage: String(interval.stage ?? ""),
    start: String(interval.start ?? ""),
    end: String(interval.end ?? ""),
  }));
}

function toSessionInput(row: SleepEventRow): SleepSessionInput {
  const payload = isRecord(row.payloadJson) ? row.payloadJson : {};
  return {
    id: String(row.id),
    start: row.eventAt.toISOString(),
    end: asString(payload.endAt),
    title: row.title,
    sourceApp: asString(payload.sourceApp),
    sourceDevice: asString(payload.sourceDevice),
    stageIntervals: asStageIntervals(payload.sleepStageIntervals),
  };
}

function dateToIsoEndOfDay(date: string): string {
  return `${date}T23:59:59.999Z`;
}

function dateMinusDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

/**
 * Pure helper: shape raw `health_event` rows into a `SleepWindowSummary`
 * filtered to a `[startDate, endDate]` window. Kept separate from the
 * Drizzle-backed queries so the same logic can be unit-tested with
 * hand-built rows.
 */
export function buildSleepSummaryFromEventRows(
  rows: SleepEventRow[],
  params: { startDate: string; endDate: string },
): SleepWindowSummary {
  const sessions = rows.map(toSessionInput);
  const dailySummaries = deriveSleepDailySummaries({ sessions });
  const filteredDays = dailySummaries.filter(
    (summary) => summary.date >= params.startDate && summary.date <= params.endDate,
  );
  return summarizeSleepWindow(filteredDays);
}

/**
 * Pure helper: shape raw `health_event` rows into the full daily-summary
 * list, with no date-window filtering.
 */
export function buildSleepDailySummariesFromEventRows(rows: SleepEventRow[]): SleepDailySummary[] {
  const sessions = rows.map(toSessionInput);
  return deriveSleepDailySummaries({ sessions });
}

/**
 * Org-scoped `health_event` sleep-session read. Default 30-day cutoff is
 * clamped at the procedure boundary (`sleep.summary` accepts `days` between
 * 7 and 365).
 */
export async function getSleepSummary(
  db: Database,
  organizationId: string,
  days = 30,
): Promise<SleepWindowSummary> {
  const cutoff = new Date(Date.now() - days * DAY_MS);

  const rows = await db
    .select({
      id: healthEvent.id,
      eventAt: healthEvent.eventAt,
      title: healthEvent.title,
      payloadJson: healthEvent.payloadJson,
    })
    .from(healthEvent)
    .where(
      and(
        eq(healthEvent.organizationId, organizationId),
        eq(healthEvent.eventType, "sleep_session"),
        gte(healthEvent.eventAt, cutoff),
      ),
    )
    .orderBy(desc(healthEvent.eventAt), desc(healthEvent.id));

  const sessions = rows.map(toSessionInput);
  const dailySummaries = deriveSleepDailySummaries({ sessions });
  return summarizeSleepWindow(dailySummaries);
}

/**
 * Org-scoped `health_event` sleep-session read bounded by an explicit
 * `[startDate, endDate]` window. The SQL window is widened by one day on the
 * low end so a sleep session that *ended* on `startDate` is still surfaced
 * (sessions can straddle midnight); the daily summary then filters down to
 * the requested window.
 */
export async function getSleepSummaryForRange(
  db: Database,
  organizationId: string,
  startDate: string,
  endDate: string,
): Promise<SleepWindowSummary> {
  const queryStart = `${dateMinusDays(startDate, 1)}T00:00:00.000Z`;
  const queryEnd = dateToIsoEndOfDay(endDate);

  const rows = await db
    .select({
      id: healthEvent.id,
      eventAt: healthEvent.eventAt,
      title: healthEvent.title,
      payloadJson: healthEvent.payloadJson,
    })
    .from(healthEvent)
    .where(
      and(
        eq(healthEvent.organizationId, organizationId),
        eq(healthEvent.eventType, "sleep_session"),
        gte(healthEvent.eventAt, new Date(queryStart)),
        lte(healthEvent.eventAt, new Date(queryEnd)),
      ),
    )
    .orderBy(desc(healthEvent.eventAt), desc(healthEvent.id));

  return buildSleepSummaryFromEventRows(rows, { startDate, endDate });
}

/**
 * Org-scoped `health_event` sleep-session read returning the full daily
 * summary list (no date-window filtering). Used by `sleep.listDailySummaries`.
 */
export async function listSleepDailySummaries(
  db: Database,
  organizationId: string,
  days = 90,
): Promise<SleepDailySummary[]> {
  const cutoff = new Date(Date.now() - days * DAY_MS);
  const rows = await db
    .select({
      id: healthEvent.id,
      eventAt: healthEvent.eventAt,
      title: healthEvent.title,
      payloadJson: healthEvent.payloadJson,
    })
    .from(healthEvent)
    .where(
      and(
        eq(healthEvent.organizationId, organizationId),
        eq(healthEvent.eventType, "sleep_session"),
        gte(healthEvent.eventAt, cutoff),
      ),
    )
    .orderBy(desc(healthEvent.eventAt), desc(healthEvent.id));

  return buildSleepDailySummariesFromEventRows(rows);
}
