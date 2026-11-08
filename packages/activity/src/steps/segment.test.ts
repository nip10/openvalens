/**
 * Behavioural tests for the `StepAnalysis` segmentation port.
 *
 * Upstream has no tests for `StepAnalysis.java`, so these are written from the
 * source semantics at revision 8976702fc3d00e6008c91fe994668cb4027f7bc2.
 * AGPL-3.0-or-later.
 */

import { describe, expect, test } from "bun:test";

import { detectActivityKind, segment } from "./segment";
import type { MinuteSample } from "./types";

function sample(
  timeSeconds: number,
  steps: number,
  options: {
    intensity?: number;
    heartRate?: number | null;
    distanceCm?: number | null;
  } = {},
): MinuteSample {
  return {
    time: timeSeconds * 1000,
    steps,
    intensity: options.intensity ?? 0,
    heartRate: options.heartRate ?? null,
    distanceCm: options.distanceCm ?? null,
  };
}

describe("active-minute rule", () => {
  test("steps above the threshold are active; the threshold itself is not", () => {
    const atForty = [
      sample(0, 0),
      sample(60, 40),
      sample(120, 40),
      sample(180, 40),
      sample(240, 40),
      sample(300, 40),
    ];
    expect(segment(atForty).sessions).toHaveLength(0);

    const atFortyOne = atForty.map((minute, index) =>
      index === 0 ? minute : sample(index * 60, 41),
    );
    const result = segment(atFortyOne);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.steps).toBe(205);
  });

  test("intensity above the derived gate is active only with at least one step", () => {
    const atPointForty = [
      sample(0, 0),
      sample(60, 1, { intensity: 0.4 }),
      sample(120, 1, { intensity: 0.4 }),
      sample(180, 1, { intensity: 0.4 }),
      sample(240, 1, { intensity: 0.4 }),
      sample(300, 1, { intensity: 0.4 }),
    ];
    expect(segment(atPointForty).sessions).toHaveLength(0);

    const atPointFortyOne = atPointForty.map((minute, index) =>
      index === 0 ? minute : sample(index * 60, 1, { intensity: 0.41 }),
    );
    const result = segment(atPointFortyOne);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.steps).toBe(5);
  });

  test("intensity alone is not active without steps", () => {
    const samples = [
      sample(0, 0),
      sample(60, 0, { intensity: 1 }),
      sample(120, 0, { intensity: 1 }),
      sample(180, 0, { intensity: 1 }),
      sample(240, 0, { intensity: 1 }),
      sample(300, 0, { intensity: 1 }),
    ];
    expect(segment(samples).sessions).toHaveLength(0);
  });
});

describe("session length", () => {
  test("a session must reach the minimum length", () => {
    const tooShort = [sample(0, 0), sample(299, 50)];
    expect(segment(tooShort).sessions).toHaveLength(0);

    const justLongEnough = [sample(0, 0), sample(300, 50)];
    const result = segment(justLongEnough);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.activeDurationSeconds).toBe(300);
  });

  test("trailing idle is excluded from the session length", () => {
    const samples = [
      sample(0, 50),
      sample(60, 50),
      sample(120, 50),
      sample(180, 50),
      sample(240, 50),
      sample(300, 50),
      // Four idle minutes: below the 5-minute split limit.
      sample(360, 0),
      sample(420, 0),
      sample(480, 0),
      sample(540, 0),
    ];

    const session = segment(samples).sessions[0]!;

    expect(session.end).toBe(540_000);
    expect(session.activeDurationSeconds).toBe(300);
    expect(session.ongoing).toBe(true);
  });
});

