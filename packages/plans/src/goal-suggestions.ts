import type { GoalRule } from "./goal-model";

/**
 * goals#7 (owner decision 2026-11-16): goal ideas from the member's own
 * records of the last four weeks, offered as one-tap chips that open the goal
 * editor prefilled. Each idea is plain arithmetic on the member's data, shown
 * with its basis ("your usual is 7h 12m"):
 *
 * - sleep: the median night, rounded up to the next half hour, as a 7-day
 *   average goal ("Sleep 7.5 h a night");
 * - water: the median day with water logged, rounded up to the next 250 ml,
 *   as a daily goal ("Drink 2,000 ml of water a day");
 * - a supplement taken on at least half of the days: take it every day.
 *
 * Nothing here judges what is good for the member: the figure is their own
 * usual, rounded to a friendly number. Constants are product choices.
 */
export const GOAL_SUGGESTION_RULES = {
  windowDays: 28,
  /** Days with data needed before a usual is offered. */
  minDays: 7,
  sleepStepHours: 0.5,
  waterStepMl: 250,
  /** A supplement counts as a habit on at least this many of the 28 days. */
  supplementMinDays: 14,
  /** Ideas returned at most. */
  limit: 3,
} as const;

export type GoalSuggestion =
  | {
      kind: "sleep";
      source: "sleep";
      metric: "sleep_hours";
      unit: "h";
      /** Hours, a multiple of 0.5. */
      target: number;
      /** Median hours a night. */
      usual: number;
      days: number;
    }
  | {
      kind: "water";
      source: "water";
      metric: "water_ml";
      unit: "ml";
      /** Millilitres, a multiple of 250. */
      target: number;
      /** Median millilitres on days with water logged. */
      usual: number;
      days: number;
    }
  | {
      kind: "supplement";
      source: "supplement";
      metric: string;
      unit: null;
      supplementName: string;
      /** Days in the window with an intake. */
      days: number;
    };

function median(values: readonly number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

const roundUp = (value: number, step: number) => Math.ceil(value / step - 1e-9) * step;
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Sleep: hours per night with a record. Null below `minDays` nights. */
export function sleepSuggestion(nights: readonly number[]): GoalSuggestion | null {
  const values = nights.filter((hours) => Number.isFinite(hours) && hours > 0);
  const usual = median(values);
  if (usual === null || values.length < GOAL_SUGGESTION_RULES.minDays) return null;
  return {
    kind: "sleep",
    source: "sleep",
    metric: "sleep_hours",
    unit: "h",
    target: roundUp(usual, GOAL_SUGGESTION_RULES.sleepStepHours),
    usual: round(usual, 2),
    days: values.length,
  };
}

/** Water: millilitres per day with water logged. Null below `minDays` days. */
export function waterSuggestion(daily: readonly number[]): GoalSuggestion | null {
  const values = daily.filter((ml) => Number.isFinite(ml) && ml > 0);
  const usual = median(values);
  if (usual === null || values.length < GOAL_SUGGESTION_RULES.minDays) return null;
  return {
    kind: "water",
    source: "water",
    metric: "water_ml",
    unit: "ml",
    target: roundUp(usual, GOAL_SUGGESTION_RULES.waterStepMl),
    usual: Math.round(usual),
    days: values.length,
  };
}

/** A supplement taken on `days` of the window, or null when it is not yet a habit. */
export function supplementSuggestion(
  supplementId: number,
  supplementName: string,
  days: number,
): GoalSuggestion | null {
  if (days < GOAL_SUGGESTION_RULES.supplementMinDays || !supplementName.trim()) return null;
  return {
    kind: "supplement",
    source: "supplement",
    metric: `supplement:${supplementId}`,
    unit: null,
    supplementName: supplementName.trim(),
    days,
  };
}

/** The rule a suggestion's goal starts with, the same one the editor builds. */
export function goalSuggestionRule(suggestion: GoalSuggestion): GoalRule {
  if (suggestion.kind === "sleep")
    return {
      kind: "average",
      target: { kind: "minimum", value: suggestion.target },
      windowDays: 7,
    };
  if (suggestion.kind === "water")
    return {
      kind: "recurring",
      cadence: "daily",
      completion: { kind: "minimum", value: suggestion.target },
    };
  return { kind: "recurring", cadence: "daily" };
}

/**
 * Ideas the member does not already have a goal for (same source and
 * metric, any status but deleted), in a fixed order, at most `limit`.
 */
export function freshGoalSuggestions(
  suggestions: readonly GoalSuggestion[],
  goals: readonly { definition: { source: string; metric: string } }[],
): GoalSuggestion[] {
  const taken = new Set(goals.map((goal) => `${goal.definition.source}|${goal.definition.metric}`));
  return suggestions
    .filter((suggestion) => !taken.has(`${suggestion.source}|${suggestion.metric}`))
    .slice(0, GOAL_SUGGESTION_RULES.limit);
}
