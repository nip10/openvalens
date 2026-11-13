import type { Database } from "@openvalens/db";
import { metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import { plainWaterEntry } from "@openvalens/db/schema/nutrition";
import { supplement, supplementIntake, supplementSchedule } from "@openvalens/db/schema/plans";
import {
  isPlanItemDue,
  localClockIn,
  localDateIn,
  type LocalClock,
} from "@openvalens/telegram/reminder-schedule";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import {
  RECENT_METRIC_KINDS,
  type DueSupplement,
  type RecentLogEntry,
  type RecentMetricKind,
} from "./contracts/quick-log";

/**
 * Quick log reads (#440): the member's recent entries to repeat with one tap,
 * and the supplements due now for a one-tap "Taken". Shared by the web
 * command palette and the mobile log picker.
 *
 * Recents are the member's own typed-in entries only: metric samples with no
 * data source stamped with their user id (weight, heart rate, steps, …, and
 * blood pressure pairs), plain water and supplement intakes. Device data is
 * never offered as a "recent".
 */

/** How far back recents look (keeps the metric scan on recent rows). */
export const RECENTS_WINDOW_DAYS = 30;
export const DEFAULT_RECENTS_LIMIT = 5;

const BP_SYSTOLIC = "blood_pressure_systolic";
const BP_DIASTOLIC = "blood_pressure_diastolic";
const METRIC_CODES = [...RECENT_METRIC_KINDS, BP_SYSTOLIC, BP_DIASTOLIC] as const;

export type RecentMetricRow = { code: string; at: Date; value: number; unit: string | null };
export type RecentWaterRow = { at: Date; quantityMl: number };
export type RecentIntakeRow = {
  at: Date;
  supplementId: number;
  supplementName: string;
  dose: string;
};

const isMetricKind = (code: string): code is RecentMetricKind =>
  (RECENT_METRIC_KINDS as readonly string[]).includes(code);

const STORED_UNIT: Record<RecentMetricKind, string> = {
  weight: "kg",
  heart_rate: "bpm",
  resting_heart_rate: "bpm",
  steps: "count",
  active_calories: "kcal",
  distance: "m",
};

/** The key two entries share when repeating them would log the same thing. */
export function recentEntryKey(entry: RecentLogEntry): string {
  switch (entry.kind) {
    case "blood_pressure":
      return `blood_pressure|${entry.systolic}|${entry.diastolic}|${entry.pulse ?? "-"}`;
    case "water":
      return `water|${entry.quantityMl}`;
    case "supplement_intake":
      return `supplement|${entry.supplementId}|${entry.dose.trim().toLowerCase()}`;
    default:
      return `${entry.kind}|${entry.value}`;
  }
}

export type RecentSources = {
  metrics: readonly RecentMetricRow[];
  water: readonly RecentWaterRow[];
  intakes: readonly RecentIntakeRow[];
};

/**
 * Pure: merges the three sources into the last `limit` distinct entries,
 * newest first. Systolic and diastolic rows at the same time become one blood
 * pressure entry, with the `heart_rate` row at that time as its pulse (so that
 * pulse is not offered again as a heart rate).
 */
export function buildRecentLogEntries(
  sources: RecentSources,
  limit = DEFAULT_RECENTS_LIMIT,
): RecentLogEntry[] {
  const seen = new Set<string>();
  const distinct: RecentLogEntry[] = [];
  for (const entry of mergeRecentEntries(sources)) {
    const key = recentEntryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(entry);
    if (distinct.length >= limit) break;
  }
  return distinct;
}

/**
 * Pure: how many of the scanned entries each kind has, so a bare number typed
 * in the palette (#440d) offers the kinds the member logs most first.
 */
export function countRecentKinds(sources: RecentSources): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of mergeRecentEntries(sources))
    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  return counts;
}