describe("idle buffering and splitting", () => {
  test("a short break is buffered and re-absorbed", () => {
    const samples = [
      sample(0, 0, { distanceCm: 0 }),
      sample(60, 50, { intensity: 0.1, heartRate: 70, distanceCm: 100 }),
      sample(120, 10, { intensity: 0.1, heartRate: 80, distanceCm: 50 }),
      sample(180, 10, { intensity: 0.1, heartRate: 80, distanceCm: 50 }),
      sample(240, 10, { intensity: 0.1, heartRate: 80, distanceCm: 50 }),
      sample(300, 50, { intensity: 0.1, heartRate: 70, distanceCm: 100 }),
      sample(360, 50, { intensity: 0.1, heartRate: 70, distanceCm: 100 }),
    ];

    const result = segment(samples);
    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0]!;
    // 50 + 50 + 30 buffered + 50.
    expect(session.steps).toBe(180);
    // 100 + 150 buffered + 100 + 100 cm.
    expect(session.distanceMeters).toBeCloseTo(4.5);
    // 70, 70, then three buffered 80s and a final 70.
    expect(session.heartRateAverage).toBe(75);
    expect(session.intensity).toBeCloseTo(0.6);
    expect(session.activeDurationSeconds).toBe(360);
  });

  test("a long idle run splits the session", () => {
    const samples = [
      sample(0, 50, { intensity: 0.1 }),
      sample(60, 50, { intensity: 0.1 }),
      sample(120, 50, { intensity: 0.1 }),
      sample(180, 50, { intensity: 0.1 }),
      sample(240, 50, { intensity: 0.1 }),
      sample(300, 50, { intensity: 0.1 }),
      // Six idle minutes: the fifth reaches the 5-minute limit.
      sample(360, 0),
      sample(420, 0),
      sample(480, 0),
      sample(540, 0),
      sample(600, 0),
      sample(660, 0),
    ];

    const result = segment(samples);
    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0]!;
    expect(session.end).toBe(300_000);
    expect(session.activeDurationSeconds).toBe(300);
    expect(session.steps).toBe(300);
    expect(session.ongoing).toBe(false);
  });
});

describe("workouts", () => {
  test("workout samples are excluded from segmentation but counted in daily totals", () => {
    const samples = Array.from({ length: 11 }, (_, index) =>
      sample(index * 60, 50, { intensity: 0.1 }),
    );

    const withoutWorkout = segment(samples);
    const withWorkout = segment(samples, undefined, [{ start: 120_000, end: 300_000 }]);

    expect(withoutWorkout.totalDailySteps).toBe(550);
    expect(withWorkout.totalDailySteps).toBe(550);
    expect(withoutWorkout.sessions).toHaveLength(1);
    expect(withWorkout.sessions).toHaveLength(1);
    expect(withoutWorkout.sessions[0]!.steps).toBe(550);
    // Three workout minutes (120, 180, 240) at 50 steps each are not segmented.
    expect(withWorkout.sessions[0]!.steps).toBe(400);
  });
});

describe("input handling", () => {
  test("empty input produces no sessions", () => {
    expect(segment([])).toEqual({ sessions: [], totalDailySteps: 0 });
  });

  test("a single sample or a sub-minimum pair produces no session", () => {
    const single = segment([sample(0, 50)]);
    expect(single.sessions).toHaveLength(0);
    expect(single.totalDailySteps).toBe(50);

    const pair = segment([sample(0, 0), sample(100, 50)]);
    expect(pair.sessions).toHaveLength(0);
    expect(pair.totalDailySteps).toBe(50);
  });

  test("unsorted input produces the same result as sorted input", () => {
    const sorted = [
      sample(0, 0),
      sample(60, 50),
      sample(120, 50),
      sample(180, 50),
      sample(240, 50),
      sample(300, 50),
    ];
    const unsorted = [sorted[5]!, sorted[0]!, sorted[3]!, sorted[1]!, sorted[4]!, sorted[2]!];

    expect(segment(unsorted)).toEqual(segment(sorted));
  });
});

