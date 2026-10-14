/**
 * Sleep presentation shared by web and mobile. Pure TypeScript; only sibling
 * presenter helpers are imported — safe for the app bundle. Copy follows
 * docs/mobile/tone-of-voice.md (sentence case, ISO dates, no medical
 * disclaimer).
 */
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

/**
 * Lookback, in days, the dashboard uses to find the most recent night (#134).
 * `sleep.summary` only accepts windows of `[7, 365]` days, and a single night
 * is never a meaningful aggregate, so the dashboard asks for the shortest valid
 * window and shows `lastNight` — the latest night inside it — labelled with its
 * own date. Never present this window as "today".
 */
export const LATEST_NIGHT_LOOKBACK_DAYS = 7;

/** "Latest night · 2026-10-01 · Acceptable" — the dashboard sleep caption. */
export function latestNightCaption(night: Pick<SleepDailyLike, "date" | "status">): string {
  return `Latest night · ${night.date} · ${sleepStatusLabel(night.status)}`;
}

const STATUS_LABEL: Record<SleepDailyLike["status"], string> = {
  optimal: "Optimal",
  acceptable: "Acceptable",
  mild_sleep_debt: "Mild sleep debt",
  high_sleep_debt: "High sleep debt",
  fragmented_sleep: "Fragmented",
  irregular_schedule: "Irregular schedule",
  low_confidence: "Low confidence",
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

export function sleepStatusLabel(status: SleepDailyLike["status"]): string {
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
): { stage: string; minutes: number; label: string }[] {
  if (!last) return [];
  return [
    { stage: "awake", minutes: last.awakeMinutes, label: "Awake" },
    { stage: "light", minutes: last.lightMinutes, label: "Light" },
    { stage: "deep", minutes: last.deepMinutes, label: "Deep" },
    { stage: "rem", minutes: last.remMinutes, label: "REM" },
    { stage: "unknown", minutes: last.unknownStageMinutes, label: "Untracked" },
  ].filter((entry) => entry.minutes > 0);
}
