/**
 * Which daily reminders are due on a member's local date (pure, no I/O).
 *
 * Supplement schedules and medications carry only a free-text `frequency`
 * from the app's closed list (`daily`, `training_days`, `weekly`) or none.
 * They have no start date or weekday, so only an every-day cadence can be
 * placed on a calendar: `daily`, or no frequency at all (the item is simply
 * "taken"), is due every day while the item is `active`. `training_days` and
 * `weekly` say nothing about *which* day, so they never produce a reminder
 * rather than produce one on the wrong day.
 *
 * Scheduled events (`scheduled_event`) do carry a recurrence: a start date,
 * an optional end date, a frequency (`once`, `daily`, `weekly`, `biweekly`,
 * `monthly`) and an `interval` (every N periods). An event is due on dates
 * inside `[start_date, end_date]` that fall on the recurrence.
 */

/** `YYYY-MM-DD` calendar date. */
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The calendar date at {@link now} in {@link timeZone}; an unknown or empty
 * zone falls back to UTC, the same default the insight delivery settings use.
 */
export function localDateIn(now: Date, timeZone: string | null | undefined): string {
  const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function parseDate(value: string): { year: number; month: number; day: number } | null {
  const match = DATE_PATTERN.exec(value.trim().slice(0, 10));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day)
    return null;
  return { year, month, day };
}

function dayNumber(date: { year: number; month: number; day: number }): number {
  return Date.UTC(date.year, date.month - 1, date.day) / DAY_MS;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `daily`, or no frequency at all. Case, spaces and `_`/`-` are ignored. */
function isEveryDay(frequency: string | null | undefined): boolean {
  if (frequency === null || frequency === undefined) return true;
  const normalized = frequency.trim().toLowerCase();
  return normalized === "" || normalized === "daily";
}

/** Supplement schedule or medication: active and taken every day. */
export function isDailyItemDue(item: { status: string; frequency: string | null }): boolean {
  return item.status.trim().toLowerCase() === "active" && isEveryDay(item.frequency);
}

export type ScheduledEventRecurrence = {
  startDate: string;
  endDate: string | null;
  frequency: string;
  interval: number | null;
};

/** Whether a scheduled event recurs on {@link date} (`YYYY-MM-DD`). */
export function isScheduledEventDue(event: ScheduledEventRecurrence, date: string): boolean {
  const target = parseDate(date);
  const start = parseDate(event.startDate);
  if (!target || !start) return false;
  const targetDay = dayNumber(target);
  const startDay = dayNumber(start);
  if (targetDay < startDay) return false;
  if (event.endDate) {
    const end = parseDate(event.endDate);
    if (!end || targetDay > dayNumber(end)) return false;
  }

  const every = event.interval && event.interval > 0 ? Math.floor(event.interval) : 1;
  const elapsed = targetDay - startDay;
  switch (event.frequency.trim().toLowerCase()) {
    case "once":
      return elapsed === 0;
    case "daily":
      return elapsed % every === 0;
    case "weekly":
      return elapsed % (7 * every) === 0;
    case "biweekly":
      return elapsed % (14 * every) === 0;
    case "monthly": {
      const months = (target.year - start.year) * 12 + (target.month - start.month);
      if (months % every !== 0) return false;
      // A start on the 31st recurs on the last day of shorter months.
      return target.day === Math.min(start.day, daysInMonth(target.year, target.month));
    }
    default:
      return false;
  }
}
