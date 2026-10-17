import type { EnergyEstimate } from "./energy-estimate";
import {
  bmiOf,
  calorieFloorKcal,
  estimateRestingKcal,
  kcalPerDayForWeeklyFraction,
  NUTRITION_SAFETY_POLICY,
  type DeclaredSex,
  type EnergyDirection,
  type NutritionSafety,
  type NutritionSafetyPolicy,
} from "./nutrition-safety";

/**
 * Proposal planning for energy targets (Issues #76, #80). Pure and
 * client-safe.
 *
 * An estimate (#76) is information; a proposal is a separate, explicit
 * suggestion to change the member's energy target, and it only takes effect
 * when the member accepts it. Every proposal goes through the versioned
 * nutrition safety policy (`nutrition-safety/v1`, see `nutrition-safety.ts`):
 *
 * - `maintenance` (the default direction) follows the estimate.
 * - `deficit` only when the member chose "lose", is an adult, declared no
 *   exclusion, and has a recent weight and a height for the BMI gate. The
 *   deficit is the default size and never exceeds the hard caps, the target
 *   never goes below the member's floor, and current and projected BMI stay
 *   at or above the gate.
 * - `gain` only when the member chose "gain": a capped surplus.
 * - Never below 1,200 kcal/day under any setting.
 * - Each change moves the target by at most max(200 kcal, 10% of the current
 *   target) and at most one accepted change per 7 days — except that a step
 *   which would itself break a safety limit is replaced by the safe target.
 * - A proposal expires after 7 days and is re-checked on accept.
 *
 * Every proposal row stores the policy version it was made under.
 */

/** Backwards-compatible name: the proposal policy is the nutrition safety policy. */
export const ENERGY_PROPOSAL_POLICY = NUTRITION_SAFETY_POLICY;
export type EnergyProposalPolicy = NutritionSafetyPolicy;

export const ENERGY_PROPOSAL_KINDS = ["maintenance", "deficit", "gain"] as const;
export type EnergyProposalKind = (typeof ENERGY_PROPOSAL_KINDS)[number];

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
  "suggestions_off",
  "not_suggested_for_profile",
  "needs_body_details",
  "needs_confirmation",
] as const;
export type ProposalDeclineReason = (typeof PROPOSAL_DECLINE_REASONS)[number];

export const PROPOSAL_DECLINE_COPY: Readonly<Record<ProposalDeclineReason, string>> = Object.freeze(
  {
    adults_only: "We don't suggest target changes for this profile.",
    no_estimate: "There is no estimate yet, so there is nothing to suggest.",
    below_floor: "We don't suggest a target from this estimate.",
    no_change: "Your current target is already close to the suggestion.",
    recently_changed: "Your target changed in the last 7 days. Suggestions resume after that.",
    expired: "This suggestion is more than 7 days old. Ask for a new one.",
    target_changed: "Your target changed after this suggestion was made. Ask for a new one.",
    not_pending: "This suggestion was already accepted, dismissed or replaced.",
    suggestions_off: "We don't make energy suggestions for this profile.",
    not_suggested_for_profile: "We don't suggest reductions for this profile.",
    needs_body_details:
      "Reduction suggestions need a recent weight and your height in nutrition settings.",
    needs_confirmation: "This suggestion needs your confirmation before it is applied.",
  },
);

