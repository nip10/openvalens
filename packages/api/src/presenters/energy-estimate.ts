import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import type { EnergyEstimateOutput, EnergyProposalWire } from "../contracts/energy-estimate";

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
