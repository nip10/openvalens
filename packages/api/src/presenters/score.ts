import type {
  GoalProgressResult,
  GoalProgressWithheldReason,
  GoalResult,
  GoalResultState,
  ReadinessComponent,
  ReadinessInput,
  ReadinessInputState,
  ReadinessProfile,
  ReadinessResult,
  ReadinessWithheldReason,
} from "../score-contract";

/**
 * Issue #95 — copy and view models for the readiness index and goal progress,
 * shared by web and native so both show the same meaning, explanations,
 * breakdowns, profile, coverage and unavailable states. Pure (type-only
 * imports), safe for the app bundles.
 *
 * Copy rules (CONTRIBUTING.md → health data rules): describe what is
 * recorded and calculated; never claim to judge health, predict, or tell the
 * person how to train. Readiness is labelled experimental wherever it shows.
 */

export const SCORE_COPY = {
  pageTitle: "How am I doing?",
  pageIntro:
    "Two separate numbers, each with its own explanation. They are never combined into one health score.",
  readinessTitle: "Readiness index",
  experimentalBadge: "Experimental",
  readinessIntro:
    "An experimental summary of how your recent sleep, resting heart rate and activity compare with your own usual pattern.",
  readinessLimits:
    "It is not medical advice and says nothing about your health status. It does not tell you whether or how hard to exercise, and it has not been validated.",
  readinessMethod:
    "Each input is compared with your own median over the 28 days before it (at least 7 days with data are needed). 50 means in line with your usual. More sleep than usual raises that part; a higher resting heart rate, or a heavier recent activity load than usual, lowers its part. The index is the plain average of the parts your profile uses.",
  goalProgressTitle: "Goal progress",
  goalProgressIntro:
    "How far you have moved toward the targets you set, weighted by your priorities.",
  goalProgressLimits:
    "Reaching a target does not mean your health has improved. Goals you have not set are never counted against you.",
  goalProgressMethod:
    "Each goal's progress is how far you have moved from its starting value toward its target, capped at 100% once reached. The total weighs each counted goal by its priority (low 1, normal 2, high 3). Paused or cancelled goals, and goals without a target, current value or direction, are left out instead of counted as zero.",
  noStorage: "Calculated fresh from your records each time; scores are not stored.",
} as const;

// ─── readiness ─────────────────────────────────────────────────

export const READINESS_INPUT_LABELS: Record<ReadinessInput, string> = {
  sleep: "Sleep",
  resting_heart_rate: "Resting heart rate",
  activity_load: "Recent activity load",
  hrv: "Heart rate variability",
  check_in: "How you feel (check-in)",
};

export const READINESS_PROFILE_LABELS: Record<ReadinessProfile, string> = {
  physiology_enhanced: "Physiology-enhanced profile",
  manual_friendly: "Manual-friendly profile",
};

export const READINESS_PROFILE_DESCRIPTIONS: Record<ReadinessProfile, string> = {
  physiology_enhanced:
    "Uses sleep and resting heart rate, plus recent activity when available. Typically needs a wearable.",
  manual_friendly:
    "Uses sleep and recent activity (steps), which can be entered by hand. Not comparable with the physiology-enhanced profile.",
};

export const READINESS_INPUT_STATE_LABELS: Record<ReadinessInputState, string> = {
  used: "Used",
  ready_not_used: "Available, not part of this profile",
  no_recent_value: "No recent data",
  insufficient_baseline: "Not enough earlier days yet",
  not_supported_yet: "Not recorded by OpenValens yet",
};

export const READINESS_WITHHELD_EXPLANATIONS: Record<ReadinessWithheldReason, string> = {
  insufficient_inputs:
    "There is not enough recent data to compare with your usual pattern, so no number is shown.",
  adults_only: "These scores are for adults 18 and over, based on your profile answer.",
};

function thousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "7h 05m" / "58 bpm" / "8,200 steps a day". */
export function formatReadinessValue(
  value: number | null,
  unit: ReadinessComponent["unit"],
): string {
  if (value === null || unit === null) return "—";
  if (unit === "minutes") {
    const total = Math.round(value);
    return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
  }
  if (unit === "bpm") return `${Math.round(value)} bpm`;
  return `${thousands(value)} steps a day`;
}

