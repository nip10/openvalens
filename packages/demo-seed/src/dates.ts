/**
 * Calendar helpers for the demo seed (Issue #301). Every demo date is an
 * offset from one fixed "today" (UTC), never from the real clock.
 */

/** How many days of history the demo person has, ending on "today". */
export const DEMO_DAYS = 90;

export type DemoCalendar = {
  today: string;
  /** `YYYY-MM-DD` for `today - offset` days. */
  day(offset: number): string;
  /** A UTC instant on `today - offset` at `hour` (fractional hours allowed). */
  at(offset: number, hour: number): Date;
  /** Offsets from the oldest day (`DEMO_DAYS - 1`) down to today (0). */
  offsets(): number[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function createCalendar(today: string): DemoCalendar {
  const base = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(base)) throw new Error("Invalid demo day.");
  return {
    today,
    day: (offset) => new Date(base - offset * DAY_MS).toISOString().slice(0, 10),
    at: (offset, hour) => new Date(base - offset * DAY_MS + Math.round(hour * 3_600_000)),
    offsets: () => Array.from({ length: DEMO_DAYS }, (_, i) => DEMO_DAYS - 1 - i),
  };
}
