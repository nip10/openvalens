import {
  deriveGoalProgress,
  deriveGoalTrend,
  isGoalPriority,
  orderCheckinsByDate,
  parseGoalNumeric,
  type Goal,
  type GoalCheckin,
} from "@openvalens/plans";

import {
  GOAL_PRIORITY_WEIGHTS,
  GOAL_PROGRESS_ALGORITHM_VERSION,
  type GoalProgressResult,
  type GoalResult,
} from "./score-contract";

/**
 * Issue #95 — goal progress (`goal-progress-0.1.0`). Pure and deterministic.
 *
 * Progress toward the targets a person configured, weighted by the priority
 * they chose (low 1, normal 2, high 3; unset counts as normal). Each goal's
 * own result is returned next to the total, and a goal whose latest check-in
 * moved away from its target is flagged, so a setback cannot hide behind a
 * success elsewhere. Paused, cancelled and unmeasurable goals are excluded
 * from the denominator and reported with their state — never scored as 0.
 * Progress per goal comes from `deriveGoalProgress` in `@openvalens/plans`
 * (capped at 100% once the target is reached).
 */

export type GoalWithHistory = { goal: Goal; checkins: readonly GoalCheckin[] };

function evaluateGoal(entry: GoalWithHistory): Omit<GoalResult, "contribution"> {
  const { goal } = entry;
  const checkins = orderCheckinsByDate([...entry.checkins]);
  const priority = isGoalPriority(goal.priority) ? goal.priority : "normal";
  const prioritySource = isGoalPriority(goal.priority) ? ("set" as const) : ("default" as const);

  // Without a stored baseline, the earliest numeric check-in is the starting
  // point — but only once there is a later one to compare it with.
  const numericCheckins = checkins.filter((checkin) => parseGoalNumeric(checkin.value) !== null);
  const storedBaseline = parseGoalNumeric(goal.baselineValue);
  const baselineValue =
    storedBaseline !== null
      ? goal.baselineValue
      : numericCheckins.length >= 2
        ? numericCheckins[0]!.value
        : null;

  const progress = deriveGoalProgress({ ...goal, baselineValue });
  const trend = deriveGoalTrend(checkins, progress.direction);
  const baselineSource: GoalResult["baselineSource"] = progress.baselineAssumedZero
    ? "assumed_zero"
    : progress.baselineNumeric === null
      ? null
      : storedBaseline !== null
        ? "set"
        : "first_check_in";

  let state: GoalResult["state"];
  if (goal.status === "paused") state = "paused";
  else if (goal.status === "cancelled") state = "not_applicable";
  else if (progress.targetNumeric === null) state = "needs_target";
  else if (progress.currentNumeric === null) state = "needs_current_value";
  else if (progress.direction === null) state = "needs_direction";
  else if (progress.percent === null) state = "needs_baseline";
  else state = "scored";

  return {
    goalId: goal.id,
    title: goal.title,
    category: goal.category,
    goalStatus: goal.status,
    state,
    direction: progress.direction,
    directionSource: progress.directionSource,
    baselineValue: progress.baselineAssumedZero ? 0 : progress.baselineNumeric,
    baselineSource,
    currentValue: progress.currentNumeric,
    targetValue: progress.targetNumeric,
    progress: state === "scored" ? progress.percent : null,
    reachedTarget: progress.hint === "achieved",
    priority,
    prioritySource,
    trend,
    flagged: state !== "paused" && state !== "not_applicable" && trend === "away_from_target",
  };
}

export function computeGoalProgress(entries: readonly GoalWithHistory[]): GoalProgressResult {
  const evaluated = entries.map(evaluateGoal);
  const scored = evaluated.filter((goal) => goal.state === "scored");
  const totalWeight = scored.reduce((sum, goal) => sum + GOAL_PRIORITY_WEIGHTS[goal.priority], 0);

  const goals: GoalResult[] = evaluated.map((goal) => ({
    ...goal,
    contribution:
      goal.state === "scored" && totalWeight > 0
        ? Math.round((GOAL_PRIORITY_WEIGHTS[goal.priority] / totalWeight) * 1000) / 1000
        : null,
  }));

  const score =
    totalWeight > 0
      ? Math.round(
          (scored.reduce(
            (sum, goal) => sum + GOAL_PRIORITY_WEIGHTS[goal.priority] * goal.progress!,
            0,
          ) /
            totalWeight) *
            100,
        )
      : null;

  return {
    kind: "goal_progress",
    algorithmVersion: GOAL_PROGRESS_ALGORITHM_VERSION,
    status: score === null ? "withheld" : "available",
    score,
    withheldReason:
      score !== null ? null : entries.length === 0 ? "no_goals" : "no_measurable_goals",
    goals,
    coverage: {
      scored: scored.length,
      total: goals.length,
      flagged: goals.filter((goal) => goal.flagged).length,
    },
  };
}

export function goalProgressAdultsOnly(): GoalProgressResult {
  return {
    kind: "goal_progress",
    algorithmVersion: GOAL_PROGRESS_ALGORITHM_VERSION,
    status: "withheld",
    score: null,
    withheldReason: "adults_only",
    goals: [],
    coverage: { scored: 0, total: 0, flagged: 0 },
  };
}
