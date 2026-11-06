import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import type { EnergyEstimateOutput, EnergyProposalWire } from "../contracts/energy-estimate";
import type { WeightTrendOutput } from "../contracts/weight-trend";

export const ENERGY_ESTIMATE_COPY = Object.freeze({
  title: msg`Energy estimate`,
  subtitle: msg`Estimated maintenance intake`,
  provisional: msg`Experimental estimate: not a target or a measure of what you ate.`,
  ask: msg`Ask for a suggestion`,
  pending: msg`Suggestion awaiting your review`,
  accept: msg`Accept suggestion`,
  dismiss: msg`Dismiss`,
  noTarget: msg`No energy target set`,
  hidden: msg`Numbers are hidden. Estimate details are not shown.`,
  unavailable: msg`An estimate is not available yet.`,
  error: msg`Could not load the estimate. Try again.`,
});

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
function perDay(n: number, i18n: I18n): string {
  const value = fmt(n);
  return i18n._(msg({ message: `${value} kcal/day`, comment: "safety" }));
}
export function presentEnergyEstimate(
  result: EnergyEstimateOutput,
  hideNumbers: boolean,
  i18n: I18n,
) {
  if (hideNumbers || result.status !== "estimated" || !result.estimate) return null;
  const { from, to } = result.window;
  const low = fmt(result.estimate.range.lowKcal);
  const high = fmt(result.estimate.range.highKcal);
  return {
    value: perDay(result.estimate.kcalPerDay, i18n),
    range: i18n._(
      msg({
        message: `${low} to ${high} kcal/day`,
        comment: "safety",
      }),
    ),
    window: i18n._(msg`${from} to ${to}`),
    notes: [
      result.formula,
      result.energyDensity.label,
      result.energyDensity.caveat,
      result.notes.experimental,
      result.notes.variability,
    ],
  };
}

export function presentProposal(proposal: EnergyProposalWire, hideNumbers: boolean, i18n: I18n) {
  if (hideNumbers) return null;
  return {
    suggestion: proposal.targetKcal === null ? null : perDay(proposal.targetKcal, i18n),
    current: proposal.currentTargetKcal === null ? null : perDay(proposal.currentTargetKcal, i18n),
  };
}

// ─── Food tab trend card (#395) ───────────────────────────────

export const TREND_CARD_COPY = Object.freeze({
  title: msg`Trends`,
  expenditure: msg`Estimated expenditure`,
  experimental: msg`Experimental`,
  trendWeight: msg`Trend weight`,
  howCalculated: msg`How it's calculated`,
  reference: msg`For your own reference. These estimates never change your targets on their own.`,
  suggestionsLink: msg`Targets and suggestions`,
  noTrend: msg`Not enough weigh-ins for a trend yet.`,
});

/**
 * The estimate as the Food tab shows it: the figure, its arithmetic range,
 * and how many days of logs it used. `null` in hide-numbers mode or when
 * there is no estimate (the reasons are shown instead).
 */
export function presentTrendEstimate(
  result: EnergyEstimateOutput,
  hideNumbers: boolean,
  i18n: I18n,
): { figure: string; range: string; basis: string } | null {
  if (hideNumbers || result.status !== "estimated" || !result.estimate) return null;
  const figure = fmt(result.estimate.kcalPerDay);
  const low = fmt(result.estimate.range.lowKcal);
  const high = fmt(result.estimate.range.highKcal);
  const used = result.inputs.intake.usedDays;
  const days = result.window.days;
  return {
    figure,
    range: i18n._(
      msg({ message: `Arithmetic range ${low} to ${high} kcal a day`, comment: "safety" }),
    ),
    basis: i18n._(
      msg`Worked out from ${used} of the last ${days} days of food logs and your trend weight. Days not marked complete are left out.`,
    ),
  };
}

/** The latest trend weight and its change over the range, or `null` when there is no trend. */
export function presentTrendWeight(
  trend: Pick<WeightTrendOutput, "status" | "points" | "change" | "completeness">,
  hideNumbers: boolean,
  i18n: I18n,
): { figure: string; change: string | null } | null {
  if (hideNumbers || trend.status !== "provisional") return null;
  const latest = [...trend.points].reverse().find((point) => point.trendKg !== null);
  if (!latest || latest.trendKg === null) return null;
  const figure = latest.trendKg.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  if (!trend.change) return { figure, change: null };
  const kg = trend.change.kg;
  const amount = `${kg > 0 ? "+" : kg < 0 ? "−" : ""}${Math.abs(kg).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}`;
  const days = trend.change.days;
  const weighIns = trend.completeness.observedDays;
  return {
    figure,
    change: i18n._(msg`${amount} kg over ${days} days, from ${weighIns} weigh-ins`),
  };
}
