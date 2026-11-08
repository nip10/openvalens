/*  Copyright (C) 2025 Gideon Zenz
    Copyright (C) 2026 Manuel Marcatili

    This file is part of Gadgetbridge.

    Gadgetbridge is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Gadgetbridge is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>. */

/**
 * TypeScript port of Gadgetbridge's computed HRV summary engine.
 *
 * Upstream (`ComputedHrvSummarySampleProvider`) wraps a sample provider, a
 * device and a DAO session. This port keeps only the pure math: it takes HRV
 * samples and sleep sessions as arrays and returns numbers. No database,
 * cache, device or provider coupling.
 *
 * Upstream: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/ComputedHrvSummarySampleProvider.java`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/ComputedHrvSummarySampleProvider.java
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * What is computed (upstream constants, kept exact and documented as tunable):
 * - Weekly average: the mean of all valid HRV values in the seven local
 *   calendar days ending on the summary day (`DAYS_FOR_WEEKLY_AVG = 7`).
 * - Last night: the most recent sleep session that starts inside the local
 *   noon-to-noon window (previous day 12:00 inclusive, summary day 12:00
 *   exclusive), its average HRV and its highest rolling five-sample average.
 * - Baseline: mean and population standard deviation of the last 28 overnight
 *   averages (`DAYS_FOR_BASELINE = 28`). The balanced range is mean ± 1 SD and
 *   the poor threshold is mean − 1.5 SD, all rounded to whole numbers.
 * - Status: POOR below the poor threshold, LOW below the balanced range,
 *   BALANCED inside it (inclusive), UNBALANCED above it.
 * - Guard: no baseline and status `none` until at least seven overnight
 *   averages exist (`DAYS_FOR_WEEKLY_AVG`, reused upstream as the minimum).
 *
 * Porting notes:
 * - Timestamps are epoch milliseconds. Upstream's `HrvValueSample` and
 *   `SleepSession` also carried milliseconds, while its provider query bounds
 *   were seconds; this port removes that unit boundary.
 * - HRV values are expected to be integers, as upstream's `getValue()`
 *   returns `int`. Averages are truncated toward zero (`(int) average`), and
 *   the five-sample high uses integer division, exactly as upstream.
 * - Sample ranges are inclusive on both ends (`[from, to]`), matching
 *   Gadgetbridge's `getAllSamples(from, to)` contract.
 * - The five-sample high does **not** filter non-positive values upstream,
 *   unlike the average. That asymmetry is preserved.
 * - Upstream's baseline loop stepped window ends by local calendar days but
 *   computed each window start as `windowEnd - 24 h`, which drifts to 11:00 or
 *   13:00 local across a DST transition. This port uses local noon on both
 *   edges, so every window is a true wall-clock noon-to-noon window (23, 24
 *   or 25 hours). This is the one deliberate behavioural fix.
 * - Upstream picked "the last session" from a provider list assumed sorted by
 *   start. This port picks the session with the greatest start time, breaking
 *   ties by the later end, so arbitrary input order is deterministic.
 */

import { addLocalDays, localDateKey, localNoon } from "./local-time";

/** Pinned upstream revision this port was taken from. */
export const HRV_SUMMARY_UPSTREAM_REVISION = "8976702fc3d00e6008c91fe994668cb4027f7bc2";

/** Days in the rolling weekly average. Upstream `DAYS_FOR_WEEKLY_AVG`. */
export const HRV_WEEKLY_DAYS = 7;

/** Overnight averages used for the baseline. Upstream `DAYS_FOR_BASELINE`. */
export const HRV_BASELINE_NIGHTS = 28;

/** Minimum overnight averages before a baseline is shown (upstream reuses 7). */
export const HRV_MIN_BASELINE_NIGHTS = HRV_WEEKLY_DAYS;

/** Samples in the "5-minute high" rolling window. */
export const HRV_HIGH_WINDOW_SAMPLES = 5;

/** Balanced range is mean ± this many standard deviations. */
export const HRV_BALANCED_SD = 1;

/** Poor threshold is mean − this many standard deviations. */
export const HRV_POOR_SD = 1.5;

/** One HRV value sample, epoch milliseconds. Upstream `HrvValueSample`. */
export type HrvSample = {
  /** Epoch milliseconds (UTC). */
  time: number;
  /** HRV value; upstream stores an `int`. */
  value: number;
};

/** One sleep session, epoch milliseconds. Upstream `SleepSession`. */
export type SleepSession = {
  /** Session start, epoch milliseconds (UTC). */
  start: number;
  /** Session end, epoch milliseconds (UTC). */
  end: number;
};

