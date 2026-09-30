import type { CockpitEngineInput, FreshnessSnapshot, FreshnessStatus } from "./types";

/**
 * Freshness helpers (Issue #16). Mirrors `anchovy/.../lib/v2/cockpit/rules.ts`
 * — pure date math, no DB reads.
 *
 * - `getAgeDays` returns `null` when either timestamp is unparseable,
 *   missing, or in the future relative to `nowIso`.
 * - `classifyFreshness` maps an age to `fresh` / `aging` / `stale` /
 *   `missing` using the `freshDays` / `staleDays` thresholds.
 * - `buildFreshnessSnapshot` composes the two.
 */

export function getAgeDays(nowIso: string, lastIso: string | null): number | null {
  if (lastIso === null) {
    return null;
  }
  const now = Date.parse(nowIso);
  const last = Date.parse(lastIso);
  if (Number.isNaN(now) || Number.isNaN(last) || now < last) {
    return null;
  }
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((now - last) / msPerDay);
}

export function classifyFreshness(
  ageDays: number | null,
  freshDays: number,
  staleDays: number,
): FreshnessStatus {
  if (ageDays === null) {
    return "missing";
  }
  if (ageDays <= freshDays) {
    return "fresh";
  }
  if (ageDays >= staleDays) {
    return "stale";
  }
  return "aging";
}

export function buildFreshnessSnapshot(
  nowIso: string,
  lastIso: string | null,
  freshDays: number,
  staleDays: number,
): FreshnessSnapshot {
  const ageDays = getAgeDays(nowIso, lastIso);
  return {
    status: classifyFreshness(ageDays, freshDays, staleDays),
    ageDays,
  };
}

export function evaluateKeyBlockers(
  input: CockpitEngineInput,
  blood: FreshnessSnapshot,
  workout: FreshnessSnapshot,
): string[] {
  const blockers: string[] = [];
  const seen = new Set<string>();

  const pushBlocker = (blocker: string) => {
    if (seen.has(blocker)) {
      return;
    }
    seen.add(blocker);
    blockers.push(blocker);
  };

  // Caller-supplied blocker flags first, sorted for determinism.
  for (const key of Object.keys(input.blockerFlags).sort()) {
    if (input.blockerFlags[key]) {
      pushBlocker(key);
    }
  }

  if (blood.status === "missing" || blood.status === "stale") {
    pushBlocker("blood_data_stale");
  }

  if (workout.status === "missing" || workout.status === "stale") {
    pushBlocker("workout_data_stale");
  }

  if (input.sleep) {
    if (input.sleep.status === "mild_sleep_debt" || input.sleep.status === "high_sleep_debt") {
      pushBlocker("sleep_debt");
    }
    if (input.sleep.status === "low_confidence" || input.sleep.confidence === "low") {
      pushBlocker("sleep_data_low_confidence");
    }
  }

  return blockers;
}

export function scoreReadiness(blockers: string[]): number {
  if (blockers.includes("blood_data_stale")) {
    return 0;
  }
  if (blockers.length > 0) {
    return 1;
  }
  return 2;
}

export function scoreConfidence(
  blood: FreshnessSnapshot,
  workout: FreshnessSnapshot,
  sleep?: CockpitEngineInput["sleep"],
): number {
  const statuses: FreshnessStatus[] = [blood.status, workout.status];
  if (statuses.includes("missing")) {
    return 0;
  }
  if (statuses.includes("stale")) {
    return 0;
  }
  if (statuses.includes("aging")) {
    return sleep?.confidence === "low" ? 0 : 1;
  }
  if (sleep?.confidence === "low") return 0;
  if (sleep?.confidence === "medium") return 1;
  return 2;
}

export function toReadiness(score: number): "train" | "partial" | "hold" {
  if (score <= 0) return "hold";
  if (score === 1) return "partial";
  return "train";
}

export function toConfidence(score: number): "low" | "medium" | "high" {
  if (score <= 0) return "low";
  if (score === 1) return "medium";
  return "high";
}

/**
 * Reasoning ids surfaced to the API client. Mirrors the anchor
 * `buildReasons` — ordered, with `active_blockers_present` first
 * whenever the blocker list is non-empty.
 */
export function buildReasons(
  blockers: string[],
  blood: FreshnessSnapshot,
  workout: FreshnessSnapshot,
  sleep: CockpitEngineInput["sleep"],
): Array<
  | "active_blockers_present"
  | "blood_data_stale"
  | "workout_data_stale"
  | "sleep_debt"
  | "sleep_data_low_confidence"
> {
  const reasons: Array<
    | "active_blockers_present"
    | "blood_data_stale"
    | "workout_data_stale"
    | "sleep_debt"
    | "sleep_data_low_confidence"
  > = [];
  if (blockers.length > 0) {
    reasons.push("active_blockers_present");
  }
  if (blood.status === "missing" || blood.status === "stale") {
    reasons.push("blood_data_stale");
  }
  if (workout.status === "missing" || workout.status === "stale") {
    reasons.push("workout_data_stale");
  }
  if (sleep) {
    if (blockers.includes("sleep_debt")) {
      reasons.push("sleep_debt");
    }
    if (blockers.includes("sleep_data_low_confidence")) {
      reasons.push("sleep_data_low_confidence");
    }
  }
  return reasons;
}

export const COCKPIT_THRESHOLDS = {
  blood: {
    freshDays: 14,
    staleDays: 30,
  },
  workout: {
    freshDays: 3,
    staleDays: 7,
  },
} as const;