/** "9% below your usual" / "in line with your usual". */
export function formatRelativeDifference(relative: number | null): string | null {
  if (relative === null) return null;
  const percent = Math.round(Math.abs(relative) * 100);
  if (percent === 0) return "in line with your usual";
  return `${percent}% ${relative > 0 ? "above" : "below"} your usual`;
}

/** "Sleep, Resting heart rate and Recent activity load". */
export function listInputs(inputs: readonly ReadinessInput[]): string {
  const labels = inputs.map((input) => READINESS_INPUT_LABELS[input]);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

export type ReadinessComponentView = {
  key: ReadinessInput;
  label: string;
  stateLabel: string;
  used: boolean;
  scoreText: string;
  detail: string;
  accessibilityLabel: string;
};

export type ReadinessView = {
  title: string;
  badge: string;
  available: boolean;
  scoreText: string;
  accessibilityLabel: string;
  profileLabel: string;
  profileDescription: string | null;
  coverageText: string;
  withheldExplanation: string | null;
  wouldHelpText: string | null;
  components: ReadinessComponentView[];
  versionText: string;
};

function componentDetail(component: ReadinessComponent): string {
  if (component.state === "not_supported_yet") {
    return "Not part of the score until OpenValens records it.";
  }
  if (component.state === "no_recent_value") {
    return component.input === "activity_load"
      ? `Needs steps on at least 2 of the last 3 full days (found ${component.recentDays}).`
      : "Nothing recorded for today or yesterday.";
  }
  const recent = `Recent ${formatReadinessValue(component.recentValue, component.unit)}`;
  if (component.state === "insufficient_baseline") {
    return `${recent}. Your usual needs ${component.baselineMinDays} days with data in the previous ${component.baselineWindowDays}; found ${component.baselineDays}.`;
  }
  const relative = formatRelativeDifference(component.relativeDifference);
  return `${recent} vs usual ${formatReadinessValue(component.baselineValue, component.unit)} (median of ${component.baselineDays} days)${relative ? `, ${relative}` : ""}.`;
}

export function readinessView(result: ReadinessResult): ReadinessView {
  const available = result.status === "available" && result.score !== null;
  const components = result.components.map((component): ReadinessComponentView => {
    const label = READINESS_INPUT_LABELS[component.input];
    const stateLabel = READINESS_INPUT_STATE_LABELS[component.state];
    const scoreText = component.componentScore === null ? "—" : `${component.componentScore}`;
    const detail = componentDetail(component);
    return {
      key: component.input,
      label,
      stateLabel,
      used: component.state === "used",
      scoreText,
      detail,
      accessibilityLabel: `${label}: ${stateLabel}.${component.componentScore === null ? "" : ` Part score ${component.componentScore} out of 100.`} ${detail}`,
    };
  });
  const used = result.coverage.usedInputs.length;
  const possible = result.coverage.profileInputs.length;
  return {
    title: SCORE_COPY.readinessTitle,
    badge: SCORE_COPY.experimentalBadge,
    available,
    scoreText: available ? `${result.score}` : "—",
    accessibilityLabel: available
      ? `Experimental readiness index ${result.score} out of 100, ${READINESS_PROFILE_LABELS[result.profile!].toLowerCase()}.`
      : "Experimental readiness index not available.",
    profileLabel: result.profile
      ? READINESS_PROFILE_LABELS[result.profile]
      : "No profile applies yet",
    profileDescription: result.profile ? READINESS_PROFILE_DESCRIPTIONS[result.profile] : null,
    coverageText:
      possible > 0
        ? `Uses ${used} of ${possible} inputs for this profile: ${listInputs(result.coverage.usedInputs)}.`
        : "No inputs could be used.",
    withheldExplanation: result.withheldReason
      ? READINESS_WITHHELD_EXPLANATIONS[result.withheldReason]
      : null,
    wouldHelpText:
      result.wouldHelp.length > 0
        ? `More data for ${listInputs(result.wouldHelp)} would help.`
        : null,
    components,
    versionText: `Method ${result.algorithmVersion}, as of ${result.asOf}.`,
  };
}

// ─── goal progress ─────────────────────────────────────────────

export const GOAL_RESULT_STATE_LABELS: Record<GoalResultState, string> = {
  scored: "Counted",
  paused: "Paused, not counted",
  not_applicable: "Cancelled, not counted",
  needs_target: "Needs a numeric target",
  needs_current_value: "Needs a current value",
  needs_direction: "Needs a direction (increase or decrease)",
  needs_baseline: "Needs a starting value",
};

export const GOAL_PROGRESS_WITHHELD_EXPLANATIONS: Record<GoalProgressWithheldReason, string> = {
  no_goals: "Add a goal with a target to see goal progress.",
  no_measurable_goals:
    "None of your goals has a numeric target, current value and direction yet, so no number is shown. A focus area alone does not produce a number.",
  adults_only: "These scores are for adults 18 and over, based on your profile answer.",
};

const PRIORITY_LABELS: Record<GoalResult["priority"], string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
};

