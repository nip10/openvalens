import { listDailyActivityTotalsBetween } from "@openvalens/activity";
import { listCanonicalDailyWeightsBetween } from "@openvalens/body";
import type { Database } from "@openvalens/db";
import { createNutritionTotals } from "@openvalens/nutrition";
import { getSleepSummaryForRange } from "@openvalens/sleep";
import { z } from "zod";

/**
 * timeline#6 — one line of figures per day for the timeline's day headers:
 * sleep, steps, meals logged and weight. Each comes from the same server-side
 * daily figure the dashboard and the module screens show, so a day reads the
 * same everywhere and readings from several devices are never added twice:
 *
 * - sleep: the night's asleep minutes from the sleep daily summary (wake date);
 * - steps: the activity daily total (UTC calendar day, as `activity.dailyTotals`);
 * - meals: meals in the member's own diary with at least one entry (local date);
 * - weight: the canonical daily weight, one per day (local date).
 *
 * A part is null when the module is off for the member, they may not read it,
 * or the day has no figure. Plain arithmetic only: no scores, no inferences.
 * Nothing here logs a value.
 */

/** Longest range one call may cover. */
export const DAY_TOTALS_MAX_DAYS = 62;

const DAY_MS = 86_400_000;
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const dayTotalsInputSchema = z
  .strictObject({ from: localDate, to: localDate })
  .superRefine((input, ctx) => {
    const span = (Date.parse(input.to) - Date.parse(input.from)) / DAY_MS + 1;
    if (!Number.isFinite(span) || span < 1 || span > DAY_TOTALS_MAX_DAYS)
      ctx.addIssue({
        code: "custom",
        message: `The range must cover 1 to ${DAY_TOTALS_MAX_DAYS} days.`,
      });
  });

export const dayTotalsSchema = z.object({
  date: z.string(),
  asleepMinutes: z.number().nullable(),
  steps: z.number().nullable(),
  meals: z.number().int().nullable(),
  weightKg: z.number().nullable(),
});
export type DayTotals = z.infer<typeof dayTotalsSchema>;

export type DayTotalsParts = {
  sleep: boolean;
  steps: boolean;
  meals: boolean;
  weight: boolean;
};

/** Every date from `from` to `to`, newest first (the timeline's order). */
function datesBetween(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const count = Math.round((Date.parse(`${to}T00:00:00.000Z`) - start) / DAY_MS) + 1;
  return Array.from({ length: count }, (_, index) =>
    new Date(start + (count - 1 - index) * DAY_MS).toISOString().slice(0, 10),
  );
}

export async function listDayTotals(
  db: Database,
  scope: { organizationId: string; userId: string },
  range: { from: string; to: string },
  parts: DayTotalsParts,
): Promise<DayTotals[]> {
  const [sleep, activity, meals, weights] = await Promise.all([
    parts.sleep
      ? getSleepSummaryForRange(db, scope.organizationId, scope.userId, range.from, range.to)
      : null,
    parts.steps
      ? listDailyActivityTotalsBetween(db, scope.organizationId, range.from, range.to)
      : null,
    parts.meals ? createNutritionTotals(db).countMealsByDay(scope, range) : null,
    parts.weight ? listCanonicalDailyWeightsBetween(db, scope, range.from, range.to) : null,
  ]);
  const sleepBy = new Map(sleep?.days.map((day) => [day.date, day.asleepMinutes]) ?? []);
  const stepsBy = new Map(activity?.map((day) => [day.date, day.steps]) ?? []);
  const mealsBy = new Map(meals?.map((day) => [day.localDate, day.meals]) ?? []);
  // One canonical row per day; the last one wins if a day were ever repeated.
  const weightBy = new Map(weights?.map((day) => [day.date, day.weightKg]) ?? []);
  return datesBetween(range.from, range.to).map((date) => ({
    date,
    asleepMinutes: sleepBy.get(date) || null,
    steps: stepsBy.get(date) ?? null,
    meals: mealsBy.get(date) || null,
    weightKg: weightBy.get(date) ?? null,
  }));
}
