import { describe, expect, test } from "bun:test";

import { READINESS_ALGORITHM_VERSION, READINESS_PROFILE_INPUTS } from "./score-contract";
import {
  computeReadiness,
  evaluateCheckIn,
  evaluateReadinessInput,
  type DailyValue,
  type ReadinessSeries,
} from "./score-readiness";

const AS_OF = "2026-10-15";

function day(offset: number): string {
  const value = new Date(`${AS_OF}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - offset);
  return value.toISOString().slice(0, 10);
}

/** `value(offset)` for each offset in [from, to] days before AS_OF. */
function series(from: number, to: number, value: (offset: number) => number | null): DailyValue[] {
  const out: DailyValue[] = [];
  for (let offset = to; offset >= from; offset -= 1)
    out.push({ date: day(offset), value: value(offset) });
  return out;
}

const EMPTY: ReadinessSeries = { sleepMinutes: [], restingHeartRate: [], steps: [] };

describe("readiness inputs", () => {
  test("sleep below the personal median lowers its part", () => {
    const sleep = [...series(1, 28, () => 450), { date: AS_OF, value: 405 }];
    const component = evaluateReadinessInput("sleep", sleep, AS_OF);
    expect(component).toMatchObject({
      state: "ready_not_used",
      recentValue: 405,
      recentDate: AS_OF,
      baselineValue: 450,
      baselineDays: 28,
      relativeDifference: -0.1,
      componentScore: 40,
    });
  });

  test("falls back to yesterday's sleep and measures the baseline before it", () => {
    const sleep = series(1, 30, () => 420);
    const component = evaluateReadinessInput("sleep", sleep, AS_OF);
    expect(component.recentDate).toBe(day(1));
    expect(component.baselineDays).toBe(28);
    expect(component.componentScore).toBe(50);
  });

  test("a resting heart rate above usual lowers its part", () => {
    const rhr = [...series(1, 28, () => 60), { date: AS_OF, value: 63 }];
    const component = evaluateReadinessInput("resting_heart_rate", rhr, AS_OF);
    expect(component.relativeDifference).toBe(0.05);
    expect(component.componentScore).toBe(35);
  });

  test("recent activity load uses the last three full days, never today", () => {
    const steps = [
      ...series(4, 31, () => 8000),
      ...series(1, 3, () => 12000),
      { date: AS_OF, value: 50 },
    ];
    const component = evaluateReadinessInput("activity_load", steps, AS_OF);
    expect(component.recentValue).toBe(12000);
    expect(component.recentDays).toBe(3);
    expect(component.recentDate).toBe(day(1));
    expect(component.relativeDifference).toBe(0.5);
    expect(component.componentScore).toBe(25);
  });

  test("component parts are clamped to 0–100", () => {
    const rhr = [...series(1, 28, () => 50), { date: AS_OF, value: 80 }];
    expect(evaluateReadinessInput("resting_heart_rate", rhr, AS_OF).componentScore).toBe(0);
    const sleep = [...series(1, 28, () => 300), { date: AS_OF, value: 600 }];
    expect(evaluateReadinessInput("sleep", sleep, AS_OF).componentScore).toBe(100);
  });

  test("missing days are unknown, not zero", () => {
    const sleep = [
      ...series(1, 28, (offset) => (offset % 2 === 0 ? 450 : null)),
      { date: AS_OF, value: 450 },
    ];
    const component = evaluateReadinessInput("sleep", sleep, AS_OF);
    expect(component.baselineDays).toBe(14);
    expect(component.baselineValue).toBe(450);
    expect(component.componentScore).toBe(50);
  });

  test("too few baseline days withholds the part", () => {
    const sleep = [...series(1, 6, () => 450), { date: AS_OF, value: 400 }];
    const component = evaluateReadinessInput("sleep", sleep, AS_OF);
    expect(component.state).toBe("insufficient_baseline");
    expect(component.baselineDays).toBe(6);
    expect(component.componentScore).toBeNull();
  });

  test("HRV above the personal median raises its part (0.2.0)", () => {
    const hrv = [...series(1, 28, () => 50), { date: AS_OF, value: 55 }];
    const component = evaluateReadinessInput("hrv", hrv, AS_OF);
    expect(component).toMatchObject({
      state: "ready_not_used",
      unit: "ms",
      relativeDifference: 0.1,
      componentScore: 60,
    });
  });

  test("the check-in is today's Mood rating on 0–100, 3 of 5 is 50 (0.2.0)", () => {
    expect(evaluateCheckIn([{ date: AS_OF, value: 1 }], AS_OF).componentScore).toBe(0);
    expect(evaluateCheckIn([{ date: AS_OF, value: 3 }], AS_OF).componentScore).toBe(50);
    expect(evaluateCheckIn([{ date: AS_OF, value: 5 }], AS_OF).componentScore).toBe(100);
    // Two ratings averaged by the tracker: 3.5 → 63.
    expect(evaluateCheckIn([{ date: AS_OF, value: 3.5 }], AS_OF)).toMatchObject({
      state: "ready_not_used",
      unit: "rating",
      recentValue: 3.5,
      recentDate: AS_OF,
      baselineValue: null,
      componentScore: 63,
    });
  });

  test("yesterday's Mood rating or a value off the scale is not today's check-in", () => {
    expect(evaluateCheckIn([{ date: day(1), value: 4 }], AS_OF).state).toBe("no_recent_value");
    expect(evaluateCheckIn([{ date: AS_OF, value: 9 }], AS_OF).state).toBe("no_recent_value");
    expect(evaluateCheckIn([], AS_OF).componentScore).toBeNull();
  });

  test("activity needs steps on at least two of the last three full days", () => {
    const steps = [...series(4, 31, () => 8000), { date: day(2), value: 9000 }];
    const component = evaluateReadinessInput("activity_load", steps, AS_OF);
    expect(component.state).toBe("no_recent_value");
    expect(component.recentDays).toBe(1);
  });
});

describe("computeReadiness", () => {
  const sleep = [...series(1, 28, () => 450), { date: AS_OF, value: 405 }];
  const rhr = [...series(1, 28, () => 60), { date: AS_OF, value: 63 }];
  const steps = [...series(4, 31, () => 8000), ...series(1, 3, () => 8000)];

  test("withholds the score with no data and says what would help", () => {
    const result = computeReadiness(EMPTY, AS_OF);
    expect(result).toMatchObject({
      kind: "readiness",
      experimental: true,
      algorithmVersion: READINESS_ALGORITHM_VERSION,
      status: "withheld",
      score: null,
      profile: null,
      withheldReason: "insufficient_inputs",
      wouldHelp: ["sleep", "resting_heart_rate", "activity_load"],
    });
    expect(result.components.map((c) => [c.input, c.state])).toEqual([
      ["sleep", "no_recent_value"],
      ["resting_heart_rate", "no_recent_value"],
      ["activity_load", "no_recent_value"],
      ["hrv", "no_recent_value"],
      ["check_in", "no_recent_value"],
    ]);
  });

  test("physiology-enhanced profile averages sleep, resting heart rate and activity", () => {
    const result = computeReadiness({ sleepMinutes: sleep, restingHeartRate: rhr, steps }, AS_OF);
    expect(result.status).toBe("available");
    expect(result.profile).toBe("physiology_enhanced");
    // (40 + 35 + 50) / 3
    expect(result.score).toBe(42);
    expect(result.coverage).toEqual({
      profileInputs: ["sleep", "resting_heart_rate", "activity_load", "hrv", "check_in"],
      usedInputs: ["sleep", "resting_heart_rate", "activity_load"],
    });
    expect(result.wouldHelp).toEqual([]);
  });

  test("0.2.0: HRV and today's Mood rating count as optional parts", () => {
    const hrv = [...series(1, 28, () => 50), { date: AS_OF, value: 45 }];
    const result = computeReadiness(
      {
        sleepMinutes: sleep,
        restingHeartRate: rhr,
        steps,
        hrv,
        checkIn: [{ date: AS_OF, value: 4 }],
      },
      AS_OF,
    );
    expect(result.profile).toBe("physiology_enhanced");
    expect(result.coverage.usedInputs).toEqual([
      "sleep",
      "resting_heart_rate",
      "activity_load",
      "hrv",
      "check_in",
    ]);
    // (40 + 35 + 50 + 40 + 75) / 5
    expect(result.score).toBe(48);
    expect(result.components.find((c) => c.input === "hrv")).toMatchObject({
      state: "used",
      unit: "ms",
      recentValue: 45,
      baselineValue: 50,
      componentScore: 40,
    });
  });

  test("0.2.0: HRV or a check-in alone never makes a score appear", () => {
    const hrv = [...series(1, 28, () => 50), { date: AS_OF, value: 50 }];
    const result = computeReadiness({ ...EMPTY, hrv, checkIn: [{ date: AS_OF, value: 3 }] }, AS_OF);
    expect(result.status).toBe("withheld");
    expect(result.wouldHelp).toEqual(["sleep", "resting_heart_rate", "activity_load"]);
    expect(result.components.find((c) => c.input === "check_in")?.state).toBe("ready_not_used");
  });

  test("0.2.0: the manual-friendly profile counts the check-in, not HRV", () => {
    expect(READINESS_PROFILE_INPUTS.manual_friendly.optional).toEqual(["check_in"]);
    const result = computeReadiness(
      { sleepMinutes: sleep, restingHeartRate: [], steps, checkIn: [{ date: AS_OF, value: 2 }] },
      AS_OF,
    );
    expect(result.profile).toBe("manual_friendly");
    // (40 + 50 + 25) / 3
    expect(result.score).toBe(38);
  });

  test("physiology-enhanced profile still scores without the optional activity input", () => {
    const result = computeReadiness(
      { sleepMinutes: sleep, restingHeartRate: rhr, steps: [] },
      AS_OF,
    );
    expect(result.profile).toBe("physiology_enhanced");
    expect(result.score).toBe(38);
    expect(result.coverage.usedInputs).toEqual(["sleep", "resting_heart_rate"]);
    expect(result.wouldHelp).toEqual(["activity_load"]);
  });

  test("manual-friendly profile works without a wearable", () => {
    const result = computeReadiness({ sleepMinutes: sleep, restingHeartRate: [], steps }, AS_OF);
    expect(result.profile).toBe("manual_friendly");
    expect(result.score).toBe(45);
    expect(result.wouldHelp).toEqual(["resting_heart_rate"]);
  });

  test("sleep alone is not enough for either profile", () => {
    const result = computeReadiness(
      { sleepMinutes: sleep, restingHeartRate: [], steps: [] },
      AS_OF,
    );
    expect(result.status).toBe("withheld");
    expect(result.score).toBeNull();
    const sleepComponent = result.components.find((c) => c.input === "sleep");
    expect(sleepComponent?.state).toBe("ready_not_used");
  });

  test("is deterministic", () => {
    const input = { sleepMinutes: sleep, restingHeartRate: rhr, steps };
    expect(computeReadiness(input, AS_OF)).toEqual(computeReadiness(input, AS_OF));
  });
});
