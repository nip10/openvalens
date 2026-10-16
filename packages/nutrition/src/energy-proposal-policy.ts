import type { EnergyEstimate } from "./energy-estimate";

/**
 * Proposal policy for energy targets (Issue #76). Pure and client-safe.
 *
 * An estimate (#76) is information; a proposal is a separate, explicit
 * suggestion to change the member's energy target, and it only takes effect
 * when the member accepts it. Version `energy-proposal/v1` is deliberately
 * narrow until the nutrition safety policy (#80, `nutrition-safety/v1`)
 * exists:
 *
 * - Only `maintenance` proposals: the target follows the estimate. No deficit
 *   or gain is ever proposed here; those need #80's floors, caps and
 *   exclusions and must go through that policy.
 * - Adults only: the member must have confirmed they are 18 or older (#98).
 * - Never below 1,200 kcal/day under any setting (#80 table, NICE NG246).
 * - Each change moves the target by at most 200 kcal or 10% of the current
 *   target, whichever is larger, and at most one accepted change per 7 days
 *   (#80 weekly step, a product choice).
 * - A proposal expires after 7 days and is re-checked on accept: if the
 *   target changed meanwhile, or the member no longer qualifies, the accept is
 *   refused and nothing is written.
 *
 * #80 replaces {@link ENERGY_PROPOSAL_POLICY} with its versioned config and
 * extends {@link planEnergyProposal}; every proposal row stores the policy
 * version it was made under.
 */

export const ENERGY_PROPOSAL_POLICY = Object.freeze({
  version: "energy-proposal/v1" as const,
  kinds: Object.freeze(["maintenance"] as const),
  /** Never propose a target below this, under any setting (kcal/day). */
  neverBelowKcal: 1200,
  /** Each change moves the target by at most max(maxStepKcal, maxStepFraction × current). */
  maxStepKcal: 200,
  maxStepFraction: 0.1,
  /** Smaller differences are not worth a proposal (kcal/day). */
  minChangeKcal: 50,
  /** Proposed targets are rounded to this step (kcal/day). */
  targetPrecisionKcal: 50,
  /** Days after an accepted change before the next proposal. */
  minDaysBetweenChanges: 7,
  /** Days a pending proposal stays valid. */
  validForDays: 7,
});

export type EnergyProposalPolicy = typeof ENERGY_PROPOSAL_POLICY;
export type EnergyProposalKind = (typeof ENERGY_PROPOSAL_POLICY.kinds)[number];

/** Why no proposal can be made or accepted. Copy never states a floor or body value. */
export const PROPOSAL_DECLINE_REASONS = [
  "adults_only",
  "no_estimate",
  "below_floor",
  "no_change",
  "recently_changed",
  "expired",
  "target_changed",
  "not_pending",
] as const;
export type ProposalDeclineReason = (typeof PROPOSAL_DECLINE_REASONS)[number];

export const PROPOSAL_DECLINE_COPY: Readonly<Record<ProposalDeclineReason, string>> = Object.freeze(
  {
    adults_only: "We don't suggest target changes for this profile.",
    no_estimate: "There is no estimate yet, so there is nothing to suggest.",
    below_floor: "We don't suggest a target from this estimate.",
    no_change: "Your current target is already close to the estimate.",
    recently_changed: "Your target changed in the last 7 days. Suggestions resume after that.",
    expired: "This suggestion is more than 7 days old. Ask for a new one.",
    target_changed: "Your target changed after this suggestion was made. Ask for a new one.",
    not_pending: "This suggestion was already accepted, dismissed or replaced.",
  },
);

export const PROPOSAL_COPY = Object.freeze({
  maintenance:
    "Suggested target: the estimated intake that would keep your weight trend steady. Nothing changes unless you accept.",
  stepLimited:
    "The suggestion moves your target part of the way. Changes are kept small, one step per week.",
  experimental: "Based on an experimental estimate that has not been validated.",
});

