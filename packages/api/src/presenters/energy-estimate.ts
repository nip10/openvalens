import type { EnergyEstimateOutput, EnergyProposalWire } from "../contracts/energy-estimate";

export const ENERGY_ESTIMATE_COPY = Object.freeze({
  title: "Energy estimate",
  subtitle: "Estimated maintenance intake",
  provisional: "Experimental estimate—not a target or a measure of what you ate.",
  ask: "Ask for a suggestion",
  pending: "Suggestion awaiting your review",
  accept: "Accept suggestion",
  dismiss: "Dismiss",
  noTarget: "No energy target set",
  hidden: "Numbers are hidden. Estimate details are not shown.",
  unavailable: "An estimate is not available yet.",
  error: "Could not load the estimate. Try again.",
});

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
export function presentEnergyEstimate(result: EnergyEstimateOutput, hideNumbers: boolean) {
  if (hideNumbers || result.status !== "estimated" || !result.estimate) return null;
  return {
    value: `${fmt(result.estimate.kcalPerDay)} kcal/day`,
    range: `${fmt(result.estimate.range.lowKcal)}–${fmt(result.estimate.range.highKcal)} kcal/day`,
    window: `${result.window.from} to ${result.window.to}`,
    notes: [
      result.formula,
      result.energyDensity.label,
      result.energyDensity.caveat,
      result.notes.experimental,
      result.notes.variability,
    ],
  };
}

export function presentProposal(proposal: EnergyProposalWire, hideNumbers: boolean) {
  if (hideNumbers) return null;
  return {
    suggestion: proposal.targetKcal === null ? null : `${fmt(proposal.targetKcal)} kcal/day`,
    current:
      proposal.currentTargetKcal === null ? null : `${fmt(proposal.currentTargetKcal)} kcal/day`,
  };
}
