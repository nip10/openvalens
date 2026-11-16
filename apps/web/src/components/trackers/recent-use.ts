import type { TrackerAggregation, TrackerType } from "@openvalens/trackers/model";

/**
 * How a tracker has been used lately, from its chart days (oldest first, one
 * combined value per local day, `null` when nothing was logged). Pure.
 *
 * A day with no entry stays empty: it never counts as zero in the average,
 * and the strip shows it as a gap.
 */
export type TrackerDay = { date: string; value: number | null };

export type RecentFigure =
  /** Ratings and averaged numbers: the mean of the logged days. */
  | { kind: "average"; value: number }
  /** Durations and counted numbers: everything logged in the window. */
  | { kind: "total"; value: number }
  /** Yes or no: the days that said yes. */
  | { kind: "yes_days"; value: number };

export type RecentUse = {
  /** The newest logged day in the data, or null when there is none. */
  last: { date: string; value: number } | null;
  /** The last `windowDays` days, oldest first, ending on the newest day. */
  window: TrackerDay[];
  loggedDays: number;
  /** Null when nothing was logged in the window. */
  figure: RecentFigure | null;
};

export const RECENT_WINDOW_DAYS = 7;

export function recentTrackerUse(
  days: readonly TrackerDay[],
  shape: { type: TrackerType; aggregation: TrackerAggregation },
  windowDays: number = RECENT_WINDOW_DAYS,
): RecentUse {
  let last: RecentUse["last"] = null;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const day = days[index]!;
    if (day.value !== null) {
      last = { date: day.date, value: day.value };
      break;
    }
  }
  const window = days.slice(-windowDays);
  const logged = window.flatMap((day) => (day.value === null ? [] : [day.value]));
  const sum = logged.reduce((total, value) => total + value, 0);
  let figure: RecentFigure | null = null;
  if (logged.length > 0) {
    if (shape.type === "yes_no")
      figure = { kind: "yes_days", value: logged.filter((value) => value > 0).length };
    else if (shape.type !== "scale" && shape.aggregation === "sum")
      figure = { kind: "total", value: sum };
    else figure = { kind: "average", value: Math.round((sum / logged.length) * 10) / 10 };
  }
  return { last, window, loggedDays: logged.length, figure };
}

/**
 * How tall a day's bar is in the strip, from 0 to 1: a rating against 5, yes
 * as full, anything else against the window's biggest day. Null for a day
 * with nothing logged (drawn as a gap, not a zero bar).
 */
export function stripHeight(
  value: number | null,
  type: TrackerType,
  windowMax: number,
): number | null {
  if (value === null) return null;
  if (type === "scale") return Math.max(0, Math.min(1, value / 5));
  if (type === "yes_no") return value > 0 ? 1 : 0;
  if (windowMax <= 0) return 0;
  return Math.max(0, Math.min(1, value / windowMax));
}
