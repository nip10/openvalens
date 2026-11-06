import { shiftLocalDate } from "@openvalens/api/presenters/nutrition-diary";

/**
 * The diary's week strip (#394): Monday to Sunday around a local date, and
 * the mark each day carries. Pure, so it is unit tested without React Native.
 */

/** The seven local dates (Monday first) of the week that holds `localDate`. */
export function weekOf(localDate: string): string[] {
  const [year, month, day] = localDate.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const monday = shiftLocalDate(localDate, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => shiftLocalDate(monday, index));
}

/** A day's mark: marked complete, something logged, or nothing logged. Never a verdict. */
export type DayMark = "complete" | "logged" | "none";

export function dayMark(day: { status: string; entryCount: number } | undefined): DayMark {
  if (!day) return "none";
  if (day.status === "complete") return "complete";
  return day.entryCount > 0 ? "logged" : "none";
}

/** Weekday and day of the month for a local date, in `locale`. */
export function dayParts(localDate: string, locale: string): { weekday: string; day: string } {
  const [year, month, day] = localDate.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  let weekday: string;
  try {
    weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(date);
  } catch {
    weekday = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(date);
  }
  return { weekday: weekday.replace(/\.$/, ""), day: String(day) };
}
