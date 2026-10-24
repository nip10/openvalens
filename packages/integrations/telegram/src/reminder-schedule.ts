/**
 * Which daily reminders are due on a member's local date, and from which
 * local hour they may go out (pure, no I/O).
 *
 * Supplement schedules and medications carry a `frequency` from the app's
 * closed list (`daily`, `training_days`, `weekly`; the web and native forms
 * offer only these, for medications too) or none, plus `days_of_week` (ISO
 * weekdays, 1 = Monday … 7 = Sunday):
 *
 * - `daily`, or no frequency at all (the item is simply "taken"), is due every
 *   day while the item is `active`;
 * - `weekly` and `training_days` are due on the chosen weekdays only. With no
 *   day chosen they never produce a reminder, rather than one on the wrong
 *   day. Training days are chosen like weekly days because the app has no
 *   per-member training calendar: `workout` rows are logged sessions (after
 *   the fact) and carry no member, and scheduled events have no workout type;
 * - any other (free-text) frequency is not guessed at: no reminder.
 *
 * Delivery time: each member's reminders for their local date may go out
 * from their reminder hour (`insight_preference.daily_reminder_hour`, default
 * 8) in their notification time zone. "Reached" is `local hour >= reminder
 * hour`, so a run that was missed catches up later the same local day, a
 * skipped DST hour (02:00 → 03:00) still fires at the next hour, and a
 * repeated DST hour cannot send twice (each day's slot is created once).
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
  return localClockIn(now, timeZone).date;
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

/** Reminder hour used when a member never chose one. */
export const DEFAULT_REMINDER_HOUR = 8;

export type LocalClock = {
  /** `YYYY-MM-DD` in the zone. */
  date: string;
  /** 0–23 in the zone. */
  hour: number;
};

/**
 * The calendar date and hour at {@link now} in {@link timeZone} (UTC for an
 * unknown or empty zone).
 */
export function localClockIn(now: Date, timeZone: string | null | undefined): LocalClock {
  const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "00";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")) % 24,
  };
}

/** A stored reminder hour, or the default when missing or out of range. */
export function reminderHourOrDefault(hour: number | null | undefined): number {
  return typeof hour === "number" && Number.isInteger(hour) && hour >= 0 && hour <= 23
    ? hour
    : DEFAULT_REMINDER_HOUR;
}

/**
 * Whether the member's reminders for {@link date} may go out at
 * {@link clock}: only the member's current local date, and only once their
 * reminder hour has arrived. Older dates are never sent (no burst of
 * days-old reminders after an outage); a date ahead of the clock (the
 * member moved west after it was created) waits for that day.
 */
export function isReminderDeliverable(
  date: string,
  clock: LocalClock,
  reminderHour: number | null | undefined,
): boolean {
  return date === clock.date && clock.hour >= reminderHourOrDefault(reminderHour);
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a `YYYY-MM-DD` date, or `null`. */
export function isoWeekday(date: string): number | null {
  const parsed = parseDate(date);
  if (!parsed) return null;
  const weekday = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function normalizedFrequency(frequency: string | null | undefined): string {
  return (frequency ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "_");
}

export type PlanItem = {
  status: string;
  frequency: string | null;
  daysOfWeek?: ReadonlyArray<number> | null;
};

/**
 * Supplement schedule or medication: active, and due on {@link date} by its
 * frequency — every day for `daily` / none, on the chosen weekdays for
 * `weekly` / `training_days`, never for anything else.
 */
export function isPlanItemDue(item: PlanItem, date: string): boolean {
  if (item.status.trim().toLowerCase() !== "active") return false;
  const frequency = normalizedFrequency(item.frequency);
  if (frequency === "" || frequency === "daily") return true;
  if (frequency !== "weekly" && frequency !== "training_days") return false;
  const weekday = isoWeekday(date);
  return weekday !== null && (item.daysOfWeek ?? []).includes(weekday);
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
