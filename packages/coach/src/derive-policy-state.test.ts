import { describe, expect, test } from "bun:test";

import { derivePolicyState } from "./derive-policy-state";

describe("coach — derivePolicyState", () => {
  test("returns hold / low / blood_data_stale when no blood panel date", () => {
    const state = derivePolicyState({
      latestBloodPanelDate: null,
      markerOutOfRangeCount: 0,
    });
    expect(state).toEqual({
      readiness: "hold",
      blockers: ["blood_data_stale"],
      confidence: "low",
    });
  });

  test("returns partial / medium when markers are out of range with a recent panel", () => {
    const state = derivePolicyState({
      latestBloodPanelDate: "2026-03-01",
      markerOutOfRangeCount: 2,
    });
    expect(state).toEqual({
      readiness: "partial",
      blockers: [],
      confidence: "medium",
    });
  });

  test("returns train / medium when blood is fresh and markers are in range", () => {
    const state = derivePolicyState({
      latestBloodPanelDate: "2026-03-01",
      markerOutOfRangeCount: 0,
    });
    expect(state).toEqual({
      readiness: "train",
      blockers: [],
      confidence: "medium",
    });
  });

  test("adds sleep_debt_high blocker when high sleep debt is reported", () => {
    const state = derivePolicyState({
      latestBloodPanelDate: "2026-03-01",
      markerOutOfRangeCount: 0,
      highSleepDebt: true,
    });
    expect(state.blockers).toContain("sleep_debt_high");
    expect(state.readiness).toBe("train");
  });

  test("adds sleep_debt_mild (not high) when only mild debt is reported", () => {
    const state = derivePolicyState({
      latestBloodPanelDate: "2026-03-01",
      markerOutOfRangeCount: 0,
      mildSleepDebt: true,
    });
    expect(state.blockers).toEqual(["sleep_debt_mild"]);
  });

  test("adds weight_trend_unstable when recent weight is volatile", () => {
    const state = derivePolicyState({
      latestBloodPanelDate: "2026-03-01",
      markerOutOfRangeCount: 0,
      weightTrendUnstable: true,
    });
    expect(state.blockers).toEqual(["weight_trend_unstable"]);
  });

  test("sorts blockers deterministically", () => {
    const state = derivePolicyState({
      latestBloodPanelDate: null,
      markerOutOfRangeCount: 1,
      weightTrendUnstable: true,
      mildSleepDebt: true,
    });
    expect(state.blockers).toEqual([
      "blood_data_stale",
      "sleep_debt_mild",
      "weight_trend_unstable",
    ]);
  });

  test("is deterministic across repeated calls", () => {
    const inputs = {
      latestBloodPanelDate: "2026-03-01",
      markerOutOfRangeCount: 1,
      highSleepDebt: true,
      weightTrendUnstable: true,
    };
    expect(derivePolicyState(inputs)).toEqual(derivePolicyState(inputs));
  });
});
