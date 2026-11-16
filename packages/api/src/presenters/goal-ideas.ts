/**
 * goals#4 and goals#7 (owner decision 2026-11-16): copy and view models for
 * the goal estimate ("On track for 23 Nov") and the goal ideas built from the
 * member's own records. Shared by web and native. Pure (type-only domain
 * imports), safe for the app bundles.
 *
 * Copy rules: the estimate always says it is an estimate, and an idea always
 * shows the member's own figure it came from. Neither says what is good or
 * healthy for anyone.
 */
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { GoalDefinition } from "@openvalens/plans/goal-model";
import type { GoalProjection } from "@openvalens/plans/goal-projection";
import {
  GOAL_SUGGESTION_RULES,
  goalSuggestionRule,
  type GoalSuggestion,
} from "@openvalens/plans/goal-suggestions";

import { formatSleepDuration } from "./sleep";

export const GOAL_IDEAS_COPY = {
  ideasTitle: msg`Ideas from your records`,
  ideasExplanation: msg`Each idea starts from your own usual over the last 4 weeks, rounded to a round number: the middle night of sleep, the middle day of water you logged, or a supplement you took on at least half the days. Tap one to open a new goal with it filled in. You can change anything before you save, and nothing is saved until you do.`,
  projectionExplanation: msg`An estimate, not a promise: a straight line through your values from the last 4 weeks, carried forward to your target. It needs at least 4 days with a value, a week apart or more, and a trend that moves toward the target. It changes as you log.`,
} as const;

function formatDate(i18n: I18n, date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(i18n.locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

/** "On track for 23 Nov 2026 (estimate)". */
export function goalProjectionText(i18n: I18n, projection: GoalProjection): string {
  const date = formatDate(i18n, projection.date);
  return i18n._(msg`On track for ${date} (estimate)`);
}

export type GoalSuggestionView = {
  key: string;
  /** The chip and the new goal's name: "Sleep 7.5 h a night". */
  label: string;
  /** Where it came from: "Your usual: 7h 12m a night". */
  basis: string;
};

export function goalSuggestionView(i18n: I18n, suggestion: GoalSuggestion): GoalSuggestionView {
  const number = (value: number) =>
    new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 1 }).format(value);
  const window = GOAL_SUGGESTION_RULES.windowDays;
  if (suggestion.kind === "sleep") {
    const hours = number(suggestion.target);
    const usual = formatSleepDuration(suggestion.usual * 60);
    return {
      key: suggestion.metric,
      label: i18n._(msg`Sleep ${hours} h a night`),
      basis: i18n._(msg`Your usual: ${usual} a night`),
    };
  }
  if (suggestion.kind === "water") {
    const amount = number(suggestion.target);
    const usual = number(suggestion.usual);
    return {
      key: suggestion.metric,
      label: i18n._(msg`Drink ${amount} ml of water a day`),
      basis: i18n._(msg`Your usual: ${usual} ml on days you log water`),
    };
  }
  const name = suggestion.supplementName;
  const days = suggestion.days;
  return {
    key: suggestion.metric,
    label: i18n._(msg`Take ${name} every day`),
    basis: i18n._(msg`You logged it on ${days} of the last ${window} days`),
  };
}

/** The new goal an idea opens in the editor: nothing is saved until the member saves it. */
export function goalSuggestionSeed(
  i18n: I18n,
  suggestion: GoalSuggestion,
  options: { id: string; startDate: string; timeZone: string },
): GoalDefinition {
  return {
    id: options.id,
    title: goalSuggestionView(i18n, suggestion).label,
    source: suggestion.source,
    metric: suggestion.metric,
    unit: suggestion.unit,
    rule: goalSuggestionRule(suggestion),
    startDate: options.startDate,
    timeZone: options.timeZone,
    dayCutoff: null,
    status: "active",
    milestones: [],
  };
}
