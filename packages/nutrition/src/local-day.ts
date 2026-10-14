import { NutritionError } from "./errors";

/**
 * Local-day rules (Issue #74). A diary day is the member's own calendar date
 * (`YYYY-MM-DD`) in the IANA time zone they logged from. It is fixed when the
 * meal is created and never recomputed from UTC, so travel or a later time
 * zone change does not move history between days.
 */

export const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack", "other"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in `YYYY-MM-DD` form. */
export function isLocalDate(value: string): boolean {
  const match = LOCAL_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** True for a time zone the runtime's Intl database recognizes (e.g. `Europe/Lisbon`). */
export function isValidTimeZone(value: string): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date `instant` falls on in `timeZone`. */
export function localDateFor(instant: Date, timeZone: string): string {
  if (!isValidTimeZone(timeZone)) throw new NutritionError("INVALID_INPUT", "Unknown time zone");
  if (Number.isNaN(instant.getTime())) throw new NutritionError("INVALID_INPUT", "Invalid instant");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Validates a local day + time zone + slot triple; throws `INVALID_INPUT`. */
export function assertLocalDay(input: { localDate: string; timeZone: string; slot: string }) {
  if (!isLocalDate(input.localDate))
    throw new NutritionError("INVALID_INPUT", "Local date must be a YYYY-MM-DD calendar date");
  if (!isValidTimeZone(input.timeZone))
    throw new NutritionError("INVALID_INPUT", "Unknown time zone");
  if (!(MEAL_SLOTS as readonly string[]).includes(input.slot))
    throw new NutritionError("INVALID_INPUT", "Unsupported meal slot");
}