/** Baseline statistics. Upstream `BaselineValues`. */
export type HrvBaseline = {
  /** Arithmetic mean of the overnight averages (unrounded). */
  mean: number;
  /** Population standard deviation (divide by N, as upstream). */
  sd: number;
  /** `round(mean - 1.5 * sd)`; below this is POOR. */
  poorThreshold: number;
  /** `round(mean - sd)`; lower edge of the balanced range. */
  balancedLower: number;
  /** `round(mean + sd)`; upper edge of the balanced range (inclusive). */
  balancedUpper: number;
};

/** Upstream `HrvSummarySample.Status`, plus the no-data sentinel. */
export type HrvStatus = "none" | "poor" | "low" | "balanced" | "unbalanced";

/** Last night's summary. Upstream's `lastNightAverage` / `lastNight5MinHigh`. */
export type HrvNightSummary = {
  /** Mean of valid (> 0) values in the session, truncated to an integer. */
  average: number;
  /** Highest rolling five-sample average in the session, integer; 0 if < 5 samples. */
  high5min: number;
};

/** Java `Math.round` for a double, normalising `-0` to `0`. */
function roundInt(value: number): number {
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}

/**
 * Mean of the valid (`> 0`) samples in the inclusive range `[from, to]`,
 * truncated toward zero. Returns 0 when none are valid. Upstream
 * `calculateAverageHrv`.
 */
export function averageHrvInRange(samples: readonly HrvSample[], from: number, to: number): number {
  let sum = 0;
  let count = 0;
  for (const sample of samples) {
    if (sample.time < from || sample.time > to || sample.value <= 0) continue;
    sum += sample.value;
    count += 1;
  }
  return count === 0 ? 0 : Math.trunc(sum / count);
}

/**
 * Highest rolling five-sample average in the inclusive range `[from, to]`,
 * using integer division. Returns 0 when fewer than five samples are present.
 * Upstream `calculate5MinHighHrv`.
 *
 * Unlike the average, this does not filter non-positive values. Samples are
 * sorted by time first; upstream relied on the provider's chronological order.
 */
export function highestRollingAverage(
  samples: readonly HrvSample[],
  from: number,
  to: number,
): number {
  const window = samples
    .filter((sample) => sample.time >= from && sample.time <= to)
    .sort((left, right) => left.time - right.time);
  if (window.length < HRV_HIGH_WINDOW_SAMPLES) return 0;

  let highest = 0;
  for (let start = 0; start <= window.length - HRV_HIGH_WINDOW_SAMPLES; start += 1) {
    let sum = 0;
    for (let offset = 0; offset < HRV_HIGH_WINDOW_SAMPLES; offset += 1) {
      sum += window[start + offset]!.value;
    }
    const average = Math.trunc(sum / HRV_HIGH_WINDOW_SAMPLES);
    if (average > highest) highest = average;
  }
  return highest;
}

/**
 * The seven-day rolling average ending on `dayEnd`'s local date: the mean of
 * valid (`> 0`) samples on the seven local calendar days ending that day,
 * truncated toward zero. Returns 0 when none are valid. Upstream
 * `calculateAverageHrv(weekStart, dayEnd)`.
 *
 * `dayEnd` is the summary instant (normally 23:59:59.999 local); samples
 * after it are excluded. The window is local calendar days, not 7 × 24 h.
 */
export function computeWeeklyAverage(
  samples: readonly HrvSample[],
  dayEnd: number,
  timeZone: string,
): number {
  const day = localDateKey(dayEnd, timeZone);
  const firstDay = addLocalDays(day, -(HRV_WEEKLY_DAYS - 1));

  let sum = 0;
  let count = 0;
  for (const sample of samples) {
    if (sample.value <= 0 || sample.time > dayEnd) continue;
    const sampleDay = localDateKey(sample.time, timeZone);
    if (sampleDay < firstDay || sampleDay > day) continue;
    sum += sample.value;
    count += 1;
  }
  return count === 0 ? 0 : Math.trunc(sum / count);
}

/** The session with the greatest start in `[from, to)`, ties by later end. */
function latestSessionStartingIn(
  sessions: readonly SleepSession[],
  from: number,
  to: number,
): SleepSession | null {
  let latest: SleepSession | null = null;
  for (const session of sessions) {
    if (session.start < from || session.start >= to) continue;
    if (
      latest === null ||
      session.start > latest.start ||
      (session.start === latest.start && session.end > latest.end)
    ) {
      latest = session;
    }
  }
  return latest;
}

