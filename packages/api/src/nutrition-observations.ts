import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { serverI18n } from "@openvalens/i18n/server";

/**
 * Pure, opt-in descriptions of meal-time co-occurrence. The seven-day minimum,
 * three matching events and four-hour proximity are engineering choices for
 * suppressing sparse observations, not validated thresholds or health claims.
 * These rules describe records only and do not test causes.
 */

export const NUTRITION_OBSERVATION_POLICY = {
  version: "nutrition-observation/v1",
  minimumWindowDays: 7,
  minimumMatchingEvents: 3,
  mealProximityMinutes: 240,
} as const;

export type ObservationWindow = { from: string; to: string };
export type MemberMealRecord = { memberId: string; consumedAt: string | null; complete: boolean };
export type MemberSleepRecord = { memberId: string; startedAt: string | null; complete: boolean };
export type MemberWorkoutRecord = { memberId: string; startedAt: string | null; complete: boolean };

export type NutritionObservationInput = {
  memberId: string;
  window: ObservationWindow;
  optedIn: boolean;
  permissions: { nutrition: boolean; sleep: boolean; activity: boolean };
  hideNumbers: boolean;
  meals: readonly MemberMealRecord[];
  sleep: readonly MemberSleepRecord[];
  workouts: readonly MemberWorkoutRecord[];
  /** The requesting member's language for the observation text (#231); English by default. */
  i18n?: I18n;
};

export type NutritionObservation = {
  ruleId: "observation.meals_near_sleep" | "observation.meals_and_workouts";
  window: ObservationWindow & { days: number };
  matchingEvents: number | null;
  minimumMatchingEvents: number | null;
  completeness: string;
  title: string;
  body: string;
};

function parseDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

function parseInstant(value: string | null): number | null {
  if (value === null) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)
    ? time
    : null;
}

function inWindow(time: number, from: number, to: number): boolean {
  return time >= from && time < to + 86_400_000;
}

function countMatches(
  events: readonly { memberId: string; startedAt: string | null; complete: boolean }[],
  meals: readonly MemberMealRecord[],
  memberId: string,
  from: number,
  to: number,
  mealBeforeOnly: boolean,
): number {
  let matches = 0;
  for (const event of events) {
    if (event.memberId !== memberId || !event.complete) continue;
    const eventAt = parseInstant(event.startedAt);
    if (eventAt === null || !inWindow(eventAt, from, to)) continue;
    const matched = meals.some((meal) => {
      if (meal.memberId !== memberId || !meal.complete) return false;
      const mealAt = parseInstant(meal.consumedAt);
      if (mealAt === null || !inWindow(mealAt, from, to)) return false;
      const gap = eventAt - mealAt;
      return mealBeforeOnly
        ? gap >= 0 && gap <= NUTRITION_OBSERVATION_POLICY.mealProximityMinutes * 60_000
        : Math.abs(gap) <= NUTRITION_OBSERVATION_POLICY.mealProximityMinutes * 60_000;
    });
    if (matched) matches += 1;
  }
  return matches;
}

/** Returns no observation unless all gates and minimum-data rules pass. */
export function buildNutritionObservations(
  input: NutritionObservationInput,
): NutritionObservation[] {
  const i18n = input.i18n ?? serverI18n("en");
  if (!input.optedIn || !input.permissions.nutrition) return [];
  const from = parseDate(input.window.from);
  const to = parseDate(input.window.to);
  if (from === null || to === null || to < from) return [];
  const days = Math.round((to - from) / 86_400_000) + 1;
  if (days < NUTRITION_OBSERVATION_POLICY.minimumWindowDays) return [];
  const window = { ...input.window, days };
  const output: NutritionObservation[] = [];
  const tryAdd = (options: {
    permission: boolean;
    records: readonly { memberId: string; startedAt: string | null; complete: boolean }[];
    ruleId: NutritionObservation["ruleId"];
    title: MessageDescriptor;
    body: MessageDescriptor;
    mealBeforeOnly: boolean;
  }) => {
    if (!options.permission) return;
    const count = countMatches(
      options.records,
      input.meals,
      input.memberId,
      from,
      to,
      options.mealBeforeOnly,
    );
    if (count < NUTRITION_OBSERVATION_POLICY.minimumMatchingEvents) return;
    output.push({
      ruleId: options.ruleId,
      window,
      matchingEvents: input.hideNumbers ? null : count,
      minimumMatchingEvents: input.hideNumbers
        ? null
        : NUTRITION_OBSERVATION_POLICY.minimumMatchingEvents,
      completeness: input.hideNumbers
        ? i18n._(
            msg`Sufficient matching timestamped records from completed diary days were available.`,
          )
        : i18n._(
            msg`${plural(count, { one: "# matching timestamped record", other: "# matching timestamped records" })} from completed diary days in the ${days}-day window.`,
          ),
      title: i18n._(options.title),
      body: i18n._(options.body),
    });
  };

  tryAdd({
    permission: input.permissions.sleep,
    records: input.sleep,
    ruleId: "observation.meals_near_sleep",
    title: msg`Meals and recorded sleep timing`,
    body: msg({
      message:
        "Some logged meals occurred within four hours before recorded sleep starts in this window. This describes timing in your records only and does not establish a relationship between meal timing and sleep.",
      comment: "safety",
    }),
    mealBeforeOnly: true,
  });
  tryAdd({
    permission: input.permissions.activity,
    records: input.workouts,
    ruleId: "observation.meals_and_workouts",
    title: msg`Meals and recorded workouts`,
    body: msg({
      message:
        "Some logged meals occurred within four hours of recorded workouts in this window. This describes timing in your records only and does not establish a relationship between meal timing and workouts.",
      comment: "safety",
    }),
    mealBeforeOnly: false,
  });
  return output;
}
