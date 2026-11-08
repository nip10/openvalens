/**
 * Behavioural tests for the `StepAnalysis` summary port.
 *
 * Upstream has no tests for `calculateSummary`; these are written from the
 * source semantics at revision 8976702fc3d00e6008c91fe994668cb4027f7bc2.
 * AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import { summarize } from "./summary";
import type { StepSession } from "./types";

function session(overrides: Partial<StepSession> = {}): StepSession {
  return {
    start: 0,
    end: 600_000,
    activeDurationSeconds: 600,
    steps: 100,
    distanceMeters: 0,
    heartRateAverage: 0,
    intensity: 0,
    kind: "activity",
    ongoing: false,
    ...overrides,
  };
}

test("summarize aggregates duration, steps, distance, heart rate and intensity", () => {
  const first = session({
    start: 0,
    end: 600_000,
    steps: 100,
    distanceMeters: 10.9,
    heartRateAverage: 80,
    intensity: 5,
  });
  const second = session({
    start: 1_000_000,
    end: 1_300_000,
    steps: 50,
    distanceMeters: 20.9,
    heartRateAverage: 100,
    intensity: 3,
  });

  const summary = summarize([first, second], 400);

  expect(summary).toEqual({
    sessionCount: 2,
    durationSeconds: 900,
    steps: 150,
    // Java `int += float` truncates after each addition: 10.9 -> 10, then 30.9 -> 30.
    distanceMeters: 30,
    heartRateAverage: 90,
    intensity: 8,
    totalDailySteps: 400,
  });
});

test("an empty day summarizes to zeroes but keeps the daily step total", () => {
  expect(summarize([], 123)).toEqual({
    sessionCount: 0,
    durationSeconds: 0,
    steps: 0,
    distanceMeters: 0,
    heartRateAverage: 0,
    intensity: 0,
    totalDailySteps: 123,
  });
});

test("heart-rate averaging includes sessions with no heart rate", () => {
  const summary = summarize(
    [session({ heartRateAverage: 0 }), session({ heartRateAverage: 100 })],
    0,
  );

  expect(summary.heartRateAverage).toBe(50);
});
