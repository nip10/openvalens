/**
 * Activity presentation shared by web and mobile. Pure TypeScript, no
 * imports — safe for the app bundle. Copy follows
 * docs/mobile/tone-of-voice.md (sentence case, ISO dates, real units).
 */
export type DailyActivityTotalsLike = {
  date: string;
  steps: number | null;
  activeCaloriesKcal: number | null;
  distanceMeters: number | null;
};

export type DailyActivitySummary = {
  date: string;
  steps: number;
  activeCaloriesKcal: number;
  distanceMeters: number;
};

export type ActivitySummary = {
  date: string;
  steps: number;
  activeCaloriesKcal: number;
  distanceMeters: number;
  /** Step days with at least one row, used for averages that ignore idle days. */
  activeDayCount: number;
};

/** Coalesces nulls to zero and computes active-day average steps. */
export function summarizeDailyActivity(rows: readonly DailyActivityTotalsLike[]): {
  days: DailyActivitySummary[];
  today: ActivitySummary | null;
  sevenDayAverageSteps: number;
  sevenDayAverageCalories: number;
  sevenDayAverageDistance: number;
} {
  const days = rows.map((row) => ({
    date: row.date,
    steps: row.steps ?? 0,
    activeCaloriesKcal: row.activeCaloriesKcal ?? 0,
    distanceMeters: row.distanceMeters ?? 0,
  }));
  const today = days.at(-1) ?? null;
  const last7 = days.slice(-7);
  const activeDays = last7.filter((day) => day.steps > 0);
  const sevenDayAverageSteps =
    activeDays.length > 0
      ? Math.round(activeDays.reduce((sum, day) => sum + day.steps, 0) / activeDays.length)
      : 0;
  const sevenDayAverageCalories =
    last7.length > 0
      ? Math.round(last7.reduce((sum, day) => sum + day.activeCaloriesKcal, 0) / last7.length)
      : 0;
  const sevenDayAverageDistance =
    last7.length > 0
      ? Math.round(last7.reduce((sum, day) => sum + day.distanceMeters, 0) / last7.length)
      : 0;

  return {
    days,
    today: today ? { ...today, activeDayCount: activeDays.length } : null,
    sevenDayAverageSteps,
    sevenDayAverageCalories,
    sevenDayAverageDistance,
  };
}

/** "12,345" / "1.2k" / "0". */
export function formatSteps(value: number): string {
  if (value < 1000) return value.toLocaleString("en-US");
  if (value < 10_000) return `${(value / 1000).toFixed(1)}k`;
  return `${Math.round(value / 1000)}k`;
}

/** "320 kcal" / "—" for null/0. */
export function formatKcalories(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value <= 0) return "0 kcal";
  return `${Math.round(value).toLocaleString("en-US")} kcal`;
}

/** "5.4 km" / "—" for null/0. */
export function formatDistanceMeters(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value <= 0) return "0 m";
  if (value < 1000) return `${Math.round(value)} m`;
  return `${(value / 1000).toFixed(1)} km`;
}

/** Chart series: oldest-first steps per day. */
export function stepsSeries(days: readonly DailyActivitySummary[]): {
  date: string;
  steps: number;
  label: string;
}[] {
  return days.map((day) => ({
    date: day.date,
    steps: day.steps,
    label: day.date.slice(5),
  }));
}