function formatNumber(value: number | null): string {
  if (value === null) return "—";
  return Number.isInteger(value) ? `${value}` : `${Math.round(value * 100) / 100}`;
}

export type GoalResultView = {
  key: number;
  title: string;
  stateLabel: string;
  counted: boolean;
  progressText: string;
  detail: string;
  priorityText: string;
  flagText: string | null;
  accessibilityLabel: string;
};

export type GoalProgressView = {
  title: string;
  available: boolean;
  scoreText: string;
  accessibilityLabel: string;
  coverageText: string;
  flaggedText: string | null;
  withheldExplanation: string | null;
  goals: GoalResultView[];
  versionText: string;
};

function goalDetail(goal: GoalResult): string {
  const parts: string[] = [];
  if (goal.baselineValue !== null) {
    const source =
      goal.baselineSource === "assumed_zero"
        ? " (no starting value, measured from 0)"
        : goal.baselineSource === "first_check_in"
          ? " (first check-in)"
          : "";
    parts.push(`Start ${formatNumber(goal.baselineValue)}${source}`);
  }
  if (goal.currentValue !== null) parts.push(`now ${formatNumber(goal.currentValue)}`);
  if (goal.targetValue !== null) {
    const direction =
      goal.direction === "increase" ? " (up)" : goal.direction === "decrease" ? " (down)" : "";
    parts.push(`target ${formatNumber(goal.targetValue)}${direction}`);
  }
  if (goal.directionSource === "inferred") parts.push("direction inferred from the start value");
  return parts.length > 0 ? `${parts.join(", ")}.` : "No numbers recorded yet.";
}

export function goalProgressView(result: GoalProgressResult): GoalProgressView {
  const available = result.status === "available" && result.score !== null;
  const goals = result.goals.map((goal): GoalResultView => {
    const stateLabel = GOAL_RESULT_STATE_LABELS[goal.state];
    const counted = goal.state === "scored";
    const progressText =
      counted && goal.progress !== null
        ? goal.reachedTarget
          ? "100% (target reached)"
          : `${Math.round(goal.progress * 100)}%`
        : "—";
    const priorityText = `${PRIORITY_LABELS[goal.priority]} priority${goal.prioritySource === "default" ? " (default)" : ""}${
      goal.contribution !== null ? `, ${Math.round(goal.contribution * 100)}% of the total` : ""
    }`;
    const flagText = goal.flagged ? "Moved away from the target at the last check-in" : null;
    const detail = goalDetail(goal);
    return {
      key: goal.goalId,
      title: goal.title,
      stateLabel,
      counted,
      progressText,
      detail,
      priorityText,
      flagText,
      accessibilityLabel: `${goal.title}: ${stateLabel}. ${counted ? `Progress ${progressText}. ` : ""}${flagText ? `${flagText}. ` : ""}${detail} ${priorityText}.`,
    };
  });
  return {
    title: SCORE_COPY.goalProgressTitle,
    available,
    scoreText: available ? `${result.score}%` : "—",
    accessibilityLabel: available
      ? `Goal progress ${result.score} percent across ${result.coverage.scored} counted goals.`
      : "Goal progress not available.",
    coverageText: `${result.coverage.scored} of ${result.coverage.total} goals counted.`,
    flaggedText:
      result.coverage.flagged > 0
        ? `${result.coverage.flagged} goal${result.coverage.flagged === 1 ? "" : "s"} moved away from the target recently.`
        : null,
    withheldExplanation: result.withheldReason
      ? GOAL_PROGRESS_WITHHELD_EXPLANATIONS[result.withheldReason]
      : null,
    goals,
    versionText: `Method ${result.algorithmVersion}.`,
  };
}
