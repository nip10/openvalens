import assert from "node:assert/strict";
import test from "node:test";

import { buildSleepCoachContext } from "./coach-context";
import type { SleepWindowSummary } from "./types";

test("buildSleepCoachContext maps mild sleep debt to avoid_max_effort_training", () => {
  const summary: SleepWindowSummary = {
    days: [],
    lastNight: null,
    sevenDayAverageMinutes: 408,
    averageSleepDebtMinutes: 52,
    status: "mild_sleep_debt",
    confidence: "medium",
  };

  assert.deepEqual(buildSleepCoachContext(summary), {
    lastNightMinutes: null,
    sevenDayAverageMinutes: 408,
    sleepDebtMinutesPerDay: 52,
    status: "mild_sleep_debt",
    confidence: "medium",
    recommendedConstraint: "avoid_max_effort_training",
  });
});

test("buildSleepCoachContext maps high sleep debt to prioritize_recovery", () => {
  const summary: SleepWindowSummary = {
    days: [],
    lastNight: {
      asleepMinutes: 300,
      mainSleepAsleepMinutes: 300,
    } as SleepWindowSummary["lastNight"],
    sevenDayAverageMinutes: 390,
    averageSleepDebtMinutes: 132,
    status: "high_sleep_debt",
    confidence: "high",
  };

  assert.equal(buildSleepCoachContext(summary).recommendedConstraint, "prioritize_recovery");
});

test("buildSleepCoachContext maps fragmented sleep to avoid_max_effort_training", () => {
  const summary: SleepWindowSummary = {
    days: [],
    lastNight: {
      asleepMinutes: 360,
      mainSleepAsleepMinutes: 360,
    } as SleepWindowSummary["lastNight"],
    sevenDayAverageMinutes: 375,
    averageSleepDebtMinutes: 90,
    status: "fragmented_sleep",
    confidence: "medium",
  };

  assert.equal(buildSleepCoachContext(summary).recommendedConstraint, "avoid_max_effort_training");
});

test("buildSleepCoachContext leaves optimal sleep unconstrained", () => {
  const summary: SleepWindowSummary = {
    days: [],
    lastNight: {
      asleepMinutes: 480,
      mainSleepAsleepMinutes: 480,
    } as SleepWindowSummary["lastNight"],
    sevenDayAverageMinutes: 480,
    averageSleepDebtMinutes: 0,
    status: "optimal",
    confidence: "high",
  };

  assert.equal(buildSleepCoachContext(summary).recommendedConstraint, null);
});