/** Every entry from the sources, newest first, blood pressure paired. */
function mergeRecentEntries(sources: RecentSources): RecentLogEntry[] {
  const pressure = new Map<
    number,
    { at: Date; systolic?: number; diastolic?: number; pulse?: number }
  >();
  for (const row of sources.metrics) {
    if (row.code !== BP_SYSTOLIC && row.code !== BP_DIASTOLIC) continue;
    const time = row.at.getTime();
    const entry = pressure.get(time) ?? { at: row.at };
    if (row.code === BP_SYSTOLIC) entry.systolic ??= row.value;
    else entry.diastolic ??= row.value;
    pressure.set(time, entry);
  }
  const paired = new Set(
    [...pressure.entries()]
      .filter(([, entry]) => entry.systolic !== undefined && entry.diastolic !== undefined)
      .map(([time]) => time),
  );

  const entries: RecentLogEntry[] = [];
  for (const row of sources.metrics) {
    if (row.code === "heart_rate" && paired.has(row.at.getTime())) {
      const reading = pressure.get(row.at.getTime())!;
      reading.pulse ??= row.value;
      continue;
    }
    if (!isMetricKind(row.code)) continue;
    entries.push({
      kind: row.code,
      at: row.at.toISOString(),
      value: row.value,
      unit: row.unit ?? STORED_UNIT[row.code],
    });
  }
  for (const time of paired) {
    const reading = pressure.get(time)!;
    entries.push({
      kind: "blood_pressure",
      at: reading.at.toISOString(),
      systolic: reading.systolic!,
      diastolic: reading.diastolic!,
      pulse: reading.pulse ?? null,
    });
  }
  for (const row of sources.water)
    entries.push({ kind: "water", at: row.at.toISOString(), quantityMl: row.quantityMl });
  for (const row of sources.intakes)
    entries.push({
      kind: "supplement_intake",
      at: row.at.toISOString(),
      supplementId: row.supplementId,
      supplementName: row.supplementName,
      dose: row.dose,
    });

  entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return entries;
}

type Owner = { organizationId: string; userId: string };

/** The member's own typed-in metric samples from the last {@link RECENTS_WINDOW_DAYS}. */
export async function loadRecentMetricRows(
  db: Database,
  owner: Owner,
  now = new Date(),
): Promise<RecentMetricRow[]> {
  const since = new Date(now.getTime() - RECENTS_WINDOW_DAYS * 86_400_000);
  const rows = await db
    .select({
      code: metricDefinition.code,
      at: metricSample.sampledAt,
      value: metricSample.numericValue,
      unit: metricSample.unit,
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
        eq(metricSample.organizationId, owner.organizationId),
        isNull(metricSample.dataSourceId),
        isNull(metricSample.supersededAt),
        gte(metricSample.sampledAt, since),
        inArray(metricDefinition.code, [...METRIC_CODES, "heart_rate"]),
        sql`${metricSample.metadataJson}->>'ingestedByUserId' = ${owner.userId}`,
      ),
    )
    .orderBy(desc(metricSample.sampledAt), desc(metricSample.id))
    .limit(80);
  return rows.flatMap((row) => (row.value === null ? [] : [{ ...row, value: row.value }]));
}

export async function loadRecentWaterRows(db: Database, owner: Owner): Promise<RecentWaterRow[]> {
  return db
    .select({ at: plainWaterEntry.observedAt, quantityMl: plainWaterEntry.quantityMl })
    .from(plainWaterEntry)
    .where(
      and(
        eq(plainWaterEntry.organizationId, owner.organizationId),
        eq(plainWaterEntry.userId, owner.userId),
        isNull(plainWaterEntry.deletedAt),
      ),
    )
    .orderBy(desc(plainWaterEntry.observedAt), desc(plainWaterEntry.id))
    .limit(20);
}

export async function loadRecentIntakeRows(db: Database, owner: Owner): Promise<RecentIntakeRow[]> {
  return db
    .select({
      at: supplementIntake.occurredAt,
      supplementId: supplementIntake.supplementId,
      supplementName: supplement.name,
      dose: supplementIntake.dose,
    })
    .from(supplementIntake)
    .innerJoin(supplement, eq(supplement.id, supplementIntake.supplementId))
    .where(
      and(
        eq(supplementIntake.organizationId, owner.organizationId),
        eq(supplementIntake.userId, owner.userId),
        isNull(supplementIntake.deletedAt),
      ),
    )
    .orderBy(desc(supplementIntake.occurredAt), desc(supplementIntake.id))
    .limit(20);
}

// ─── Supplements due now ─────────────────────────────────────────

/**
 * Local hour from which a schedule's time of day counts as "now". Training is
 * whenever the member trains, so it is due all day.
 */
