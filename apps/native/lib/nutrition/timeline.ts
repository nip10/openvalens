import type {
  DiaryEntry,
  MealSlot,
  NutrientValues,
} from "@openvalens/api/contracts/nutrition-diary";

import type { DiaryRow } from "./outbox";

/**
 * The diary's timeline view (#393): the same rows as the meal view, placed
 * at the hour they were eaten. An entry sits at its `consumedAt` when the
 * member picked a time ("Add at this hour"), else at the time it was logged.
 * Pure, so it is unit tested without React Native.
 */

/** The four figures every diary row shows, in this order. */
export const ROW_MACROS = ["energyKcal", "proteinG", "carbohydrateG", "fatG"] as const;
export type RowMacro = (typeof ROW_MACROS)[number];

export type MacroSums = Record<RowMacro, number | null>;

/** The row's nutrient values (server, local projection or queued preview), or `null`. */
export function rowNutrients(row: DiaryRow): NutrientValues | null {
  if (row.kind === "server") return row.entry.nutrients;
  return row.localEntry?.entry?.nutrients ?? row.change.preview?.nutrients ?? null;
}

/** The row's meal slot, or `null` when a queued change carries none. */
export function rowSlot(row: DiaryRow): MealSlot | null {
  if (row.kind === "server") return row.entry.slot;
  return row.localEntry?.slot ?? (row.change.op.kind === "log" ? row.change.op.input.slot : null);
}

function validInstant(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The time a timeline uses when a row carries none it can read (start of the epoch). */
const UNKNOWN_INSTANT = new Date(0).toISOString();

function entryInstant(entry: Pick<DiaryEntry, "consumedAt" | "createdAt">): string | null {
  return validInstant(entry.consumedAt) ?? validInstant(entry.createdAt);
}

/** When the row's food was eaten (or logged), as an ISO instant. */
export function rowInstant(row: DiaryRow): string {
  if (row.kind === "server") return entryInstant(row.entry) ?? UNKNOWN_INSTANT;
  const fromEntry = row.localEntry?.entry ? entryInstant(row.localEntry.entry) : null;
  if (fromEntry) return fromEntry;
  const picked =
    row.change.op.kind === "log" ? validInstant(row.change.op.input?.consumedAt) : null;
  return picked ?? validInstant(row.change.createdAt) ?? UNKNOWN_INSTANT;
}

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    // Some engines print midnight as 24 even with h23.
    hour: value("hour") % 24,
    minute: value("minute"),
    second: value("second"),
  };
}

/** The hour (0–23) of `instant` in `timeZone`; the device zone when the zone is unknown. */
export function localHour(instant: string, timeZone: string): number {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return 0;
  try {
    return zonedParts(date, timeZone).hour;
  } catch {
    return date.getHours();
  }
}

/** Milliseconds `timeZone` is ahead of UTC at `instant`. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const p = zonedParts(new Date(instant), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The ISO instant of `hour`:00 on `localDate` in `timeZone`, for logging a
 * food at that hour. On a daylight-saving gap the next real instant is used.
 */
export function consumedAtForHour(localDate: string, hour: number, timeZone: string): string {
  const [year, month, day] = localDate.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(year, month - 1, day, hour, 0, 0);
  try {
    let instant = wall - zoneOffsetMs(wall, timeZone);
    // A second pass settles the offset when the first guess crossed a change.
    instant = wall - zoneOffsetMs(instant, timeZone);
    return new Date(instant).toISOString();
  } catch {
    return new Date(year, month - 1, day, hour, 0, 0).toISOString();
  }
}

/** `"08:00"`: hours read the same in en and pt-PT. */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** Sums the known values of each macro; `null` when no row knew it. */
export function sumMacros(rows: readonly DiaryRow[]): MacroSums {
  const sums: MacroSums = { energyKcal: null, proteinG: null, carbohydrateG: null, fatG: null };
  for (const row of rows) {
    const values = rowNutrients(row);
    if (!values) continue;
    for (const key of ROW_MACROS) {
      const value = values[key];
      if (value === null || value === undefined) continue;
      sums[key] = (sums[key] ?? 0) + value;
    }
  }
  return sums;
}

export type TimelineHour = {
  hour: number;
  rows: DiaryRow[];
  totals: MacroSums;
};

/**
 * Rows grouped by local hour, earliest first; rows inside an hour by time,
 * then by key so the order is stable. Empty hours are left out.
 */
export function groupByHour(rows: readonly DiaryRow[], timeZone: string): TimelineHour[] {
  const timed = rows.map((row) => {
    const instant = rowInstant(row);
    return { row, instant, at: Date.parse(instant) || 0 };
  });
  timed.sort((a, b) => a.at - b.at || (a.row.key < b.row.key ? -1 : a.row.key > b.row.key ? 1 : 0));
  const byHour = new Map<number, DiaryRow[]>();
  for (const { row, instant } of timed) {
    const hour = localHour(instant, timeZone);
    const list = byHour.get(hour) ?? [];
    list.push(row);
    byHour.set(hour, list);
  }
  return [...byHour.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, list]) => ({ hour, rows: list, totals: sumMacros(list) }));
}

/** The current hour in `timeZone` (for the search bar's "logs at 13:00"). */
export function currentHour(timeZone: string, now: Date = new Date()): number {
  return localHour(now.toISOString(), timeZone);
}

/** The meal slot an hour falls in, the same split as logging by time of day. */
export function slotForHour(hour: number): MealSlot {
  const minutes = hour * 60;
  if (minutes < 10 * 60 + 30) return "breakfast";
  if (minutes < 15 * 60) return "lunch";
  if (minutes < 17 * 60 + 30) return "snack";
  if (minutes < 21 * 60 + 30) return "dinner";
  return "snack";
}
