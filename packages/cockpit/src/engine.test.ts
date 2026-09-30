import { describe, expect, test } from "bun:test";

import { applyRules, deriveCockpitState, projectEngineInput } from "./engine";
import type { CockpitRule } from "./types";
import {
  buildFreshnessSnapshot,
  classifyFreshness,
  evaluateKeyBlockers,
  getAgeDays,
  scoreConfidence,
  scoreReadiness,
  toConfidence,
  toReadiness,
} from "./freshness";

describe("cockpit — freshness helpers", () => {
  test("getAgeDays returns null for missing, invalid, or future timestamps", () => {
    expect(getAgeDays("2026-03-08T00:00:00.000Z", null)).toBeNull();
    expect(getAgeDays("2026-03-08T00:00:00.000Z", "bad-date")).toBeNull();
    expect(getAgeDays("2026-03-08T00:00:00.000Z", "2026-03-09T00:00:00.000Z")).toBeNull();
  });

  test("getAgeDays returns integer day delta for valid timestamps", () => {
    expect(getAgeDays("2026-03-08T00:00:00.000Z", "2026-03-01T00:00:00.000Z")).toBe(7);
  });

  test("classifyFreshness maps age days to status bands", () => {
    expect(classifyFreshness(null, 14, 30)).toBe("missing");
    expect(classifyFreshness(0, 14, 30)).toBe("fresh");
    expect(classifyFreshness(14, 14, 30)).toBe("fresh");
    expect(classifyFreshness(15, 14, 30)).toBe("aging");
    expect(classifyFreshness(30, 14, 30)).toBe("stale");
    expect(classifyFreshness(45, 14, 30)).toBe("stale");
  });

  test("buildFreshnessSnapshot composes age + status", () => {
    const snap = buildFreshnessSnapshot(
      "2026-03-08T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
      14,
      30,
    );
    expect(snap).toEqual({ status: "fresh", ageDays: 7 });
  });

  test("evaluateKeyBlockers adds blood_data_stale and workout_data_stale canonical blockers", () => {
    const blood = buildFreshnessSnapshot("2026-03-08T00:00:00.000Z", null, 14, 30);
    const workout = buildFreshnessSnapshot(
      "2026-03-08T00:00:00.000Z",
      "2026-03-07T00:00:00.000Z",
      3,
      7,
    );
    const blockers = evaluateKeyBlockers(
      {
        nowIso: "2026-03-08T00:00:00.000Z",
        lastBloodPanelIso: null,
        lastWorkoutIso: "2026-03-07T00:00:00.000Z",
        blockerFlags: {},
      },
      blood,
      workout,
    );
    expect(blockers).toEqual(["blood_data_stale"]);
    expect(blockers).toEqual(["blood_data_stale"]);
  });

  test("scoreReadiness returns 0 on blood_data_stale, 1 with any blocker, 2 clean", () => {
    expect(scoreReadiness(["blood_data_stale"])).toBe(0);
    expect(scoreReadiness(["injury"])).toBe(1);
    expect(scoreReadiness([])).toBe(2);
  });

  test("scoreConfidence returns 0 on missing/stale, 1 on aging without low sleep, 2 clean", () => {
    const fresh = buildFreshnessSnapshot(
      "2026-03-08T00:00:00.000Z",
      "2026-03-07T00:00:00.000Z",
      14,
      30,
    );
    const aging = buildFreshnessSnapshot(
      "2026-03-08T00:00:00.000Z",
      "2026-02-21T00:00:00.000Z",
      14,
      30,
    );
    const missing = buildFreshnessSnapshot("2026-03-08T00:00:00.000Z", null, 14, 30);
    expect(scoreConfidence(fresh, fresh)).toBe(2);
    expect(scoreConfidence(aging, fresh)).toBe(1);
    expect(scoreConfidence(missing, fresh)).toBe(0);
    expect(
      scoreConfidence(aging, fresh, {
        status: "acceptable",
        confidence: "low",
        lastNightMinutes: 420,
        sevenDayAverageMinutes: 420,
        averageSleepDebtMinutes: 30,
      }),
    ).toBe(0);
  });

  test("toReadiness / toConfidence map scores to enums", () => {
    expect(toReadiness(0)).toBe("hold");
    expect(toReadiness(1)).toBe("partial");
    expect(toReadiness(2)).toBe("train");
    expect(toConfidence(0)).toBe("low");
    expect(toConfidence(1)).toBe("medium");
    expect(toConfidence(2)).toBe("high");
  });
});