export const TIME_OF_DAY_FROM_HOUR: Readonly<Record<string, number>> = Object.freeze({
  morning: 5,
  lunch: 11,
  dinner: 17,
  "pre-bed": 20,
  training: 0,
});

const fromHour = (timeOfDay: string) => TIME_OF_DAY_FROM_HOUR[timeOfDay.trim().toLowerCase()] ?? 0;

export type DueScheduleRow = {
  scheduleId: number;
  supplementId: number;
  name: string;
  supplementDose: string | null;
  quantity: string | null;
  timeOfDay: string;
  frequency: string | null;
  daysOfWeek: number[] | null;
  status: string;
};

/**
 * Pure: the supplements due now. A schedule is due when it is due today by
 * its frequency (the reminder rule) and its time of day has come. Each intake
 * logged today covers one due dose, earliest first; a supplement appears once,
 * at its earliest dose still open, with how many are open.
 */
export function supplementsDueNow(input: {
  schedules: readonly DueScheduleRow[];
  /** Supplement ids of intakes logged on the member's local today. */
  takenToday: readonly number[];
  clock: LocalClock;
}): DueSupplement[] {
  const bySupplement = new Map<number, DueScheduleRow[]>();
  for (const schedule of input.schedules) {
    if (!isPlanItemDue(schedule, input.clock.date)) continue;
    if (fromHour(schedule.timeOfDay) > input.clock.hour) continue;
    const list = bySupplement.get(schedule.supplementId) ?? [];
    list.push(schedule);
    bySupplement.set(schedule.supplementId, list);
  }
  const taken = new Map<number, number>();
  for (const id of input.takenToday) taken.set(id, (taken.get(id) ?? 0) + 1);

  const due: (DueSupplement & { hour: number })[] = [];
  for (const [supplementId, list] of bySupplement) {
    list.sort(
      (a, b) => fromHour(a.timeOfDay) - fromHour(b.timeOfDay) || a.scheduleId - b.scheduleId,
    );
    const open = list.slice(taken.get(supplementId) ?? 0);
    const next = open[0];
    if (!next) continue;
    const dose = next.quantity?.trim() || next.supplementDose?.trim() || null;
    due.push({
      supplementId,
      name: next.name,
      dose,
      scheduleId: next.scheduleId,
      timeOfDay: next.timeOfDay,
      pending: open.length,
      hour: fromHour(next.timeOfDay),
    });
  }
  return due
    .sort((a, b) => a.hour - b.hour || a.name.localeCompare(b.name))
    .map(({ hour: _hour, ...item }) => item);
}

export async function loadSupplementsDue(
  db: Database,
  owner: Owner,
  timeZone: string,
  now = new Date(),
): Promise<{ localDate: string; items: DueSupplement[] }> {
  const clock = localClockIn(now, timeZone);
  const [schedules, intakes] = await Promise.all([
    db
      .select({
        scheduleId: supplementSchedule.id,
        supplementId: supplementSchedule.supplementId,
        name: supplement.name,
        supplementDose: supplement.dose,
        quantity: supplementSchedule.quantity,
        timeOfDay: supplementSchedule.timeOfDay,
        frequency: supplementSchedule.frequency,
        daysOfWeek: supplementSchedule.daysOfWeek,
        status: supplementSchedule.status,
      })
      .from(supplementSchedule)
      .innerJoin(supplement, eq(supplement.id, supplementSchedule.supplementId))
      .where(
        and(
          eq(supplementSchedule.organizationId, owner.organizationId),
          eq(supplementSchedule.userId, owner.userId),
          eq(supplementSchedule.status, "active"),
        ),
      ),
    // Two days back covers every zone's local today.
    db
      .select({ supplementId: supplementIntake.supplementId, at: supplementIntake.occurredAt })
      .from(supplementIntake)
      .where(
        and(
          eq(supplementIntake.organizationId, owner.organizationId),
          eq(supplementIntake.userId, owner.userId),
          isNull(supplementIntake.deletedAt),
          gte(supplementIntake.occurredAt, new Date(now.getTime() - 2 * 86_400_000)),
        ),
      ),
  ]);
  const takenToday = intakes
    .filter((row) => localDateIn(row.at, timeZone) === clock.date)
    .map((row) => row.supplementId);
  return { localDate: clock.date, items: supplementsDueNow({ schedules, takenToday, clock }) };
}
