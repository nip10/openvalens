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
 * Minimal zone-aware local-date helpers for the HRV port.
 *
 * Adapted from `packages/activity/src/history/widget-history.ts`, which is
 * itself a port of Gadgetbridge's `WidgetHistory.secondOfDay` wall-clock
 * approach. The helpers are copied rather than imported because
 * `@openvalens/sleep` does not depend on `@openvalens/activity`; adding that
 * workspace edge for ~150 lines of calendar math would be the larger change.
 *
 * Upstream: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/widgets/WidgetHistory.kt`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/widgets/WidgetHistory.kt
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * Semantics:
 * - `localDateKey` is the wall-clock date of an instant in the requested IANA
 *   zone, as `Instant -> ZonedDateTime -> LocalDate` would give it.
 * - `addLocalDays` steps a date key by calendar days, never by 24 h, so a
 *   DST day stays one calendar day.
 * - `localNoon` converts local 12:00 on a date to an instant. Noon is chosen
 *   deliberately: DST transitions do not occur at noon in the zones this app
 *   supports, so the conversion is unambiguous. The implementation still
 *   handles a hypothetical gap/overlap the way `java.time` does (shift
 *   forward out of a gap, pick the earlier instant in an overlap).
 */

const MILLIS_PER_DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

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

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function localParts(time: number, timeZone: string): LocalParts {
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
    year: Number(year),
    month: Number(month),
    day: Number(day),
    // `h23` should give 00 at midnight; some ICU builds still emit 24.
    hour: Number(hour) % 24,
    minute: Number(minute),
    second: Number(second),
  };
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

function parseDateKey(dateKey: string): [number, number, number] {
  if (!ISO_DATE.test(dateKey)) {
    throw new RangeError(`Expected a YYYY-MM-DD local date, got "${dateKey}"`);
  }
  const [year, month, day] = dateKey.split("-").map(Number);
  return [year!, month!, day!];
}

/** The local date (`YYYY-MM-DD`) of an instant in `timeZone`. */
export function localDateKey(time: number, timeZone: string): string {
  const parts = localParts(time, timeZone);
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
}

/** Steps a `YYYY-MM-DD` key by whole local calendar days. */
export function addLocalDays(dateKey: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError("days must be an integer");
  const [year, month, day] = parseDateKey(dateKey);
  const date = new Date(Date.UTC(year, month - 1, day) + days * MILLIS_PER_DAY);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(
    date.getUTCDate(),
    2,
  )}`;
}

/** The instant as if the wall-clock fields were UTC; used only for offsets. */
function wallClockMs(time: number, timeZone: string): number {
  const parts = localParts(time, timeZone);
  const millis = ((time % 1000) + 1000) % 1000;
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    millis,
  );
}

function offsetAt(time: number, timeZone: string): number {
  return wallClockMs(time, timeZone) - time;
}

/**
 * Converts a wall-clock instant (`Date.UTC` of the local fields) in `timeZone`
 * to the real instant. Iterates the zone offset twice, which is enough for
 * every IANA transition; gaps shift forward, overlaps pick the earlier instant.
 */
function zonedWallTimeToInstant(wallMs: number, timeZone: string): number {
  const first = wallMs - offsetAt(wallMs, timeZone);
  const second = wallMs - offsetAt(first, timeZone);
  if (first === second) return first;

  const candidates = [first, second];
  let exact: number | null = null;
  for (const candidate of candidates) {
    if (wallClockMs(candidate, timeZone) === wallMs) {
      exact = exact === null ? candidate : Math.min(exact, candidate);
    }
  }
  if (exact !== null) return exact;

  // No instant has this wall time: a spring-forward gap. `java.time` shifts
  // forward to the first valid instant, i.e. the closest candidate after it.
  let after: number | null = null;
  for (const candidate of candidates) {
    const wall = wallClockMs(candidate, timeZone);
    if (wall > wallMs && (after === null || wall < wallClockMs(after, timeZone))) {
      after = candidate;
    }
  }
  return after ?? first;
}

/** The instant of local 12:00 on `dateKey` in `timeZone`. */
export function localNoon(dateKey: string, timeZone: string): number {
  const [year, month, day] = parseDateKey(dateKey);
  return zonedWallTimeToInstant(Date.UTC(year, month - 1, day, 12, 0, 0, 0), timeZone);
}
