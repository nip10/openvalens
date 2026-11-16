/**
 * Calendar helpers for the demo seed (Issue #301). Every demo date is an
 * offset from one "today", and every clock time is an hour on one of those
 * days, read on the demo person's wall clock.
 */

/** How many days of history the demo person has, ending on "today". */
export const DEMO_DAYS = 90;

/**
 * The time zone written on records when the caller names none. The default
 * demo keeps its original clock: hours are UTC, which is London's wall clock
 * in winter, and records say `Europe/London`.
 */
export const DEFAULT_DEMO_TIME_ZONE = "Europe/London";

export type CalendarOptions = {
  /**
   * IANA zone the person lives in. Hours are its wall clock (a 07:30
   * reading is 07:30 there), and it is written on every record that carries
   * a zone. Omitted: the default demo's UTC clock and `Europe/London`.
   */
  timeZone?: string;
  /**
   * The moment of seeding. Nothing is dated later: today stops here. Omitted:
   * the end of today, so the default demo never reads the clock.
   */
  now?: Date;
};

export type DemoCalendar = {
  today: string;
  /** IANA zone written on records (see {@link CalendarOptions.timeZone}). */
  timeZone: string;
  /** `YYYY-MM-DD` for `today - offset` days. */
  day(offset: number): string;
  /**
   * The instant of `hour` on the wall clock of `today - offset` (fractional
   * hours allowed; below 0 is the evening before, 24 and up the day after).
   * A wall time skipped by a daylight-saving change moves forward.
   */
  at(offset: number, hour: number): Date;
  /** Offsets from the oldest day (`DEMO_DAYS - 1`) down to today (0). */
  offsets(): number[];
  /** The newest instant the seed writes: `now`, or the end of today. */
  until: Date;
  /** Whether `instant` is not later than {@link until}. */
  past(instant: Date): boolean;
  /** `instant`, or {@link until} when that is earlier. */
  clamp(instant: Date): Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    // Throws a RangeError for an unknown zone.
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The zone's offset from UTC at `instant`, in milliseconds (whole seconds). */
function offsetAt(timeZone: string, instant: number): number {
  const seconds = Math.floor(instant / 1000) * 1000;
  const parts = formatterFor(timeZone).formatToParts(new Date(seconds));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wall - seconds;
}

/**
 * The instant whose wall clock in `timeZone` reads `wall` (a wall time
 * encoded as if it were UTC). An ambiguous time (the repeated hour in
 * autumn) is the earlier one; a skipped time (spring) moves forward by the
 * gap, as `Temporal`'s "compatible" choice does.
 */
function zonedInstant(timeZone: string, wall: number): number {
  const before = offsetAt(timeZone, wall - DAY_MS);
  const after = offsetAt(timeZone, wall + DAY_MS);
  const valid = [...new Set([before, after])]
    .map((offset) => wall - offset)
    .filter((instant) => wall - offsetAt(timeZone, instant) === instant)
    .sort((a, b) => a - b);
  return valid[0] ?? wall - before;
}

export function isTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function createCalendar(today: string, options: CalendarOptions = {}): DemoCalendar {
  const base = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(base)) throw new Error("Invalid demo day.");
  const { timeZone } = options;
  if (timeZone !== undefined && !isTimeZone(timeZone)) throw new Error("Invalid time zone.");
  const at = (offset: number, hour: number) => {
    const wall = base - offset * DAY_MS + Math.round(hour * HOUR_MS);
    return new Date(timeZone === undefined ? wall : zonedInstant(timeZone, wall));
  };
  const endOfToday = at(-1, 0);
  const until =
    options.now && options.now.getTime() < endOfToday.getTime() ? options.now : endOfToday;
  return {
    today,
    timeZone: timeZone ?? DEFAULT_DEMO_TIME_ZONE,
    day: (offset) => new Date(base - offset * DAY_MS).toISOString().slice(0, 10),
    at,
    offsets: () => Array.from({ length: DEMO_DAYS }, (_, i) => DEMO_DAYS - 1 - i),
    until,
    past: (instant) => instant.getTime() <= until.getTime(),
    clamp: (instant) => (instant.getTime() <= until.getTime() ? instant : until),
  };
}
