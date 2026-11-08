/*  Copyright (C) 2026 Manuel Marcatili

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
 * TypeScript port of Gadgetbridge's `WidgetHistory` time-series primitives.
 *
 * These are the small aggregation helpers behind Gadgetbridge's home-screen
 * tiles: per-bucket averages, minutes per local hour, hypnogram lane merging,
 * and latest-value-per-day/week series. They are pure functions over plain
 * numbers, so daily summaries and mini charts can share them without touching
 * the database.
 *
 * Upstream: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/widgets/WidgetHistory.kt`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/widgets/WidgetHistory.kt
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * Porting notes:
 * - Timestamps are epoch milliseconds, matching the sleep estimator port.
 *   Upstream used epoch seconds; every duration here is milliseconds too, so
 *   a call site never mixes units.
 * - Upstream read the JVM default zone (`ZoneId.systemDefault()`). This port
 *   takes an explicit IANA zone on every function that needs a calendar, so
 *   results are deterministic and testable.
 * - Kotlin `Float` becomes JavaScript `number` (float64), matching the sleep
 *   estimator port. Bucket arrays are `Float64Array` so `NaN` can mark an
 *   empty bucket without a separate presence mask.
 * - `hourlyAverages` is kept as the same convenience wrapper upstream has.
 *
 * Local-time semantics:
 * Upstream used `Instant -> ZonedDateTime -> LocalTime`. JavaScript has no
 * zone-aware calendar, so this module asks `Intl.DateTimeFormat` for the
 * wall-clock date and time of an instant in the requested zone. That agrees
 * with `ZonedDateTime` for every instant:
 * - A skipped local time (spring forward) has no instant, so no sample can
 *   land in that bucket; the bucket stays `NaN` (or zero minutes).
 * - A repeated local time (fall back) maps both instants to the same
 *   wall-clock time-of-day, so both land in the same bucket. A "minutes per
 *   local hour" bucket can therefore hold up to 120 minutes.
 * - Day boundaries are compared as local date keys (`YYYY-MM-DD`), never by
 *   adding 24 h to an epoch, so 23- and 25-hour days are handled correctly.
 *
 * This is the same wall-clock behaviour as upstream, not an approximation.
 * The one thing `Intl` cannot express is a zone whose offset has a
 * sub-second component; all IANA offsets since 1970 are whole seconds.
 */

/** Pinned upstream revision this port was taken from. */
export const WIDGET_HISTORY_UPSTREAM_REVISION = "8976702fc3d00e6008c91fe994668cb4027f7bc2";

export const HOURS_PER_DAY = 24;
export const SECONDS_PER_HOUR = 3600;
export const DAYS_PER_WEEK = 7;

const MILLIS_PER_SECOND = 1000;
const MILLIS_PER_MINUTE = 60_000;
const MILLIS_PER_HOUR = 3_600_000;
const MILLIS_PER_DAY = 86_400_000;

/** A value at an instant, epoch milliseconds. Upstream `TimedValue`. */
export type TimedValue = {
  /** Epoch milliseconds (UTC). */
  time: number;
  value: number;
};

/** One stage/lane sample, epoch milliseconds. Upstream used `Pair<Long, Int>`. */
export type LaneSample = {
  /** Epoch milliseconds (UTC). */
  time: number;
  /** Opaque lane value; the hypnogram uses stage codes. */
  lane: number;
};

