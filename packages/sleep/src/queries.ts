import type { Database } from "@openvalens/db";
import { healthEvent } from "@openvalens/db/schema/health-record";
import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";

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

/** A stable personal-goal evidence item; date is the local date of wake-up. */
export type PersonalSleepDailyEvidence = {
  date: string;
  minutes: number;
  wakeAt: string;
  sessionIds: string[];
  source: "automatic_sleep";
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

function asleepIntervals(row: SleepEventRow): Array<{ start: number; end: number }> {
  const session = toSessionInput(row);
  const start = new Date(session.start).getTime();
  const end = new Date(session.end ?? "").getTime();
  if (!Number.isFinite(end) || end - start < 10 * 60_000 || end - start > DAY_MS) return [];
  const awake = (session.stageIntervals ?? [])
    .filter((stage) => /awake|wake/i.test(stage.stage))
    .map((stage) => ({
      start: new Date(stage.start).getTime(),
      end: new Date(stage.end).getTime(),
    }))
    .filter(
      (interval) =>
        Number.isFinite(interval.start) &&
        Number.isFinite(interval.end) &&
        interval.end > interval.start,
    )
    .map((interval) => ({
      start: Math.max(start, interval.start),
      end: Math.min(end, interval.end),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const mergedAwake: Array<{ start: number; end: number }> = [];
  for (const interval of awake) {
    const last = mergedAwake.at(-1);
    if (!last || interval.start > last.end) mergedAwake.push({ ...interval });
    else last.end = Math.max(last.end, interval.end);
  }
  const asleep: Array<{ start: number; end: number }> = [];
  let cursor = start;
  for (const interval of mergedAwake) {
    if (interval.start > cursor) asleep.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < end) asleep.push({ start: cursor, end });
  return asleep;
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
        isNull(healthEvent.supersededAt),
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
        isNull(healthEvent.supersededAt),
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
        isNull(healthEvent.supersededAt),
        gte(healthEvent.eventAt, cutoff),
      ),
    )
    .orderBy(desc(healthEvent.eventAt), desc(healthEvent.id));

  return buildSleepDailySummariesFromEventRows(rows);
}

/**
 * Owner-scoped automatic-sleep evidence. Unlike legacy readiness summaries,
 * this explicitly excludes ownerless history and assigns each complete
 * session to its wake-up date in the caller's stable goal timezone.
 */
export async function getPersonalSleepDailyEvidence(
  db: Database,
  input: {
    organizationId: string;
    userId: string;
    startDate: string;
    endDate: string;
    timeZone: string;
  },
): Promise<PersonalSleepDailyEvidence[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate))
    throw new RangeError("Sleep evidence dates must use YYYY-MM-DD.");
  if (input.startDate > input.endDate)
    throw new RangeError("Sleep evidence date range is inverted.");
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: input.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const localDate = (date: Date) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  // timezone extremes plus a full overnight session; filter exact local dates below.
  const from = new Date(`${dateMinusDays(input.startDate, 2)}T00:00:00.000Z`);
  const to = new Date(`${dateMinusDays(input.endDate, -2)}T23:59:59.999Z`);
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
        eq(healthEvent.organizationId, input.organizationId),
        eq(healthEvent.userId, input.userId),
        eq(healthEvent.eventType, "sleep_session"),
        isNull(healthEvent.supersededAt),
        gte(healthEvent.eventAt, from),
        lte(healthEvent.eventAt, to),
      ),
    )
    .orderBy(desc(healthEvent.eventAt), desc(healthEvent.id));

  const grouped = new Map<
    string,
    Array<{ id: string; start: number; end: number; asleep: Array<{ start: number; end: number }> }>
  >();
  for (const row of rows) {
    const payload = isRecord(row.payloadJson) ? row.payloadJson : {};
    const endValue = asString(payload.endAt);
    if (!endValue) continue;
    const start = row.eventAt.getTime();
    const end = new Date(endValue).getTime();
    const duration = end - start;
    if (!Number.isFinite(end) || duration < 10 * 60_000 || duration > DAY_MS) continue;
    const date = localDate(new Date(end));
    if (date < input.startDate || date > input.endDate) continue;
    const sessions = grouped.get(date) ?? [];
    sessions.push({ id: String(row.id), start, end, asleep: asleepIntervals(row) });
    grouped.set(date, sessions);
  }

  const evidence: PersonalSleepDailyEvidence[] = [];
  for (const [date, sessions] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    // Union overlapping intervals so duplicate sessions from multiple sources
    // never inflate a personal goal's daily credit.
    const sorted = [...sessions].sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: Array<{ start: number; end: number; ids: string[] }> = [];
    for (const session of sorted) {
      merged.push(...session.asleep.map((interval) => ({ ...interval, ids: [session.id] })));
    }
    merged.sort((a, b) => a.start - b.start || a.end - b.end);
    const union: Array<{ start: number; end: number; ids: string[] }> = [];
    for (const interval of merged) {
      const last = union.at(-1);
      if (!last || interval.start > last.end) union.push({ ...interval });
      else {
        last.end = Math.max(last.end, interval.end);
        last.ids.push(...interval.ids);
      }
    }
    const minutes = Math.round(
      union.reduce((sum, item) => sum + item.end - item.start, 0) / 60_000,
    );
    const lastWake = Math.max(...sessions.map((session) => session.end));
    evidence.push({
      date,
      minutes,
      wakeAt: new Date(lastWake).toISOString(),
      sessionIds: [...new Set(union.flatMap((item) => item.ids))],
      source: "automatic_sleep",
    });
  }
  return evidence;
}
