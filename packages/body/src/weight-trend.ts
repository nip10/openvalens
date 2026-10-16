/**
 * Provisional weight trend (Issue #87).
 *
 * A read-only projection over the member's existing canonical daily weights
 * (`daily_weight`, one row per local day after reconciliation). Nothing is
 * persisted and no second weight store exists: the trend is recomputed from
 * the recorded rows on every read.
 *
 * The method is an engineering choice selected for evaluation, not a
 * validated rule, so every result is labelled provisional and carries the
 * method id, version and parameters. Version {@link WEIGHT_TREND_METHOD}:
 *
 * - For each recorded day `d`, the trend is the plain mean of the recorded
 *   daily weights on the local dates `d - (windowDays - 1)` … `d`. Recorded
 *   days before the requested range count toward the first windows, so a
 *   range boundary does not change a value.
 * - A window with fewer than `minObservations` recorded days has no trend
 *   value (`null`); it is never filled in from neighbouring days.
 * - Trend values exist only on recorded days. Days without a recorded
 *   weight are reported as gaps, never interpolated or shown as values.
 * - Trend values and changes are rounded to `precisionKg`; recorded values
 *   keep the stored reading (rounded to 0.01 kg to drop float noise).
 *
 * Dates are the member's local dates as stored on the daily row, never
 * recomputed from UTC timestamps. This module is pure and client-safe.
 */

export const WEIGHT_TREND_METHOD = Object.freeze({
  id: "trailing_mean" as const,
  version: 1 as const,
  /** Calendar days in each trailing window, including the day itself. */
  windowDays: 7,
  /** Recorded days a window needs before it yields a trend value. */
  minObservations: 3,
  /** Trend values and changes are rounded to this step (kg). */
  precisionKg: 0.1,
});

export type WeightTrendMethod = typeof WEIGHT_TREND_METHOD;

/** Longest range one call may cover. */
export const MAX_WEIGHT_TREND_RANGE_DAYS = 366;

/** Neutral, value-free copy shown with every trend (no judgement, no clinical claims). */
export const WEIGHT_TREND_NOTES = Object.freeze({
  provisional:
    "Provisional: this line averages your recorded weights over the previous 7 days. It is an experimental view, not a measurement.",
  variability:
    "Scale weight can move from day to day with fluid shifts, the menstrual cycle, illness, medication and changes in what you eat.",
  gaps: "Days without a recorded weight are shown as gaps. They are not filled in.",
  sparse:
    "A trend value appears only when at least 3 of the previous 7 days have a recorded weight.",
});

export type DailyWeightSource = "auto" | "override";

/** One canonical daily row as stored (any order, any date). */
export type DailyWeightObservation = {
  date: string;
  weightKg: number;
  source: string;
};

export type WeightTrendPoint = {
  date: string;
  /** The recorded daily weight for this local day. */
  observedKg: number;
  source: DailyWeightSource;
  /** True when the member set this day's weight by hand (an override). */
  manualCorrection: boolean;
  /** Trailing mean, or `null` when the window holds too few recorded days. */
  trendKg: number | null;
  /** Recorded days inside this point's window (including lookback days). */
  windowObservations: number;
};

export type WeightTrendGap = { from: string; to: string; days: number };

export type WeightTrendCompleteness = {
  /** Calendar days in the requested range. */
  days: number;
  /** Days in the range with a recorded weight. */
  observedDays: number;
  missingDays: number;
  /** Recorded days that also have a trend value. */
  trendDays: number;
  manualCorrectionDays: number;
  longestGapDays: number;
  firstObservedDate: string | null;
  lastObservedDate: string | null;
};

export type WeightTrendChange = {
  from: string;
  to: string;
  /** Calendar days between the two trend values. */
  days: number;
  kg: number;
};

export type WeightTrend = {
  /**
   * `insufficient_data` when fewer than two recorded days have a trend
   * value, so no change can be described. Consumers (#76) apply their own,
   * stricter readiness rules on top of `completeness`.
   */
  status: "provisional" | "insufficient_data";
  provisional: true;
  range: { from: string; to: string };
  method: WeightTrendMethod;
  points: WeightTrendPoint[];
  gaps: WeightTrendGap[];
  completeness: WeightTrendCompleteness;
  /** Change between the first and last trend values in the range, or `null`. */
  change: WeightTrendChange | null;
  notes: typeof WEIGHT_TREND_NOTES;
};

