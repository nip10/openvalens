import {
  buildFreshnessSnapshot,
  buildReasons,
  COCKPIT_THRESHOLDS,
  evaluateKeyBlockers,
  scoreConfidence,
  scoreReadiness,
  toConfidence,
  toReadiness,
} from "./freshness";
import type {
  CockpitBlockerFlags,
  CockpitEngineInput,
  CockpitRule,
  CockpitSleepInput,
  CockpitState,
} from "./types";

/**
 * Compute the deterministic cockpit state. Mirrors
 * `anchovy/.../lib/v2/cockpit/engine.ts#computeCockpitState` — pure,
 * no DB calls.
 */
export function deriveCockpitState(input: CockpitEngineInput): CockpitState {
  const blood = buildFreshnessSnapshot(
    input.nowIso,
    input.lastBloodPanelIso,
    COCKPIT_THRESHOLDS.blood.freshDays,
    COCKPIT_THRESHOLDS.blood.staleDays,
  );
  const workout = buildFreshnessSnapshot(
    input.nowIso,
    input.lastWorkoutIso,
    COCKPIT_THRESHOLDS.workout.freshDays,
    COCKPIT_THRESHOLDS.workout.staleDays,
  );

  const blockers = evaluateKeyBlockers(input, blood, workout);
  const readinessScore = scoreReadiness(blockers);
  const confidenceScore = scoreConfidence(blood, workout, input.sleep);

  return {
    readiness: toReadiness(readinessScore),
    blockers,
    confidence: toConfidence(confidenceScore),
    rationale: {
      freshness: { blood, workout },
      sleep: input.sleep,
      scores: { readiness: readinessScore, confidence: confidenceScore },
      reasons: buildReasons(blockers, blood, workout, input.sleep),
    },
  };
}

/**
 * Apply a list of `CockpitRule` predicates to the engine input.
 * Each rule either contributes nothing (`null`) or a blocker id; the
 * resulting blocker bag is merged into a sorted, de-duplicated list
 * which is then used as the `blockerFlags` for `deriveCockpitState`.
 *
 * Pure — the engine input is not mutated. Mirrors the anchor rule
 * pattern: rules are small predicates the cockpit composes.
 */
export function applyRules(
  rules: ReadonlyArray<CockpitRule>,
  input: CockpitEngineInput,
): CockpitState {
  const merged: CockpitBlockerFlags = { ...input.blockerFlags };
  for (const rule of rules) {
    const blocker = rule(input);
    if (blocker !== null) {
      merged[blocker] = true;
    }
  }
  return deriveCockpitState({ ...input, blockerFlags: merged });
}

/**
 * Build the canonical "ready-to-evaluate" cockpit input from the
 * cockpit-shaped slices each domain already publishes. Anchovy wraps
 * the same kind of projection in `lib/dashboard/today-data.ts`;
 * openhealth keeps the projection here so the cockpit owns its own
 * deterministic boundary.
 */
export function projectEngineInput(params: {
  nowIso: string;
  lastBloodPanelIso?: string | null;
  lastWorkoutIso?: string | null;
  sleep?: CockpitSleepInput;
  blockerFlags?: CockpitBlockerFlags;
}): CockpitEngineInput {
  return {
    nowIso: params.nowIso,
    lastBloodPanelIso: params.lastBloodPanelIso ?? null,
    lastWorkoutIso: params.lastWorkoutIso ?? null,
    blockerFlags: params.blockerFlags ?? {},
    sleep: params.sleep,
  };
}
