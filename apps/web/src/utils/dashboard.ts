/** Pure helpers for the dashboard's tiles and chart. */

const USUAL_DAYS = 7;

type VitalsDay = { date: string; restingHeartRate: { avgBpm: number | null } };

/**
 * The newest day with a resting heart rate, and "your usual": the rounded mean
 * of the last seven days that have one (as the Steps tile's usual is the
 * seven-day average). The usual needs at least two days.
 */
export function restingHeartRateTile(days: readonly VitalsDay[]): {
  latest: { date: string; bpm: number } | null;
  usualBpm: number | null;
} {
  const withValue = days.filter(
    (day): day is VitalsDay & { restingHeartRate: { avgBpm: number } } =>
      day.restingHeartRate.avgBpm !== null,
  );
  const last = withValue.at(-1);
  const recent = withValue.slice(-USUAL_DAYS);
  return {
    latest: last ? { date: last.date, bpm: Math.round(last.restingHeartRate.avgBpm) } : null,
    usualBpm:
      recent.length >= 2
        ? Math.round(
            recent.reduce((sum, day) => sum + day.restingHeartRate.avgBpm, 0) / recent.length,
          )
        : null,
  };
}

/** A `YYYY-MM-DD` day as UTC milliseconds, for a time axis. */
export function dayMs(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

/**
 * Evenly spaced days for the weight chart's time axis (#dashboard-11): every
 * Monday in the window, or every second (third, …) Monday when that would
 * crowd it, so the gaps are always whole weeks.
 */
export function weightAxisTicks(first: string, last: string, maxTicks = 8): string[] {
  const mondays: string[] = [];
  const cursor = new Date(dayMs(first));
  const end = dayMs(last);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end)) return [];
  while (cursor.getTime() <= end) {
    if (cursor.getUTCDay() === 1) mondays.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const stride = Math.max(1, Math.ceil(mondays.length / maxTicks));
  // Counted back from the latest Monday, so the newest weeks keep their tick.
  return mondays.filter((_, index) => (mondays.length - 1 - index) % stride === 0);
}