describe("session fields and config", () => {
  test("a basic session carries steps, distance, heart rate and intensity", () => {
    const samples = Array.from({ length: 6 }, (_, index) =>
      sample(index * 60, 50, { intensity: 0.1, heartRate: 60, distanceCm: 100 }),
    );

    const result = segment(samples);
    expect(result.totalDailySteps).toBe(300);
    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0]!;
    expect(session).toMatchObject({
      start: 0,
      end: 300_000,
      activeDurationSeconds: 300,
      steps: 300,
      distanceMeters: 6,
      heartRateAverage: 60,
      kind: "walking",
      ongoing: true,
    });
    expect(session.intensity).toBeCloseTo(0.6);
  });

  test("the default step length is upstream's derived 75 cm", () => {
    const samples = Array.from({ length: 6 }, (_, index) =>
      sample(index * 60, 50, { intensity: 0.1 }),
    );

    const session = segment(samples).sessions[0]!;

    // 6 samples × 50 steps × 75 cm = 22,500 cm.
    expect(session.distanceMeters).toBe(225);
  });

  test("stepLengthCm supplies distance when the sample has none", () => {
    const samples = Array.from({ length: 6 }, (_, index) =>
      sample(index * 60, 50, { intensity: 0.1 }),
    );

    const session = segment(samples, { stepLengthCm: 70 }).sessions[0]!;

    // 6 samples × 50 steps × 70 cm = 21,000 cm.
    expect(session.distanceMeters).toBe(210);
  });

  test("minStepsPerMinute is configurable", () => {
    const samples = [
      sample(0, 0),
      sample(60, 20),
      sample(120, 20),
      sample(180, 20),
      sample(240, 20),
      sample(300, 20),
    ];

    expect(segment(samples).sessions).toHaveLength(0);
    const relaxed = segment(samples, { minStepsPerMinute: 10 });
    expect(relaxed.sessions).toHaveLength(1);
    expect(relaxed.sessions[0]!.steps).toBe(100);
  });
});

describe("detectActivityKind", () => {
  const low = { heartRateAverage: 0, intensity: 0 };

  test("running boundary is steps per minute 120/121", () => {
    const at120 = { activeDurationSeconds: 60, steps: 120, ...low };
    const at121 = { activeDurationSeconds: 60, steps: 121, ...low };

    expect(detectActivityKind(at120)).toBe("activity");
    expect(detectActivityKind(at121)).toBe("running");
  });

  test("walking boundary is 200/201 steps", () => {
    const at200 = { activeDurationSeconds: 600, steps: 200, ...low };
    const at201 = { activeDurationSeconds: 600, steps: 201, ...low };

    expect(detectActivityKind(at200)).toBe("activity");
    expect(detectActivityKind(at201)).toBe("walking");
  });

  test("exercise boundary is heart rate 90/91 with intensity above 15", () => {
    const at90 = { activeDurationSeconds: 600, steps: 100, heartRateAverage: 90, intensity: 20 };
    const at91 = { activeDurationSeconds: 600, steps: 100, heartRateAverage: 91, intensity: 20 };

    expect(detectActivityKind(at90)).toBe("activity");
    expect(detectActivityKind(at91)).toBe("exercise");
  });

  test("exercise intensity boundary is 15/15.1", () => {
    const at15 = { activeDurationSeconds: 600, steps: 100, heartRateAverage: 91, intensity: 15 };
    const at15Point1 = {
      activeDurationSeconds: 600,
      steps: 100,
      heartRateAverage: 91,
      intensity: 15.1,
    };

    expect(detectActivityKind(at15)).toBe("activity");
    expect(detectActivityKind(at15Point1)).toBe("exercise");
  });

  test("running and walking take precedence over exercise", () => {
    expect(
      detectActivityKind({
        activeDurationSeconds: 60,
        steps: 121,
        heartRateAverage: 200,
        intensity: 100,
      }),
    ).toBe("running");
    expect(
      detectActivityKind({
        activeDurationSeconds: 600,
        steps: 201,
        heartRateAverage: 100,
        intensity: 20,
      }),
    ).toBe("walking");
  });

  test("zero length does not divide by zero", () => {
    expect(
      detectActivityKind({
        activeDurationSeconds: 0,
        steps: 100,
        heartRateAverage: 0,
        intensity: 0,
      }),
    ).toBe("activity");
  });

  test("the run threshold is configurable", () => {
    expect(
      detectActivityKind(
        { activeDurationSeconds: 60, steps: 100, heartRateAverage: 0, intensity: 0 },
        { minStepsPerMinuteForRun: 50 },
      ),
    ).toBe("running");
  });
});