export const PROPOSAL_COPY = Object.freeze({
  maintenance:
    "Suggested target: the estimated intake that would keep your weight trend steady. Nothing changes unless you accept.",
  deficit:
    "Suggested target: a small, capped reduction from the estimated intake, as you asked. Nothing changes unless you accept.",
  gain: "Suggested target: a small, capped increase from the estimated intake, as you asked. Nothing changes unless you accept.",
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

/** Body details the safety checks use; every field may be unknown. */
export type ProposalBody = {
  /** Latest weight-trend value (kg), or `null`. */
  weightKg: number | null;
  /** Self-declared height (cm), or `null`. */
  heightCm: number | null;
  sex: DeclaredSex;
  /** Youngest / oldest possible age from the profile, or `null`. */
  minAge: number | null;
  maxAge: number | null;
};

export const UNKNOWN_BODY: ProposalBody = Object.freeze({
  weightKg: null,
  heightCm: null,
  sex: null,
  minAge: null,
  maxAge: null,
});

export type EnergyProposalPlan =
  | {
      outcome: "proposal";
      kind: EnergyProposalKind;
      estimateKcal: number;
      targetKcal: number;
      currentTargetKcal: number | null;
      stepLimited: boolean;
      /** A reduction under a soft gate: accepting needs an explicit confirmation. */
      needsConfirmation: boolean;
      policyVersion: EnergyProposalPolicy["version"];
    }
  | { outcome: "declined"; reason: ProposalDeclineReason };

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** The limits a target of `kind` must meet for `estimateKcal` and `body`. */
export type SafetyLimits = {
  kind: EnergyProposalKind;
  estimateKcal: number;
  /** Lowest allowed target (kcal/day). */
  minTargetKcal: number;
  /** Highest allowed target for a gain (kcal/day), else `null`. */
  maxTargetKcal: number | null;
  /** For a deficit: lowest target whose projected BMI stays at or above the gate, else `null`. */
  minTargetForBmiKcal: number | null;
};

/** The largest reduction allowed (kcal/day): the hard caps, tighter at 65+. */
export function maxDeficitKcal(
  estimateKcal: number,
  body: ProposalBody,
  policy: EnergyProposalPolicy = ENERGY_PROPOSAL_POLICY,
): number {
  const older = body.maxAge !== null && body.maxAge >= policy.olderAdult.fromAge;
  const weekly = older
    ? Math.min(policy.deficit.hardMaxWeeklyLossFraction, policy.olderAdult.maxWeeklyLossFraction)
    : policy.deficit.hardMaxWeeklyLossFraction;
  const caps = [
    policy.deficit.hardMaxKcal,
    policy.deficit.hardMaxFractionOfEstimate * estimateKcal,
  ];
  if (body.weightKg !== null) caps.push(kcalPerDayForWeeklyFraction(body.weightKg, weekly, policy));
  return Math.min(...caps);
}

/** The default reduction (kcal/day): the smallest of the defaults and the hard caps. */
export function defaultDeficitKcal(
  estimateKcal: number,
  body: ProposalBody,
  policy: EnergyProposalPolicy = ENERGY_PROPOSAL_POLICY,
): number {
  const caps = [
    policy.deficit.defaultMaxKcal,
    policy.deficit.defaultMaxFractionOfEstimate * estimateKcal,
    maxDeficitKcal(estimateKcal, body, policy),
  ];
  if (body.weightKg !== null)
    caps.push(
      kcalPerDayForWeeklyFraction(
        body.weightKg,
        policy.deficit.defaultMaxWeeklyLossFraction,
        policy,
      ),
    );
  return Math.min(...caps);
}

/** The largest surplus allowed (kcal/day). */
export function maxSurplusKcal(
  estimateKcal: number,
  body: ProposalBody,
  policy: EnergyProposalPolicy = ENERGY_PROPOSAL_POLICY,
): number {
  const caps = [policy.gain.maxFractionOfEstimate * estimateKcal];
  if (body.weightKg !== null)
    caps.push(
      kcalPerDayForWeeklyFraction(body.weightKg, policy.gain.maxWeeklyGainFraction, policy),
    );
  return Math.min(...caps);
}

/** True when `targetKcal` meets every safety limit for `kind` (step size is separate). */
export function isSafeTarget(
  targetKcal: number,
  kind: EnergyProposalKind,
  estimateKcal: number,
  body: ProposalBody,
  policy: EnergyProposalPolicy = ENERGY_PROPOSAL_POLICY,
): boolean {
  if (targetKcal < policy.neverBelowKcal) return false;
  if (kind === "gain")
    return targetKcal - estimateKcal <= maxSurplusKcal(estimateKcal, body, policy);
  if (kind === "maintenance") return true;
  // Deficit: floor, cap and BMI (current and projected) must all hold.
  if (body.weightKg === null || body.heightCm === null) return false;
  const floor = calorieFloorKcal({ sex: body.sex, restingKcal: estimateRestingKcal(body) }, policy);
  if (targetKcal < floor) return false;
  const deficit = estimateKcal - targetKcal;
  if (deficit > maxDeficitKcal(estimateKcal, body, policy)) return false;
  if (bmiOf(body.weightKg, body.heightCm) < policy.bmi.underweightBelow) return false;
  const projectedKg =
    body.weightKg -
    (Math.max(0, deficit) * 7 * policy.bmi.projectionWeeks) / policy.energyDensityKcalPerKg;
  return bmiOf(projectedKg, body.heightCm) >= policy.bmi.underweightBelow;
}

/**
 * Decides whether a proposal can be made from `estimate`, and for which
 * target. Never touches a goal: callers persist the plan as a pending
 * proposal for the member to review.
 */
export function planEnergyProposal(input: {
  estimate: Pick<EnergyEstimate, "status" | "estimate">;
  adultConfirmed: boolean;
  currentTargetKcal: number | null;
  lastAcceptedAt: Date | null;
  now: Date;
  /** The member's chosen direction; defaults to maintain. */
  direction?: EnergyDirection;
  /** The evaluated safety state; absent means suggestions are available and no exclusion is declared. */
  safety?: Pick<NutritionSafety, "energySuggestions" | "reductionSuggestions" | "softGates">;
  body?: ProposalBody;
  policy?: EnergyProposalPolicy;
}): EnergyProposalPlan {
  const policy = input.policy ?? ENERGY_PROPOSAL_POLICY;
  const direction = input.direction ?? policy.defaultDirection;
  const body = input.body ?? UNKNOWN_BODY;
  const safety = input.safety ?? {
    energySuggestions: "available",
    reductionSuggestions: "available",
    softGates: [],
  };
  if (!input.adultConfirmed) return { outcome: "declined", reason: "adults_only" };
  if (safety.energySuggestions === "off") return { outcome: "declined", reason: "suggestions_off" };
  if (input.estimate.status !== "estimated" || !input.estimate.estimate)
    return { outcome: "declined", reason: "no_estimate" };
  if (
    input.lastAcceptedAt &&
    input.now.getTime() - input.lastAcceptedAt.getTime() <
      policy.step.minDaysBetweenChanges * 86_400_000
  )
    return { outcome: "declined", reason: "recently_changed" };

  const estimateKcal = input.estimate.estimate.kcalPerDay;
  const precision = policy.targetPrecisionKcal;
  let kind: EnergyProposalKind = "maintenance";
  let desired = roundTo(estimateKcal, precision);
  if (direction === "lose") {
    if (safety.reductionSuggestions === "off")
      return { outcome: "declined", reason: "not_suggested_for_profile" };
    if (body.weightKg === null || body.heightCm === null)
      return { outcome: "declined", reason: "needs_body_details" };
    if (bmiOf(body.weightKg, body.heightCm) < policy.bmi.underweightBelow)
      return { outcome: "declined", reason: "not_suggested_for_profile" };
    kind = "deficit";
    // Round towards the estimate so rounding never enlarges the deficit.
    desired =
      Math.ceil((estimateKcal - defaultDeficitKcal(estimateKcal, body, policy)) / precision) *
      precision;
    if (desired >= estimateKcal) return { outcome: "declined", reason: "no_change" };
    if (!isSafeTarget(desired, kind, estimateKcal, body, policy))
      return {
        outcome: "declined",
        reason: desired < policy.neverBelowKcal ? "below_floor" : "not_suggested_for_profile",
      };
  } else if (direction === "gain") {
    kind = "gain";
    const surplus = Math.min(
      policy.gain.aimFractionOfEstimate * estimateKcal,
      maxSurplusKcal(estimateKcal, body, policy),
    );
    // Round towards the estimate so rounding never enlarges the surplus.
    desired = Math.floor((estimateKcal + surplus) / precision) * precision;
    if (desired <= estimateKcal) return { outcome: "declined", reason: "no_change" };
  }

  const current = input.currentTargetKcal;
  let target = desired;
  let stepLimited = false;
  if (current !== null) {
    const step = Math.max(policy.step.maxKcal, policy.step.maxFraction * current);
    if (Math.abs(desired - current) > step) {
      // Whole precision steps only, so rounding never exceeds the step limit.
      const allowed = Math.floor(step / precision) * precision;
      const stepped = current + Math.sign(desired - current) * allowed;
      // Safety beats the weekly step: an unsafe intermediate step jumps to the safe target.
      if (isSafeTarget(stepped, kind, estimateKcal, body, policy)) {
        target = stepped;
        stepLimited = true;
      }
    }
  }

  if (target < policy.neverBelowKcal) return { outcome: "declined", reason: "below_floor" };
  if (current !== null && Math.abs(target - current) < policy.minChangeKcal)
    return { outcome: "declined", reason: "no_change" };

  return {
    outcome: "proposal",
    kind,
    estimateKcal,
    targetKcal: target,
    currentTargetKcal: current,
    stepLimited,
    needsConfirmation: kind === "deficit" && safety.softGates.length > 0,
    policyVersion: policy.version,
  };
}

/**
 * Re-checks a pending proposal at accept time. Accepting is refused (and
 * nothing is written) when it expired, the target changed since it was made,
 * the member no longer qualifies (including a newly declared exclusion), or
 * a reduction under a soft gate was not explicitly confirmed.
 */
export function checkProposalAcceptable(input: {
  proposal: {
    status: string;
    kind?: string;
    targetKcal: number;
    currentTargetKcal: number | null;
    expiresAt: Date;
  };
  adultConfirmed: boolean;
  currentTargetKcal: number | null;
  now: Date;
  safety?: Pick<NutritionSafety, "energySuggestions" | "reductionSuggestions" | "softGates">;
  /** The member ticked the extra confirmation. */
  confirmed?: boolean;
  policy?: EnergyProposalPolicy;
}): { ok: true } | { ok: false; reason: ProposalDeclineReason } {
  const policy = input.policy ?? ENERGY_PROPOSAL_POLICY;
  const safety = input.safety;
  if (input.proposal.status !== "pending") return { ok: false, reason: "not_pending" };
  if (!input.adultConfirmed) return { ok: false, reason: "adults_only" };
  if (safety?.energySuggestions === "off") return { ok: false, reason: "suggestions_off" };
  if (input.now.getTime() >= input.proposal.expiresAt.getTime())
    return { ok: false, reason: "expired" };
  if (input.currentTargetKcal !== input.proposal.currentTargetKcal)
    return { ok: false, reason: "target_changed" };
  if (input.proposal.targetKcal < policy.neverBelowKcal)
    return { ok: false, reason: "below_floor" };
  if (input.proposal.kind === "deficit") {
    if (safety?.reductionSuggestions !== "available")
      return { ok: false, reason: "not_suggested_for_profile" };
    if (safety.softGates.length > 0 && input.confirmed !== true)
      return { ok: false, reason: "needs_confirmation" };
  }
  return { ok: true };
}