export class WeightTrendInputError extends Error {
  readonly code = "INVALID_INPUT";
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dayIndex(localDate: string): number {
  const [year, month, day] = localDate.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / 86_400_000;
}

function dateAt(index: number): string {
  return new Date(index * 86_400_000).toISOString().slice(0, 10);
}

function isLocalDate(value: string): boolean {
  return LOCAL_DATE.test(value) && dateAt(dayIndex(value)) === value;
}

function roundTo(value: number, step: number): number {
  const decimals = Math.max(0, Math.round(-Math.log10(step)));
  // `|| 0` folds a rounded -0 into 0.
  return Number((Math.round(value / step) * step).toFixed(decimals)) || 0;
}

/**
 * Validates a range and returns the first local date whose rows the trend
 * needs (the range start minus the window lookback).
 */
export function weightTrendQueryStart(range: { from: string; to: string }): string {
  if (!isLocalDate(range.from) || !isLocalDate(range.to))
    throw new WeightTrendInputError("Local date must be a YYYY-MM-DD calendar date");
  const start = dayIndex(range.from);
  const end = dayIndex(range.to);
  if (end < start) throw new WeightTrendInputError("Range must not end before it starts");
  if (end - start + 1 > MAX_WEIGHT_TREND_RANGE_DAYS)
    throw new WeightTrendInputError(`Range must cover at most ${MAX_WEIGHT_TREND_RANGE_DAYS} days`);
  return dateAt(start - (WEIGHT_TREND_METHOD.windowDays - 1));
}

/** Pure trend over canonical daily rows; rows outside the lookback and range are ignored. */
export function buildWeightTrend(
  rows: ReadonlyArray<DailyWeightObservation>,
  range: { from: string; to: string },
): WeightTrend {
  const method = WEIGHT_TREND_METHOD;
  const lookbackStart = dayIndex(weightTrendQueryStart(range));
  const start = dayIndex(range.from);
  const end = dayIndex(range.to);

  // One value per local day. The canonical table is unique per day already;
  // the first usable row wins if a caller passes duplicates anyway.
  const byDay = new Map<number, DailyWeightObservation>();
  for (const row of rows) {
    if (!isLocalDate(row.date) || !Number.isFinite(row.weightKg) || row.weightKg <= 0) continue;
    const index = dayIndex(row.date);
    if (index < lookbackStart || index > end || byDay.has(index)) continue;
    byDay.set(index, row);
  }

  const points: WeightTrendPoint[] = [];
  const gaps: WeightTrendGap[] = [];
  let gapStart: number | null = null;
  const closeGap = (until: number) => {
    if (gapStart === null) return;
    gaps.push({ from: dateAt(gapStart), to: dateAt(until), days: until - gapStart + 1 });
    gapStart = null;
  };

  for (let index = start; index <= end; index += 1) {
    const row = byDay.get(index);
    if (!row) {
      gapStart ??= index;
      continue;
    }
    closeGap(index - 1);

    let sum = 0;
    let count = 0;
    for (let offset = 0; offset < method.windowDays; offset += 1) {
      const inWindow = byDay.get(index - offset);
      if (!inWindow) continue;
      sum += inWindow.weightKg;
      count += 1;
    }
    const source: DailyWeightSource = row.source === "override" ? "override" : "auto";
    points.push({
      date: row.date,
      observedKg: roundTo(row.weightKg, 0.01),
      source,
      manualCorrection: source === "override",
      trendKg: count >= method.minObservations ? roundTo(sum / count, method.precisionKg) : null,
      windowObservations: count,
    });
  }
  closeGap(end);

  const trendPoints = points.filter((point) => point.trendKg !== null);
  const first = trendPoints[0];
  const last = trendPoints.at(-1);
  const change =
    first && last && first !== last
      ? {
          from: first.date,
          to: last.date,
          days: dayIndex(last.date) - dayIndex(first.date),
          kg: roundTo(last.trendKg! - first.trendKg!, method.precisionKg),
        }
      : null;

  const days = end - start + 1;
  return {
    status: change ? "provisional" : "insufficient_data",
    provisional: true,
    range: { from: range.from, to: range.to },
    method,
    points,
    gaps,
    completeness: {
      days,
      observedDays: points.length,
      missingDays: days - points.length,
      trendDays: trendPoints.length,
      manualCorrectionDays: points.filter((point) => point.manualCorrection).length,
      longestGapDays: Math.max(0, ...gaps.map((gap) => gap.days)),
      firstObservedDate: points[0]?.date ?? null,
      lastObservedDate: points.at(-1)?.date ?? null,
    },
    change,
    notes: WEIGHT_TREND_NOTES,
  };
}