/**
 * The overnight averages for the `nights` local noon-to-noon windows ending
 * at noon on `dayEnd`'s date, most recent first. Each window picks the
 * session with the greatest start inside it, then averages that session's
 * valid HRV samples; nights without a session or with an average of 0 are
 * omitted. Upstream `calculateBaseline`'s collection loop.
 *
 * Windows are true local noon-to-noon spans, so a DST day is 23 or 25 hours.
 * The default `nights` is the upstream 28.
 */
export function computeNightlyAverages(
  samples: readonly HrvSample[],
  sessions: readonly SleepSession[],
  dayEnd: number,
  timeZone: string,
  nights: number = HRV_BASELINE_NIGHTS,
): number[] {
  if (!Number.isInteger(nights) || nights < 0) {
    throw new RangeError("nights must be a non-negative integer");
  }

  const day = localDateKey(dayEnd, timeZone);
  const averages: number[] = [];
  for (let index = 0; index < nights; index += 1) {
    const windowEnd = localNoon(addLocalDays(day, -index), timeZone);
    const windowStart = localNoon(addLocalDays(day, -index - 1), timeZone);
    const session = latestSessionStartingIn(sessions, windowStart, windowEnd);
    if (session === null) continue;
    const average = averageHrvInRange(samples, session.start, session.end);
    if (average > 0) averages.push(average);
  }
  return averages;
}

/**
 * Baseline statistics over the supplied overnight averages, or `null` until
 * at least seven are present. Upstream `calculateBaseline` after collection.
 *
 * The standard deviation is the population SD (divide by N), matching
 * upstream. `mean` and `sd` are unrounded; the three thresholds are rounded
 * to whole numbers.
 */
export function computeBaseline(nightlyAverages: readonly number[]): HrvBaseline | null {
  if (nightlyAverages.length < HRV_MIN_BASELINE_NIGHTS) return null;

  let sum = 0;
  for (const value of nightlyAverages) sum += value;
  const mean = sum / nightlyAverages.length;

  let varianceSum = 0;
  for (const value of nightlyAverages) {
    const difference = value - mean;
    varianceSum += difference * difference;
  }
  const sd = Math.sqrt(varianceSum / nightlyAverages.length);

  return {
    mean,
    sd,
    poorThreshold: roundInt(mean - HRV_POOR_SD * sd),
    balancedLower: roundInt(mean - HRV_BALANCED_SD * sd),
    balancedUpper: roundInt(mean + HRV_BALANCED_SD * sd),
  };
}

/**
 * The status level for a weekly average against a baseline. Upstream
 * `determineStatus`.
 *
 * Returns `none` when the weekly average is 0, the baseline is missing, or
 * either balanced edge rounds to 0 (upstream's no-data guard). Boundaries
 * follow upstream: `weeklyAvg < poorThreshold` is POOR, `< balancedLower` is
 * LOW, `<= balancedUpper` is BALANCED, anything higher is UNBALANCED. A value
 * exactly on a boundary therefore belongs to the less severe band.
 */
export function hrvStatus(weeklyAverage: number, baseline: HrvBaseline | null): HrvStatus {
  if (
    weeklyAverage === 0 ||
    baseline === null ||
    baseline.balancedLower === 0 ||
    baseline.balancedUpper === 0
  ) {
    return "none";
  }

  if (weeklyAverage < baseline.poorThreshold) return "poor";
  if (weeklyAverage < baseline.balancedLower) return "low";
  if (weeklyAverage <= baseline.balancedUpper) return "balanced";
  return "unbalanced";
}

/**
 * Last night's average and five-sample high, or `null` when no session starts
 * in the local noon-to-noon window or the session has no valid HRV samples.
 * Upstream's `generateSummaryForDay` last-night block.
 *
 * The window is previous local noon (inclusive) to the summary day's local
 * noon (exclusive). When several sessions start inside it, the one with the
 * greatest start wins.
 */
export function summarizeLastNight(
  samples: readonly HrvSample[],
  sessions: readonly SleepSession[],
  dayEnd: number,
  timeZone: string,
): HrvNightSummary | null {
  const day = localDateKey(dayEnd, timeZone);
  const windowStart = localNoon(addLocalDays(day, -1), timeZone);
  const windowEnd = localNoon(day, timeZone);
  const session = latestSessionStartingIn(sessions, windowStart, windowEnd);
  if (session === null) return null;

  const average = averageHrvInRange(samples, session.start, session.end);
  if (average <= 0) return null;
  return {
    average,
    high5min: highestRollingAverage(samples, session.start, session.end),
  };
}