describe("cockpit — deriveCockpitState", () => {
  test("returns deterministic readiness / blockers / confidence / rationale", () => {
    const state = deriveCockpitState({
      nowIso: "2026-03-08T00:00:00.000Z",
      lastBloodPanelIso: "2026-03-01T00:00:00.000Z",
      lastWorkoutIso: "2026-02-28T00:00:00.000Z",
      blockerFlags: {
        sleep_debt: true,
        illness: false,
      },
    });
    expect(state.readiness).toBe("partial");
    expect(state.confidence).toBe("low");
    expect(state.blockers).toEqual(["sleep_debt", "workout_data_stale"]);
    expect(state.rationale.freshness.blood).toEqual({ status: "fresh", ageDays: 7 });
    expect(state.rationale.freshness.workout).toEqual({ status: "stale", ageDays: 8 });
  });

  test("treats missing or invalid timestamps as missing freshness", () => {
    const invalid = deriveCockpitState({
      nowIso: "2026-03-08T00:00:00.000Z",
      lastBloodPanelIso: "bad-date",
      lastWorkoutIso: "also-bad-date",
      blockerFlags: {},
    });
    expect(invalid.rationale.freshness.blood.status).toBe("missing");
    expect(invalid.rationale.freshness.workout.status).toBe("missing");
    expect(invalid.blockers).toEqual(["blood_data_stale", "workout_data_stale"]);
    expect(invalid.confidence).toBe("low");

    const future = deriveCockpitState({
      nowIso: "2026-03-08T00:00:00.000Z",
      lastBloodPanelIso: "2026-03-09T00:00:00.000Z",
      lastWorkoutIso: "2026-03-10T00:00:00.000Z",
      blockerFlags: {},
    });
    expect(future.rationale.freshness.blood.status).toBe("missing");
    expect(future.rationale.freshness.workout.status).toBe("missing");
  });

  test("deterministic blocker list regardless of input key order", () => {
    const first = deriveCockpitState({
      nowIso: "2026-03-08T00:00:00.000Z",
      lastBloodPanelIso: "2026-03-01T00:00:00.000Z",
      lastWorkoutIso: "2026-03-07T00:00:00.000Z",
      blockerFlags: { injury: true, sleep_debt: true },
    });
    const second = deriveCockpitState({
      nowIso: "2026-03-08T00:00:00.000Z",
      lastBloodPanelIso: "2026-03-01T00:00:00.000Z",
      lastWorkoutIso: "2026-03-07T00:00:00.000Z",
      blockerFlags: { sleep_debt: true, injury: true },
    });
    expect(first.blockers).toEqual(["injury", "sleep_debt"]);
    expect(second.blockers).toEqual(["injury", "sleep_debt"]);
  });

  test("is deterministic across repeated calls", () => {
    const input: import("./types").CockpitEngineInput = {
      nowIso: "2026-03-08T00:00:00.000Z",
      lastBloodPanelIso: "2026-03-07T00:00:00.000Z",
      lastWorkoutIso: "2026-03-07T00:00:00.000Z",
      blockerFlags: {},
      sleep: {
        status: "high_sleep_debt",
        confidence: "high",
        lastNightMinutes: 360,
        sevenDayAverageMinutes: 390,
        averageSleepDebtMinutes: 120,
      },
    };
    expect(deriveCockpitState(input)).toEqual(deriveCockpitState(input));
  });

  test("preserves confidence when sleep input is absent", () => {
    const state = deriveCockpitState({
      nowIso: "2026-03-08T00:00:00.000Z",
      lastBloodPanelIso: "2026-03-07T00:00:00.000Z",
      lastWorkoutIso: "2026-03-07T00:00:00.000Z",
      blockerFlags: {},
    });
    expect(state.confidence).toBe("high");
  });
});

describe("cockpit — applyRules", () => {
  const sampleInput = {
    nowIso: "2026-03-08T00:00:00.000Z",
    lastBloodPanelIso: "2026-03-07T00:00:00.000Z",
    lastWorkoutIso: "2026-03-07T00:00:00.000Z",
    blockerFlags: {},
  };

  test("adds each rule's blocker to the engine input", () => {
    const hasWorkoutsThisWeek: CockpitRule = () => "no_workouts_this_week";
    const hasGoalCheckin: CockpitRule = () => "no_recent_goal_checkin";
    const noop: CockpitRule = () => null;

    const state = applyRules([hasWorkoutsThisWeek, hasGoalCheckin, noop], sampleInput);
    expect(state.blockers).toEqual(["no_recent_goal_checkin", "no_workouts_this_week"]);
  });

  test("preserves caller-supplied blocker flags and merges deterministically", () => {
    const ruleInjury: CockpitRule = () => "injury";
    const state = applyRules([ruleInjury], {
      ...sampleInput,
      blockerFlags: { sleep_debt: true, illness: true },
    });
    expect(state.blockers).toEqual(["illness", "injury", "sleep_debt"]);
  });

  test("does not mutate the input", () => {
    const rule: CockpitRule = () => "leaked";
    applyRules([rule], sampleInput);
    expect(sampleInput.blockerFlags).toEqual({});
  });
});

describe("cockpit — projectEngineInput", () => {
  test("fills missing fields with deterministic defaults", () => {
    const projected = projectEngineInput({ nowIso: "2026-03-08T00:00:00.000Z" });
    expect(projected.lastBloodPanelIso).toBeNull();
    expect(projected.lastWorkoutIso).toBeNull();
    expect(projected.blockerFlags).toEqual({});
    expect(projected.sleep).toBeUndefined();
  });
});