/** The single energy target a goal row represents (midpoint of a range), or `null`. */
export function energyTargetOf(
  goal: { minAmount: number | null; maxAmount: number | null } | null,
): number | null {
  if (!goal) return null;
  const { minAmount, maxAmount } = goal;
  if (minAmount !== null && maxAmount !== null) return Math.round((minAmount + maxAmount) / 2);
  return minAmount ?? maxAmount ?? null;
}

export type EnergyProposalPlan =
  | {
      outcome: "proposal";
      kind: EnergyProposalKind;
      estimateKcal: number;
      targetKcal: number;
      currentTargetKcal: number | null;
      stepLimited: boolean;
      policyVersion: EnergyProposalPolicy["version"];
    }
  | { outcome: "declined"; reason: ProposalDeclineReason };

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * Decides whether a maintenance proposal can be made from `estimate`, and
 * for which target. Never touches a goal: callers persist the plan as a
 * pending proposal for the member to review.
 */
export function planEnergyProposal(input: {
  estimate: Pick<EnergyEstimate, "status" | "estimate">;
  adultConfirmed: boolean;
  currentTargetKcal: number | null;
  lastAcceptedAt: Date | null;
  now: Date;
  policy?: EnergyProposalPolicy;
}): EnergyProposalPlan {
  const policy = input.policy ?? ENERGY_PROPOSAL_POLICY;
  if (!input.adultConfirmed) return { outcome: "declined", reason: "adults_only" };
  if (input.estimate.status !== "estimated" || !input.estimate.estimate)
    return { outcome: "declined", reason: "no_estimate" };
  if (
    input.lastAcceptedAt &&
    input.now.getTime() - input.lastAcceptedAt.getTime() < policy.minDaysBetweenChanges * 86_400_000
  )
    return { outcome: "declined", reason: "recently_changed" };

  const estimateKcal = input.estimate.estimate.kcalPerDay;
  const current = input.currentTargetKcal;
  let target = roundTo(estimateKcal, policy.targetPrecisionKcal);
  let stepLimited = false;
  if (current !== null) {
    const step = Math.max(policy.maxStepKcal, policy.maxStepFraction * current);
    if (Math.abs(target - current) > step) {
      // Whole precision steps only, so rounding never exceeds the step limit.
      const allowed = Math.floor(step / policy.targetPrecisionKcal) * policy.targetPrecisionKcal;
      target = current + Math.sign(target - current) * allowed;
      stepLimited = true;
    }
  }

  if (target < policy.neverBelowKcal) return { outcome: "declined", reason: "below_floor" };
  if (current !== null && Math.abs(target - current) < policy.minChangeKcal)
    return { outcome: "declined", reason: "no_change" };

  return {
    outcome: "proposal",
    kind: "maintenance",
    estimateKcal,
    targetKcal: target,
    currentTargetKcal: current,
    stepLimited,
    policyVersion: policy.version,
  };
}

/**
 * Re-checks a pending proposal at accept time. Accepting is refused (and
 * nothing is written) when it expired, the target changed since it was made,
 * or the member no longer qualifies.
 */
export function checkProposalAcceptable(input: {
  proposal: {
    status: string;
    targetKcal: number;
    currentTargetKcal: number | null;
    expiresAt: Date;
  };
  adultConfirmed: boolean;
  currentTargetKcal: number | null;
  now: Date;
  policy?: EnergyProposalPolicy;
}): { ok: true } | { ok: false; reason: ProposalDeclineReason } {
  const policy = input.policy ?? ENERGY_PROPOSAL_POLICY;
  if (input.proposal.status !== "pending") return { ok: false, reason: "not_pending" };
  if (!input.adultConfirmed) return { ok: false, reason: "adults_only" };
  if (input.now.getTime() >= input.proposal.expiresAt.getTime())
    return { ok: false, reason: "expired" };
  if (input.currentTargetKcal !== input.proposal.currentTargetKcal)
    return { ok: false, reason: "target_changed" };
  if (input.proposal.targetKcal < policy.neverBelowKcal)
    return { ok: false, reason: "below_floor" };
  return { ok: true };
}
