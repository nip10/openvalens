/**
 * Deterministic policy-state derivation (Issue #19).
 *
 * Mirrors `anchovy/apps/web/src/lib/v2/coach/derive-policy-state.ts`. Pure —
 * no DB calls. The function maps a `guardrailSummary` (already-derived
 * from cross-domain slices) into a {readiness, blockers, confidence}
 * tuple the AI coach instruction builder consumes.
 *
 * Cross-domain slicing (sleep coach context, weight trend, blood marker
 * out-of-range count) lives in the originating domain packages
 * (`@openhealth/sleep`, `@openhealth/body`, `@openhealth/clinical`).
 * The coach package only consumes their sanitized shapes.
 */

export type CoachReadiness = "hold" | "partial" | "train";
export type CoachConfidence = "low" | "medium" | "high";
export type CoachBlocker =
  | "blood_data_stale"
  | "sleep_debt_high"
  | "sleep_debt_mild"
  | "weight_trend_unstable"
  | string;

export type CoachPolicyState = {
  readiness: CoachReadiness;
  blockers: CoachBlocker[];
  confidence: CoachConfidence;
};

/**
 * Inputs the policy-state derivation accepts. Each block is optional and
 * absent blocks contribute nothing to the derivation — callers can
 * compose from one or many domains.
 */
export type CoachDerivedInputs = {
  /** `null` means we don't have a usable recent blood panel. */
  latestBloodPanelDate: string | null;
  /** Out-of-range marker count from the latest panel. */
  markerOutOfRangeCount: number;
  /** `true` when the 7-day sleep debt is in the high band. */
  highSleepDebt?: boolean;
  /** `true` when the 7-day sleep debt is in the mild band. */
  mildSleepDebt?: boolean;
  /** `true` when the recent weight trend is unstable (rapid shifts). */
  weightTrendUnstable?: boolean;
};

/**
 * Derive a deterministic policy snapshot from a coach guardrail summary.
 *
 * - No blood panel date → `hold` with `blood_data_stale` blocker + low
 *   confidence.
 * - Blood panel present + out-of-range markers → `partial`, no blocker,
 *   medium confidence.
 * - Blood panel present + no out-of-range markers → `train`, no blocker,
 *   medium confidence.
 * - Sleep debt flags add their blocker regardless of blood state.
 * - Weight trend instability adds its blocker on top of readiness.
 *
 * Stable: pure — same inputs return the same output. Deterministic across
 * runs and platforms.
 */
export function derivePolicyState(inputs: CoachDerivedInputs): CoachPolicyState {
  const blockers: CoachBlocker[] = [];
  let confidence: CoachConfidence = "medium";
  let readiness: CoachReadiness;

  if (!inputs.latestBloodPanelDate) {
    blockers.push("blood_data_stale");
    confidence = "low";
    readiness = "hold";
  } else if (inputs.markerOutOfRangeCount > 0) {
    readiness = "partial";
  } else {
    readiness = "train";
  }

  if (inputs.highSleepDebt === true) {
    blockers.push("sleep_debt_high");
  } else if (inputs.mildSleepDebt === true) {
    blockers.push("sleep_debt_mild");
  }

  if (inputs.weightTrendUnstable === true) {
    blockers.push("weight_trend_unstable");
  }

  return {
    readiness,
    blockers: [...blockers].sort(),
    confidence,
  };
}
