import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg, plural, select } from "@lingui/core/macro";

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
 *
 * Copy constants are Lingui message descriptors; the view builders render
 * through the `i18n` they are given (#67).
 */

export const SCORE_COPY = {
  pageTitle: msg`How am I doing?`,
  pageIntro: msg`Two separate numbers, each with its own explanation. They are never combined into one health score.`,
  readinessTitle: msg`Readiness index`,
  experimentalBadge: msg`Experimental`,
  /** Shown after an available readiness index, e.g. "62 out of 100". */
  outOf100: msg`out of 100`,
  readinessIntro: msg`An experimental summary of how your recent sleep, resting heart rate and activity compare with your own usual pattern.`,
  readinessLimits: msg({
    message:
      "It is not medical advice and says nothing about your health status. It does not tell you whether or how hard to exercise, and it has not been validated.",
    comment: "safety",
  }),
  readinessMethod: msg`Each input is compared with your own median over the 28 days before it (at least 7 days with data are needed). 50 means in line with your usual. More sleep than usual raises that part; a higher resting heart rate, or a heavier recent activity load than usual, lowers its part. The index is the plain average of the parts your profile uses.`,
  goalProgressTitle: msg`Goal progress`,
  goalProgressIntro: msg`How far you have moved toward the targets you set, weighted by your priorities.`,
  goalProgressLimits: msg`Reaching a target does not mean your health has improved. Goals you have not set are never counted against you.`,
  goalProgressMethod: msg`Each goal's progress is how far you have moved from its starting value toward its target, capped at 100% once reached. The total weighs each counted goal by its priority (low 1, normal 2, high 3). Paused or cancelled goals, and goals without a target, current value or direction, are left out instead of counted as zero.`,
  noStorage: msg`Calculated fresh from your records each time; scores are not stored.`,
} as const;

// ─── readiness ─────────────────────────────────────────────────

export const READINESS_INPUT_LABELS: Record<ReadinessInput, MessageDescriptor> = {
  sleep: msg`Sleep`,
  resting_heart_rate: msg`Resting heart rate`,
  activity_load: msg`Recent activity load`,
  hrv: msg`Heart rate variability`,
  check_in: msg`How you feel (check-in)`,
};

export const READINESS_PROFILE_LABELS: Record<ReadinessProfile, MessageDescriptor> = {
  physiology_enhanced: msg`Physiology-enhanced profile`,
  manual_friendly: msg`Manual-friendly profile`,
};

export const READINESS_PROFILE_DESCRIPTIONS: Record<ReadinessProfile, MessageDescriptor> = {
  physiology_enhanced: msg`Uses sleep and resting heart rate, plus recent activity when available. Typically needs a wearable.`,
  manual_friendly: msg`Uses sleep and recent activity (steps), which can be entered by hand. Not comparable with the physiology-enhanced profile.`,
};

export const READINESS_INPUT_STATE_LABELS: Record<ReadinessInputState, MessageDescriptor> = {
  used: msg`Used`,
  ready_not_used: msg`Available, not part of this profile`,
  no_recent_value: msg`No recent data`,
  insufficient_baseline: msg`Not enough earlier days yet`,
  not_supported_yet: msg`Not recorded by OpenValens yet`,
};

export const READINESS_WITHHELD_EXPLANATIONS: Record<ReadinessWithheldReason, MessageDescriptor> = {
  insufficient_inputs: msg`There is not enough recent data to compare with your usual pattern, so no number is shown.`,
  adults_only: msg`These scores are for adults 18 and over, based on your profile answer.`,
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
  i18n: I18n,
): string {
  if (value === null || unit === null) return "—";
  if (unit === "minutes") {
    const total = Math.round(value);
    return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
  }
  if (unit === "bpm") return `${Math.round(value)} bpm`;
  const steps = thousands(value);
  return i18n._(msg({ message: `${steps} steps a day`, comment: "safety" }));
}

/** "9% below your usual" / "in line with your usual". */
export function formatRelativeDifference(relative: number | null, i18n: I18n): string | null {
  if (relative === null) return null;
  const percent = Math.round(Math.abs(relative) * 100);
  if (percent === 0) return i18n._(msg`in line with your usual`);
  return relative > 0
    ? i18n._(msg`${percent}% above your usual`)
    : i18n._(msg`${percent}% below your usual`);
}

/** "Sleep, Resting heart rate and Recent activity load". */
export function listInputs(inputs: readonly ReadinessInput[], i18n: I18n): string {
  const labels = inputs.map((input) => i18n._(READINESS_INPUT_LABELS[input]));
  if (labels.length <= 1) return labels.join("");
  const first = labels.slice(0, -1).join(", ");
  const last = labels.at(-1) ?? "";
  return i18n._(msg`${first} and ${last}`);
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

function componentDetail(component: ReadinessComponent, i18n: I18n): string {
  if (component.state === "not_supported_yet") {
    return i18n._(msg`Not part of the score until OpenValens records it.`);
  }
  if (component.state === "no_recent_value") {
    const found = component.recentDays;
    return component.input === "activity_load"
      ? i18n._(msg`Needs steps on at least 2 of the last 3 full days (found ${found}).`)
      : i18n._(msg`Nothing recorded for today or yesterday.`);
  }
  const recent = formatReadinessValue(component.recentValue, component.unit, i18n);
  const days = component.baselineDays;
  if (component.state === "insufficient_baseline") {
    const minimum = component.baselineMinDays;
    const window = component.baselineWindowDays;
    return i18n._(
      msg`Recent ${recent}. Your usual needs ${minimum} days with data in the previous ${window}; found ${days}.`,
    );
  }
  const usual = formatReadinessValue(component.baselineValue, component.unit, i18n);
  const relative = formatRelativeDifference(component.relativeDifference, i18n);
  return relative
    ? i18n._(msg`Recent ${recent} vs usual ${usual} (median of ${days} days), ${relative}.`)
    : i18n._(msg`Recent ${recent} vs usual ${usual} (median of ${days} days).`);
}

/** Text is rendered through `i18n` (#67), so the view follows the active language. */
export function readinessView(result: ReadinessResult, i18n: I18n): ReadinessView {
  const available = result.status === "available" && result.score !== null;
  const components = result.components.map((component): ReadinessComponentView => {
    const label = i18n._(READINESS_INPUT_LABELS[component.input]);
    const state = i18n._(READINESS_INPUT_STATE_LABELS[component.state]);
    const score = component.componentScore;
    const scoreText = score === null ? "—" : `${score}`;
    const detail = componentDetail(component, i18n);
    return {
      key: component.input,
      label,
      stateLabel: state,
      used: component.state === "used",
      scoreText,
      detail,
      accessibilityLabel:
        score === null
          ? i18n._(msg`${label}: ${state}. ${detail}`)
          : i18n._(msg`${label}: ${state}. Part score ${score} out of 100. ${detail}`),
    };
  });
  const used = result.coverage.usedInputs.length;
  const possible = result.coverage.profileInputs.length;
  // Only shown when available, so never null there.
  const score = result.score ?? 0;
  const profile = result.profile ? i18n._(READINESS_PROFILE_LABELS[result.profile]) : null;
  const usedList = listInputs(result.coverage.usedInputs, i18n);
  const helpList = listInputs(result.wouldHelp, i18n);
  const version = result.algorithmVersion;
  const asOf = result.asOf;
  const profileName = profile?.toLowerCase() ?? "";
  return {
    title: i18n._(SCORE_COPY.readinessTitle),
    badge: i18n._(SCORE_COPY.experimentalBadge),
    available,
    scoreText: available ? `${score}` : "—",
    accessibilityLabel: available
      ? i18n._(msg`Experimental readiness index ${score} out of 100, ${profileName}.`)
      : i18n._(msg`Experimental readiness index not available.`),
    profileLabel: profile ?? i18n._(msg`No profile applies yet`),
    profileDescription: result.profile
      ? i18n._(READINESS_PROFILE_DESCRIPTIONS[result.profile])
      : null,
    coverageText:
      possible > 0
        ? i18n._(msg`Uses ${used} of ${possible} inputs for this profile: ${usedList}.`)
        : i18n._(msg`No inputs could be used.`),
    withheldExplanation: result.withheldReason
      ? i18n._(READINESS_WITHHELD_EXPLANATIONS[result.withheldReason])
      : null,
    wouldHelpText:
      result.wouldHelp.length > 0 ? i18n._(msg`More data for ${helpList} would help.`) : null,
    components,
    versionText: i18n._(msg`Method ${version}, as of ${asOf}.`),
  };
}

// ─── goal progress ─────────────────────────────────────────────

export const GOAL_RESULT_STATE_LABELS: Record<GoalResultState, MessageDescriptor> = {
  scored: msg`Counted`,
  paused: msg`Paused, not counted`,
  not_applicable: msg`Cancelled, not counted`,
  needs_target: msg`Needs a numeric target`,
  needs_current_value: msg`Needs a current value`,
  needs_direction: msg`Needs a direction (increase or decrease)`,
  needs_baseline: msg`Needs a starting value`,
};

export const GOAL_PROGRESS_WITHHELD_EXPLANATIONS: Record<
  GoalProgressWithheldReason,
  MessageDescriptor
> = {
  no_goals: msg`Add a goal with a target to see goal progress.`,
  no_measurable_goals: msg`None of your goals has a numeric target, current value and direction yet, so no number is shown. A focus area alone does not produce a number.`,
  adults_only: msg`These scores are for adults 18 and over, based on your profile answer.`,
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

/** One short sentence per recorded number, e.g. "Start: 82. Now: 79. Target: 70 (down)." */
function goalDetail(goal: GoalResult, i18n: I18n): string {
  const sentences: string[] = [];
  if (goal.baselineValue !== null) {
    const start = formatNumber(goal.baselineValue);
    sentences.push(
      goal.baselineSource === "assumed_zero"
        ? i18n._(msg`Start: ${start} (no starting value, measured from 0).`)
        : goal.baselineSource === "first_check_in"
          ? i18n._(msg`Start: ${start} (first check-in).`)
          : i18n._(msg`Start: ${start}.`),
    );
  }
  if (goal.currentValue !== null) {
    const now = formatNumber(goal.currentValue);
    sentences.push(i18n._(msg`Now: ${now}.`));
  }
  if (goal.targetValue !== null) {
    const target = formatNumber(goal.targetValue);
    sentences.push(
      goal.direction === "increase"
        ? i18n._(msg`Target: ${target} (up).`)
        : goal.direction === "decrease"
          ? i18n._(msg`Target: ${target} (down).`)
          : i18n._(msg`Target: ${target}.`),
    );
  }
  if (goal.directionSource === "inferred")
    sentences.push(i18n._(msg`Direction inferred from the start value.`));
  return sentences.length > 0 ? sentences.join(" ") : i18n._(msg`No numbers recorded yet.`);
}

function priorityText(goal: GoalResult, i18n: I18n): string {
  const priority = goal.priority;
  const isDefault = goal.prioritySource === "default";
  if (goal.contribution === null)
    return isDefault
      ? i18n._(
          msg`${select(priority, { low: "Low priority", normal: "Normal priority", other: "High priority" })} (default)`,
        )
      : i18n._(
          msg`${select(priority, { low: "Low priority", normal: "Normal priority", other: "High priority" })}`,
        );
  const share = Math.round(goal.contribution * 100);
  return isDefault
    ? i18n._(
        msg`${select(priority, { low: "Low priority", normal: "Normal priority", other: "High priority" })} (default), ${share}% of the total`,
      )
    : i18n._(
        msg`${select(priority, { low: "Low priority", normal: "Normal priority", other: "High priority" })}, ${share}% of the total`,
      );
}

/** Text is rendered through `i18n` (#67), so the view follows the active language. */
export function goalProgressView(result: GoalProgressResult, i18n: I18n): GoalProgressView {
  const available = result.status === "available" && result.score !== null;
  const goals = result.goals.map((goal): GoalResultView => {
    const stateLabel = i18n._(GOAL_RESULT_STATE_LABELS[goal.state]);
    const counted = goal.state === "scored";
    const progressText =
      counted && goal.progress !== null
        ? goal.reachedTarget
          ? i18n._(msg`100% (target reached)`)
          : `${Math.round(goal.progress * 100)}%`
        : "—";
    const priority = priorityText(goal, i18n);
    const flagText = goal.flagged
      ? i18n._(msg`Moved away from the target at the last check-in`)
      : null;
    const detail = goalDetail(goal, i18n);
    const title = goal.title;
    const sentences = [i18n._(msg`${title}: ${stateLabel}.`)];
    if (counted) sentences.push(i18n._(msg`Progress ${progressText}.`));
    if (flagText) sentences.push(`${flagText}.`);
    sentences.push(detail, `${priority}.`);
    return {
      key: goal.goalId,
      title,
      stateLabel,
      counted,
      progressText,
      detail,
      priorityText: priority,
      flagText,
      accessibilityLabel: sentences.join(" "),
    };
  });
  // Only shown when available, so never null there.
  const score = result.score ?? 0;
  const { scored, total, flagged } = result.coverage;
  const version = result.algorithmVersion;
  return {
    title: i18n._(SCORE_COPY.goalProgressTitle),
    available,
    scoreText: available ? `${score}%` : "—",
    accessibilityLabel: available
      ? i18n._(
          msg`Goal progress ${score} percent across ${plural(scored, { one: "# counted goal", other: "# counted goals" })}.`,
        )
      : i18n._(msg`Goal progress not available.`),
    coverageText: i18n._(
      msg`${scored} of ${plural(total, { one: "# goal", other: "# goals" })} counted.`,
    ),
    flaggedText:
      flagged > 0
        ? i18n._(
            msg`${plural(flagged, { one: "# goal moved away from the target recently.", other: "# goals moved away from the target recently." })}`,
          )
        : null,
    withheldExplanation: result.withheldReason
      ? i18n._(GOAL_PROGRESS_WITHHELD_EXPLANATIONS[result.withheldReason])
      : null,
    goals,
    versionText: i18n._(msg`Method ${version}.`),
  };
}
