import type { Database } from "@openvalens/db";
import { nutritionMeal, nutritionMealEntry } from "@openvalens/db/schema/nutrition";
import { and, eq, isNull, lte, min } from "drizzle-orm";

import { NutritionError } from "./errors";
import { isLocalDate, localDateFor } from "./local-day";
import type { NutritionScope } from "./repository";

/**
 * Logging streak (Issue #90): consecutive local days with at least one diary
 * entry, with freezes and a one-off repair. It is an engagement aid, never a
 * health measure, and every surface stays hidden under the #80 safeguards.
 *
 * The streak is derived from the diary on every read; nothing about it is
 * stored. A day counts when its earliest active entry was created by the end
 * of the next local day (in the time zone that entry was logged from), so a
 * backfill for yesterday counts until the end of today and not after.
 * Freezes, repairs and milestones follow deterministically from that history,
 * so turning streaks off and on again, or deleting an entry, simply recomputes.
 * Entries logged offline count from the moment the server receives them.
 */

export const LOGGING_STREAK_POLICY = Object.freeze({
  startingFreezes: 2,
  maxFreezes: 2,
  /** One freeze is earned per this many counted days. */
  freezeEveryDays: 7,
  /** A missed day can be repaired by logging it within two more local days. */
  repairWindowDays: 2,
  /** At most one repair per this many days. */
  repairCooldownDays: 30,
  milestones: [7, 30, 100, 365] as const,
});

export type LoggedDay = {
  localDate: string;
  /** Earliest creation instant of an active entry dated `localDate`. */
  firstLoggedAt: Date;
  /** The time zone that entry was logged from. */
  timeZone: string;
};

export type LoggingStreak = {
  current: number;
  freezesAvailable: number;
  /** Last local day on which the missed day can still be logged to repair the streak. */
  repairAvailableUntil: string | null;
  daysLoggedThisMonth: number;
  lastLoggedDate: string | null;
  /** Set on the day the streak reaches 7, 30, 100 or 365. */
  milestone: number | null;
};

const DAY_MS = 86_400_000;

function toUtc(localDate: string): number {
  return Date.UTC(
    Number(localDate.slice(0, 4)),
    Number(localDate.slice(5, 7)) - 1,
    Number(localDate.slice(8, 10)),
  );
}

export function addLocalDays(localDate: string, days: number): string {
  return new Date(toUtc(localDate) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** Pure streak computation over the member's logged days, as of `today`. */
export function computeLoggingStreak(input: { days: LoggedDay[]; today: string }): LoggingStreak {
  const { today } = input;
  if (!isLocalDate(today)) throw new NutritionError("INVALID_INPUT", "Invalid local date");
  const policy = LOGGING_STREAK_POLICY;

  // Earliest creation, as a local date in the logging time zone, per day.
  const createdOn = new Map<string, string>();
  for (const day of input.days) {
    if (!isLocalDate(day.localDate) || day.localDate > today) continue;
    const created = localDateFor(day.firstLoggedAt, day.timeZone);
    const known = createdOn.get(day.localDate);
    if (known === undefined || created < known) createdOn.set(day.localDate, created);
  }

  const logged = [...createdOn.keys()].sort();
  const month = today.slice(0, 7);
  const daysLoggedThisMonth = logged.filter((date) => date.startsWith(month)).length;
  const lastLoggedDate = logged.at(-1) ?? null;

  let current = 0;
  let freezes: number = policy.startingFreezes;
  let counted = 0;
  let lastRepair: string | null = null;
  let repairAvailableUntil: string | null = null;
  const countDay = () => {
    current++;
    counted++;
    if (counted % policy.freezeEveryDays === 0) freezes = Math.min(policy.maxFreezes, freezes + 1);
  };

  const yesterday = addLocalDays(today, -1);
  for (let day = logged[0]; day !== undefined && day <= today; day = addLocalDays(day, 1)) {
    const created = createdOn.get(day);
    const onTime = created !== undefined && created <= addLocalDays(day, 1);
    if (onTime) {
      countDay();
      continue;
    }
    // Today, and yesterday until today ends, can still be logged on time.
    if (day === today || day === yesterday) continue;
    // Nothing to protect: missed days outside a streak cost nothing.
    if (current === 0) continue;
    if (freezes > 0) {
      freezes--;
      continue;
    }
    const repairDeadline = addLocalDays(day, 1 + policy.repairWindowDays);
    const repairAllowed =
      lastRepair === null || daysBetween(lastRepair, day) >= policy.repairCooldownDays;
    if (repairAllowed && created !== undefined && created <= repairDeadline) {
      lastRepair = day;
      countDay();
      continue;
    }
    current = 0;
    repairAvailableUntil = repairAllowed && today <= repairDeadline ? repairDeadline : null;
  }
  // A window only matters while it is still open and nothing broke after it.
  if (repairAvailableUntil !== null && today > repairAvailableUntil) repairAvailableUntil = null;

  return {
    current,
    freezesAvailable: freezes,
    repairAvailableUntil,
    daysLoggedThisMonth,
    lastLoggedDate,
    milestone: (policy.milestones as readonly number[]).includes(current) ? current : null,
  };
}

/** Loads one row per local day and time zone with the earliest active entry. */
export async function loadLoggedDays(
  db: Pick<Database, "select">,
  scope: NutritionScope,
  through: string,
): Promise<LoggedDay[]> {
  const rows = await db
    .select({
      localDate: nutritionMeal.localDate,
      timeZone: nutritionMeal.timeZone,
      firstLoggedAt: min(nutritionMealEntry.createdAt),
    })
    .from(nutritionMealEntry)
    .innerJoin(
      nutritionMeal,
      and(
        eq(nutritionMeal.organizationId, nutritionMealEntry.organizationId),
        eq(nutritionMeal.id, nutritionMealEntry.mealId),
      ),
    )
    .where(
      and(
        eq(nutritionMealEntry.organizationId, scope.organizationId),
        eq(nutritionMealEntry.userId, scope.userId),
        eq(nutritionMeal.userId, scope.userId),
        lte(nutritionMeal.localDate, through),
        isNull(nutritionMealEntry.deletedAt),
      ),
    )
    .groupBy(nutritionMeal.localDate, nutritionMeal.timeZone);
  return rows.flatMap((row) =>
    row.firstLoggedAt
      ? [{ localDate: row.localDate, timeZone: row.timeZone, firstLoggedAt: row.firstLoggedAt }]
      : [],
  );
}
