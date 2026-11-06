/**
 * Weekly check-in scheduling (#397). Pure and client-safe.
 *
 * The check-in is collaborative (D2 in #390): on the member's chosen day it
 * works out a proposal from the experimental estimate and their goal, and
 * nothing changes until they accept. It is adherence-neutral: how close last
 * week's intake was to the target never enters the proposal. A check-in can
 * be opened up to {@link CHECK_IN_EARLY_DAYS} days early.
 *
 * Days are ISO weekdays: 1 = Monday … 7 = Sunday.
 */

export const CHECK_IN_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type CheckInDay = (typeof CHECK_IN_DAYS)[number];

/** A check-in may be opened this many days before its day. */
export const CHECK_IN_EARLY_DAYS = 2;

export type CheckInState =
  /** Manual mode: no weekly check-in. */
  | { state: "off" }
  /** This week's check-in is open (on or after its day, not done yet). */
  | { state: "due"; checkInDate: string }
  /** The next check-in can be opened early. */
  | { state: "early"; checkInDate: string; daysUntil: number }
  /** Done for this week; the next one is on `checkInDate`. */
  | { state: "upcoming"; checkInDate: string; daysUntil: number };

function parse(localDate: string): number {
  const [year, month, day] = localDate.split("-").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

function format(utc: number): string {
  return new Date(utc).toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;

/** ISO weekday (1 = Monday … 7 = Sunday) of a local date. */
export function isoWeekday(localDate: string): CheckInDay {
  const day = new Date(parse(localDate)).getUTCDay();
  return (day === 0 ? 7 : day) as CheckInDay;
}

/** The most recent date on or before `today` that falls on `checkInDay`. */
export function lastCheckInDate(today: string, checkInDay: CheckInDay): string {
  const back = (isoWeekday(today) - checkInDay + 7) % 7;
  return format(parse(today) - back * DAY_MS);
}

/**
 * Where the member's weekly check-in stands on `today`. `lastCheckInOn` is
 * the local date of their last finished check-in (accepted or kept).
 */
export function checkInState(input: {
  checkInDay: CheckInDay | null;
  today: string;
  lastCheckInOn: string | null;
}): CheckInState {
  if (input.checkInDay === null) return { state: "off" };
  const current = lastCheckInDate(input.today, input.checkInDay);
  const next = format(parse(current) + 7 * DAY_MS);
  const daysUntil = Math.round((parse(next) - parse(input.today)) / DAY_MS);
  // Finished within the 5 days before this week's day or since: done. This
  // covers an early check-in and a check-in day moved later in the week.
  const doneThisWeek =
    input.lastCheckInOn !== null &&
    parse(input.lastCheckInOn) >= parse(current) - (7 - CHECK_IN_EARLY_DAYS) * DAY_MS;
  if (!doneThisWeek) return { state: "due", checkInDate: current };
  // An early check-in counts for the coming day.
  const doneEarlyForNext =
    input.lastCheckInOn !== null &&
    parse(input.lastCheckInOn) >= parse(next) - CHECK_IN_EARLY_DAYS * DAY_MS;
  if (!doneEarlyForNext && daysUntil <= CHECK_IN_EARLY_DAYS)
    return { state: "early", checkInDate: next, daysUntil };
  return {
    state: "upcoming",
    checkInDate: doneEarlyForNext ? format(parse(next) + 7 * DAY_MS) : next,
    daysUntil: doneEarlyForNext ? daysUntil + 7 : daysUntil,
  };
}

/** Of the last 7 days of an estimate window, how many had usable intake (for the check-in note). */
export function loggedDaysOfLastWeek(days: readonly { use: string }[]): {
  logged: number;
  of: number;
} {
  const last = days.slice(-7);
  return { logged: last.filter((day) => day.use === "used").length, of: last.length };
}
