/**
 * Sleep presentation shared by web and mobile. Pure TypeScript; only sibling
 * presenter helpers are imported — safe for the app bundle. Copy follows
 * docs/mobile/tone-of-voice.md (sentence case, ISO dates, no medical
 * disclaimer).
 */
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { formatProductTime, type ProductDisplaySettings } from "./product-formatting";

export type SleepDailyLike = {
  date: string;
  mainSleepStart: string | null;
  mainSleepEnd: string | null;
  asleepMinutes: number;
  timeInBedMinutes: number | null;
  awakeMinutes: number;
  sleepEfficiencyPct: number | null;
  deepMinutes: number;
  remMinutes: number;
  lightMinutes: number;
  awakeMinutesFromStages?: number;
  unknownStageMinutes: number;
  interruptionsCount: number;
  targetMinutes: number;
  sleepDebtMinutes: number;
  qualityScore: number;
  confidence: "high" | "medium" | "low";
  status:
    | "optimal"
    | "acceptable"
    | "mild_sleep_debt"
    | "high_sleep_debt"
    | "fragmented_sleep"
    | "irregular_schedule"
    | "low_confidence";
};

export type SleepWindowLike = {
  days: SleepDailyLike[];
  lastNight: SleepDailyLike | null;
  sevenDayAverageMinutes: number | null;
  averageSleepDebtMinutes: number | null;
  status: SleepDailyLike["status"];
  confidence: SleepDailyLike["confidence"];
};

const STATUS_LABEL: Record<SleepDailyLike["status"], MessageDescriptor> = {
  optimal: msg`Optimal`,
  acceptable: msg`Acceptable`,
  mild_sleep_debt: msg`Mild sleep debt`,
  high_sleep_debt: msg`High sleep debt`,
  fragmented_sleep: msg`Fragmented`,
  irregular_schedule: msg`Irregular schedule`,
  low_confidence: msg`Low confidence`,
};

/** Severity tone used to pick a chip color. `null` keeps neutral chrome. */
export function sleepStatusTone(
  status: SleepDailyLike["status"],
): "destructive" | "warning" | "success" | null {
  if (status === "high_sleep_debt" || status === "fragmented_sleep") return "destructive";
  if (status === "mild_sleep_debt" || status === "irregular_schedule") return "warning";
  if (status === "optimal") return "success";
  return null;
}

export function sleepStatusLabel(status: SleepDailyLike["status"]): MessageDescriptor {
  return STATUS_LABEL[status];
}

/** "7h 32m" / "42m". Negative numbers become "0m". */
export function formatSleepDuration(totalMinutes: number | null | undefined): string {
  if (totalMinutes === null || totalMinutes === undefined || !Number.isFinite(totalMinutes)) {
    return "—";
  }
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const rest = minutes - hours * 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** Same shape but always shows the hours part, e.g. "0h 42m". */
export function formatSleepDurationWithHours(totalMinutes: number | null | undefined): string {
  if (totalMinutes === null || totalMinutes === undefined || !Number.isFinite(totalMinutes)) {
    return "—";
  }
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const rest = minutes - hours * 60;
  return `${hours}h ${rest}m`;
}

/** "92%" / "—". Efficiency is a percentage already. */
export function formatSleepEfficiency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${Math.round(value)}%`;
}

/**
 * Convert an ISO timestamp to "HH:mm". Locale comes from the optional display
 * settings (default en-GB, 24-hour); the device-local timezone is preserved
 * unless an explicit `timeZone` is supplied.
 */
export function formatClockTime(
  iso: string | null | undefined,
  settings?: ProductDisplaySettings | null,
): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return formatProductTime(date, settings?.locale ?? "en-GB", undefined, settings?.timeZone);
}

/** Oldest-first series of `{ date, asleepMinutes }` for trend charts. */
export function sleepSeries(window: Pick<SleepWindowLike, "days">): {
  date: string;
  asleepMinutes: number;
  label: string;
}[] {
  const sorted = [...window.days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return sorted.map((day) => ({
    date: day.date,
    asleepMinutes: day.asleepMinutes,
    label: day.date.slice(5),
  }));
}

/** Per-stage minutes for last night, suitable for a stack/segment chart. */
export function lastNightStages(
  last: SleepDailyLike | null,
): { stage: string; minutes: number; label: MessageDescriptor }[] {
  if (!last) return [];
  return [
    { stage: "awake", minutes: last.awakeMinutes, label: msg`Awake` },
    {
      stage: "light",
      minutes: last.lightMinutes,
      label: msg({ message: "Light", context: "sleep stage" }),
    },
    { stage: "deep", minutes: last.deepMinutes, label: msg`Deep` },
    { stage: "rem", minutes: last.remMinutes, label: msg`REM` },
    { stage: "unknown", minutes: last.unknownStageMinutes, label: msg`Untracked` },
  ].filter((entry) => entry.minutes > 0);
}