/** `[start, end)` spent in one lane, epoch milliseconds. Upstream `HypnogramSegment`. */
export type LaneStretch = {
  start: number;
  end: number;
  lane: number;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * One formatter per zone. `hourCycle: "h23"` keeps midnight `00`, not `24`;
 * `en-US` only supplies the field order, which `formatToParts` discards.
 */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

type LocalStamp = {
  date: string;
  hour: number;
  minute: number;
  second: number;
};

function localStamp(time: number, timeZone: string): LocalStamp {
  const parts = formatterFor(timeZone).formatToParts(time);
  let year = "";
  let month = "";
  let day = "";
  let hour = "";
  let minute = "";
  let second = "";
  for (const part of parts) {
    switch (part.type) {
      case "year":
        year = part.value;
        break;
      case "month":
        month = part.value;
        break;
      case "day":
        day = part.value;
        break;
      case "hour":
        hour = part.value;
        break;
      case "minute":
        minute = part.value;
        break;
      case "second":
        second = part.value;
        break;
    }
  }
  return {
    date: `${year}-${month}-${day}`,
    // `h23` should give 00 at midnight; some ICU builds still emit 24, which
    // would put midnight on the next day. Normalise defensively.
    hour: Number(hour) % 24,
    minute: Number(minute),
    second: Number(second),
  };
}

/**
 * The local date (`YYYY-MM-DD`) of an instant in `timeZone`. Upstream `dayOf`.
 */
export function localDateKey(time: number, timeZone: string): string {
  return localStamp(time, timeZone).date;
}

/**
 * Milliseconds since local midnight of `day`, or `-1` when `time` is not on
 * that local date. This is the millisecond-precision form of upstream
 * `secondOfDay`; keeping it in milliseconds lets bucket boundaries land
 * exactly where a caller asked, even for sub-second samples.
 */
export function millisecondOfDay(time: number, day: string, timeZone: string): number {
  const stamp = localStamp(time, timeZone);
  if (stamp.date !== day) return -1;
  // `Intl` reports whole seconds; carry the instant's own millisecond part.
  const millis = ((time % MILLIS_PER_SECOND) + MILLIS_PER_SECOND) % MILLIS_PER_SECOND;
  return ((stamp.hour * 60 + stamp.minute) * 60 + stamp.second) * MILLIS_PER_SECOND + millis;
}

/**
 * Seconds since local midnight of `day`, or `-1` when `time` is not on that
 * local date. Upstream `secondOfDay`.
 */
export function secondOfDay(time: number, day: string, timeZone: string): number {
  const millis = millisecondOfDay(time, day, timeZone);
  return millis < 0 ? -1 : Math.floor(millis / MILLIS_PER_SECOND);
}

/**
 * The average per `bucketMillis` long bucket of the local time of day
 * starting at `dayStart`, `NaN` for buckets without samples. Upstream
 * `bucketAverages` (which took seconds).
 *
 * Buckets are wall-clock slices of the local day, not elapsed slices from
 * `dayStart`: on a spring-forward day the skipped bucket is `NaN`, and on a
 * fall-back day both occurrences of the repeated hour share one bucket.
 */
export function bucketAverages(
  samples: readonly TimedValue[],
  dayStart: number,
  bucketMillis: number,
  buckets: number,
  timeZone: string,
): Float64Array {
  if (!Number.isInteger(buckets) || buckets < 0) {
    throw new RangeError("buckets must be a non-negative integer");
  }
  if (!(bucketMillis > 0)) throw new RangeError("bucketMillis must be positive");

  const day = localDateKey(dayStart, timeZone);
  const sums = new Float64Array(buckets);
  const counts = new Uint32Array(buckets);
  for (const sample of samples) {
    const millis = millisecondOfDay(sample.time, day, timeZone);
    if (millis < 0) continue;
    const bucket = Math.floor(millis / bucketMillis);
    if (bucket < buckets) {
      sums[bucket]! += sample.value;
      counts[bucket]! += 1;
    }
  }

  const result = new Float64Array(buckets);
  for (let index = 0; index < buckets; index += 1) {
    result[index] = counts[index]! > 0 ? sums[index]! / counts[index]! : Number.NaN;
  }
  return result;
}

/**
 * The average per hour of the local day starting at `dayStart`, `NaN` for
 * hours without samples. Upstream `hourlyAverages`.
 */
export function hourlyAverages(
  samples: readonly TimedValue[],
  dayStart: number,
  timeZone: string,
  hours: number = HOURS_PER_DAY,
): Float64Array {
  return bucketAverages(samples, dayStart, MILLIS_PER_HOUR, hours, timeZone);
}

/**
 * Minutes per local hour of the day starting at `dayStart` covered by
 * `intervals` (`[from, to)`, epoch milliseconds). Upstream `minutesPerHour`.
 *
 * An interval is split at local hour boundaries, so a fall-back hour can
 * receive 120 minutes and a spring-forward hour zero. Intervals are clamped
 * to the local day; `dayStart` is expected to be local midnight.
 */
export function minutesPerHour(
  intervals: readonly (readonly [number, number])[],
  dayStart: number,
  timeZone: string,
  hours: number = HOURS_PER_DAY,
): Float64Array {
  if (!Number.isInteger(hours) || hours < 0) {
    throw new RangeError("hours must be a non-negative integer");
  }

  const day = localDateKey(dayStart, timeZone);
  const minutes = new Float64Array(hours);
  for (const [from, to] of intervals) {
    let start = Math.max(from, dayStart);
    const end = to;
    while (start < end) {
      const millis = millisecondOfDay(start, day, timeZone);
      // Reaching the next local midnight ends the day, however long it was.
      if (millis < 0) break;
      const hour = Math.floor(millis / MILLIS_PER_HOUR);
      const hourEnd = Math.min(end, start + MILLIS_PER_HOUR - (millis % MILLIS_PER_HOUR));
      if (hour < hours) minutes[hour]! += (hourEnd - start) / MILLIS_PER_MINUTE;
      start = hourEnd;
    }
  }
  return minutes;
}

/**
 * Joins `samples` of `{ time, lane }`, each `sampleMillis` long, into
 * stretches of one lane. Samples further than `maxGapMillis` apart start a
 * new stretch. Upstream `laneStretches` (generic over the lane value).
 *
 * The gap is measured from the end of the open stretch, so contiguous
 * samples always merge and a gap of exactly `maxGapMillis` still merges
 * (`<=`, as upstream).
 */
export function laneStretches(
  samples: readonly LaneSample[],
  sampleMillis: number,
  maxGapMillis: number,
): LaneStretch[] {
  const ordered = [...samples].sort((left, right) => left.time - right.time);
  const stretches: LaneStretch[] = [];
  let current: LaneStretch | null = null;

  for (const sample of ordered) {
    if (
      current !== null &&
      current.lane === sample.lane &&
      sample.time - current.end <= maxGapMillis
    ) {
      current.end = sample.time + sampleMillis;
      continue;
    }
    if (current !== null) stretches.push(current);
    current = { start: sample.time, end: sample.time + sampleMillis, lane: sample.lane };
  }

  if (current !== null) stretches.push(current);
  return stretches;
}

function dayNumber(day: string): number {
  if (!ISO_DATE.test(day)) {
    throw new RangeError(`Expected a YYYY-MM-DD local date, got "${day}"`);
  }
  const [year, month, date] = day.split("-").map(Number);
  return Math.floor(Date.UTC(year!, month! - 1, date!) / MILLIS_PER_DAY);
}

/**
 * The latest value of each of `buckets` spans of `daysPerBucket` local days
 * ending on `lastDay`, oldest first, `NaN` for spans without samples.
 * Upstream `latestPerBucket` (private there; exported here so callers can use
 * spans other than one day or one week).
 */
export function latestPerBucket(
  samples: readonly TimedValue[],
  lastDay: string,
  buckets: number,
  daysPerBucket: number,
  timeZone: string,
): Float64Array {
  if (!Number.isInteger(buckets) || buckets < 0) {
    throw new RangeError("buckets must be a non-negative integer");
  }
  if (!Number.isInteger(daysPerBucket) || daysPerBucket < 1) {
    throw new RangeError("daysPerBucket must be a positive integer");
  }

  const values = new Float64Array(buckets).fill(Number.NaN);
  const times = new Float64Array(buckets).fill(Number.NEGATIVE_INFINITY);
  const last = dayNumber(lastDay);

  for (const sample of samples) {
    const daysBack = last - dayNumber(localDateKey(sample.time, timeZone));
    if (daysBack < 0) continue;
    const bucket = buckets - 1 - Math.floor(daysBack / daysPerBucket);
    if (bucket < 0) continue;
    if (sample.time >= times[bucket]!) {
      times[bucket] = sample.time;
      values[bucket] = sample.value;
    }
  }
  return values;
}

/**
 * The latest value of each of the `days` local days ending on `lastDay`,
 * oldest first, `NaN` for days without samples. Upstream `dailyLatest`.
 */
export function dailyLatest(
  samples: readonly TimedValue[],
  lastDay: string,
  days: number,
  timeZone: string,
): Float64Array {
  return latestPerBucket(samples, lastDay, days, 1, timeZone);
}

/**
 * The latest value of each of the `weeks` seven-day spans ending on
 * `lastDay`, oldest first, `NaN` for weeks without samples. Upstream
 * `weeklyLatest`.
 */
export function weeklyLatest(
  samples: readonly TimedValue[],
  lastDay: string,
  weeks: number,
  timeZone: string,
): Float64Array {
  return latestPerBucket(samples, lastDay, weeks, DAYS_PER_WEEK, timeZone);
}

/**
 * The number of hours of the local day starting at `dayStart` that have
 * begun by `now`, at most `hours`. Upstream `hoursStarted`.
 *
 * Midnight counts as one started hour (the first hour has begun). A `now`
 * on a later day returns `hours`; a `now` before `dayStart` returns 0. This
 * is wall-clock progress, so a fall-back day can report the repeated hour
 * twice and a spring-forward day skips the missing one.
 */
export function hoursStarted(
  dayStart: number,
  now: number,
  timeZone: string,
  hours: number = HOURS_PER_DAY,
): number {
  const second = secondOfDay(now, localDateKey(dayStart, timeZone), timeZone);
  if (second >= 0) return Math.min(Math.floor(second / SECONDS_PER_HOUR) + 1, hours);
  return now < dayStart ? 0 : hours;
}
