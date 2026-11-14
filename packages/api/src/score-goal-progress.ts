import {
  deriveGoalProgress,
  goalRuleAt,
  deriveGoalTrend,
  isGoalPriority,
  orderCheckinsByDate,
  parseGoalNumeric,
  type Goal,
  type GoalCheckin,
  type GoalSummary,
} from "@openvalens/plans";

import {
  GOAL_PRIORITY_WEIGHTS,
  GOAL_PROGRESS_ALGORITHM_VERSION,
  type GoalProgressResult,
  type GoalResult,
} from "./score-contract";

/**
 * Issue #95 — goal progress (`goal-progress-0.3.0`). Pure and deterministic.
 *
 * Progress toward the targets a person configured, weighted by the priority
 * they chose (low 1, normal 2, high 3; unset counts as normal). Each goal's
 * own result is returned next to the total, and a goal whose latest check-in
 * moved away from its target is flagged, so a setback cannot hide behind a
 * success elsewhere. Paused, cancelled and unmeasurable goals are excluded
 * from the denominator and reported with their state — never scored as 0.
 * Progress per goal comes from `deriveGoalProgress` in `@openvalens/plans`
 * (capped at 100% once the target is reached).
 *
 * Personal goals of every source count too: manual, water, supplement,
 * workout, sleep (#500) and custom trackers (#451). Their progress comes from
 * the goal's own evaluation of its days (see {@link personalGoalResult}).
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

/** What a personal goal (#451, #500) needs for goal progress: its definition and evaluation. */
export type PersonalGoalForProgress = Pick<
  GoalSummary,
  "id" | "title" | "definition" | "evaluation"
>;

const RECENT_DAYS = 7;

/**
 * Where a personal goal stands, as a current value against a target, under
 * the rule in force on the evaluation date (edits live in `versions`):
 * - target and rolling-average rules: the latest value (or the complete
 *   window's average) against the threshold, upward for "at least", downward
 *   for "at most", toward the nearer edge for "between";
 * - streaks: the current streak against the streak length;
 * - weekly schedules: the last full week's qualifying days against the days
 *   required; daily and weekday schedules: the qualifying days among the last
 *   seven scheduled days (today counts once it has a record).
 * A goal that reached its target or was marked complete is 100%.
 */
function personalGoalMeasure(goal: PersonalGoalForProgress): {
  current: number | null;
  target: number | null;
  direction: "increase" | "decrease";
} {
  const evaluation = goal.evaluation;
  const rule = goalRuleAt(goal.definition, evaluation.asOf);
  if (rule.kind === "streak")
    return { current: evaluation.currentStreak, target: rule.targetDays, direction: "increase" };
  if (rule.kind === "recurring") {
    if (rule.cadence === "any-days-per-week") {
      const week = evaluation.recurringWeeks.filter((item) => item.eligible).at(-1);
      return week
        ? { current: week.qualifyingDays, target: week.requiredDays, direction: "increase" }
        : { current: null, target: rule.daysPerWeek ?? null, direction: "increase" };
    }
    const recent = evaluation.days
      .filter((day) => day.state !== "paused" && day.state !== "not-scheduled")
      .filter((day) => !(day.date === evaluation.asOf && day.state === "unknown"))
      .slice(-RECENT_DAYS);
    return recent.length
      ? {
          current: recent.filter((day) => day.state === "qualifies").length,
          target: recent.length,
          direction: "increase",
        }
      : { current: null, target: RECENT_DAYS, direction: "increase" };
  }
  const current =
    rule.kind === "average" && evaluation.windowCoverage && !evaluation.windowCoverage.complete
      ? null
      : evaluation.currentValue;
  const comparator = rule.target;
  if (comparator.kind === "minimum")
    return { current, target: comparator.value, direction: "increase" };
  if (comparator.kind === "maximum")
    return { current, target: comparator.value, direction: "decrease" };
  if (current !== null && current > comparator.maximum)
    return { current, target: comparator.maximum, direction: "decrease" };
  return { current, target: comparator.minimum, direction: "increase" };
}

/** One personal goal's goal-progress result (#451, #500). Null for a deleted goal. */
export function personalGoalResult(
  goal: PersonalGoalForProgress,
): Omit<GoalResult, "contribution"> | null {
  const { definition, evaluation } = goal;
  if (definition.status === "deleted" || evaluation.state === "deleted") return null;
  const reached = definition.status === "completed" || evaluation.achieved;
  const paused = !reached && (definition.status === "paused" || evaluation.state === "paused");
  const measure = personalGoalMeasure(goal);
  const progress = deriveGoalProgress({
    currentValue: measure.current === null ? null : String(measure.current),
    targetValue: measure.target === null ? null : String(measure.target),
    status: "in_progress",
    direction: measure.direction,
    baselineValue: null,
  });
  let state: GoalResult["state"];
  if (paused) state = "paused";
  else if (reached) state = "scored";
  else if (progress.targetNumeric === null) state = "needs_target";
  else if (progress.currentNumeric === null) state = "needs_current_value";
  else if (progress.percent === null) state = "needs_baseline";
  else state = "scored";
  return {
    goalId: goal.id,
    title: goal.title,
    category: "personal",
    goalStatus: reached ? "achieved" : paused ? "paused" : "in_progress",
    state,
    direction: measure.direction,
    directionSource: "set",
    baselineValue: !reached && progress.baselineAssumedZero ? 0 : null,
    baselineSource: !reached && progress.baselineAssumedZero ? "assumed_zero" : null,
    currentValue: measure.current,
    targetValue: measure.target,
    progress: state !== "scored" ? null : reached ? 1 : progress.percent,
    reachedTarget: state === "scored" && (reached || progress.hint === "achieved"),
    priority: "normal",
    prioritySource: "default",
    trend: null,
    flagged: false,
  };
}

export function computeGoalProgress(
  entries: readonly GoalWithHistory[],
  personalGoals: readonly PersonalGoalForProgress[] = [],
): GoalProgressResult {
  const evaluated = [
    ...entries.map(evaluateGoal),
    ...personalGoals.flatMap((goal) => personalGoalResult(goal) ?? []),
  ];
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
      score !== null ? null : evaluated.length === 0 ? "no_goals" : "no_measurable_goals",
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
