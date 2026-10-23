import type { I18n } from "@lingui/core";
import { goalProgressView, readinessView, SCORE_COPY } from "@openvalens/api/presenters/score";
import type { GoalProgressResult, ReadinessResult } from "@openvalens/api/score-contract";

/**
 * Issue #95 — native layout model for the scores screen. Dependency-free (no
 * RPC client / Varlock) so it is unit-tested directly. It flattens the shared
 * view models from `@openvalens/api/presenters/score` into cards of text rows,
 * so the native screen shows exactly what the web cards show: the score (or
 * "—" with the reason), the experimental label, profile, coverage, every
 * input or goal with its state, and the method and limits text. Text is
 * rendered through the `i18n` passed in (#67).
 */

export type ScoreRow = {
  key: string;
  label: string;
  value: string;
  lines: string[];
  accessibilityLabel: string;
};

export type ScoreCard = {
  key: "readiness" | "goal_progress";
  title: string;
  badge: string | null;
  intro: string;
  scoreText: string;
  scoreSuffix: string | null;
  scoreAccessibilityLabel: string;
  notes: string[];
  rows: ScoreRow[];
  method: string;
  limits: string;
  versionText: string;
};

export function readinessCard(result: ReadinessResult, i18n: I18n): ScoreCard {
  const view = readinessView(result, i18n);
  return {
    key: "readiness",
    title: view.title,
    badge: view.badge,
    intro: i18n._(SCORE_COPY.readinessIntro),
    scoreText: view.scoreText,
    scoreSuffix: view.available ? i18n._(SCORE_COPY.outOf100) : null,
    scoreAccessibilityLabel: view.accessibilityLabel,
    notes: [
      view.withheldExplanation,
      view.wouldHelpText,
      view.profileLabel,
      view.profileDescription,
      view.coverageText,
    ].filter((line): line is string => line !== null),
    rows: view.components.map((component) => ({
      key: component.key,
      label: component.label,
      value: component.scoreText,
      lines: [component.stateLabel, component.detail],
      accessibilityLabel: component.accessibilityLabel,
    })),
    method: i18n._(SCORE_COPY.readinessMethod),
    limits: i18n._(SCORE_COPY.readinessLimits),
    versionText: view.versionText,
  };
}

export function goalProgressCard(result: GoalProgressResult, i18n: I18n): ScoreCard {
  const view = goalProgressView(result, i18n);
  return {
    key: "goal_progress",
    title: view.title,
    badge: null,
    intro: i18n._(SCORE_COPY.goalProgressIntro),
    scoreText: view.scoreText,
    scoreSuffix: null,
    scoreAccessibilityLabel: view.accessibilityLabel,
    notes: [view.withheldExplanation, view.coverageText, view.flaggedText].filter(
      (line): line is string => line !== null,
    ),
    rows: view.goals.map((goal) => ({
      key: String(goal.key),
      label: goal.title,
      value: goal.progressText,
      lines: [
        goal.stateLabel,
        goal.detail,
        goal.priorityText,
        ...(goal.flagText ? [`⚑ ${goal.flagText}`] : []),
      ],
      accessibilityLabel: goal.accessibilityLabel,
    })),
    method: i18n._(SCORE_COPY.goalProgressMethod),
    limits: i18n._(SCORE_COPY.goalProgressLimits),
    versionText: view.versionText,
  };
}

/** Today's check-in value, or null when blank / too long (mirrors the server's 80-char limit). */
export function goalLogValue(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 80 ? trimmed : null;
}
