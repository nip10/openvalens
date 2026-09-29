import assert from "node:assert/strict";
import test from "node:test";

import { scoreSleepSummary, summarizeSleepWindow } from "./scoring";
import type { SleepDailySummary } from "./types";

test("scoreSleepSummary optimal exact deep/rem/light stage data returns qualityScore 100/high/optimal", () => {
  const result = scoreSleepSummary({
    asleepMinutes: 480,
    sleepDebtMinutes: 0,
    sleepEfficiencyPct: 92,
    deepMinutes: 90,
    remMinutes: 90,
    lightMinutes: 300,
    unknownStageMinutes: 0,
    interruptionsCount: 0,
    targetMinutes: 480,
  });

  assert.deepEqual(result, { qualityScore: 100, confidence: "high", status: "optimal" });
});

test("scoreSleepSummary does not treat unknown-only stage data as optimal or high confidence", () => {
  const result = scoreSleepSummary({
    asleepMinutes: 480,
    sleepDebtMinutes: 0,
    sleepEfficiencyPct: 100,
    deepMinutes: 0,
    remMinutes: 0,
    lightMinutes: 0,
    unknownStageMinutes: 480,
    interruptionsCount: 0,
    targetMinutes: 480,
  });

  assert.equal(result.confidence === "high", false);
  assert.equal(result.status === "optimal", false);
  assert.equal(["low", "medium"].includes(result.confidence), true);
  assert.equal(["acceptable", "low_confidence"].includes(result.status), true);
});

test("scoreSleepSummary high sleep debt", () => {
  const result = scoreSleepSummary({
    asleepMinutes: 300,
    sleepDebtMinutes: 180,
    sleepEfficiencyPct: 80,
    deepMinutes: 40,
    remMinutes: 50,
    lightMinutes: 210,
    unknownStageMinutes: 0,
    interruptionsCount: 1,
    targetMinutes: 480,
  });

  assert.equal(result.status, "high_sleep_debt");
  assert.equal(result.confidence, "high");
  assert.equal(result.qualityScore < 70, true);
});

test("scoreSleepSummary lowers confidence for high unknown coverage", () => {
  const result = scoreSleepSummary({
    asleepMinutes: 30,
    sleepDebtMinutes: 450,
    sleepEfficiencyPct: 6.3,
    deepMinutes: 0,
    remMinutes: 0,
    lightMinutes: 30,
    unknownStageMinutes: 450,
    interruptionsCount: 0,
    targetMinutes: 480,
  });

  assert.equal(result.status, "high_sleep_debt");
  assert.equal(result.confidence, "low");
});

test("scoreSleepSummary keeps small unknown coverage from forcing low confidence", () => {
  const result = scoreSleepSummary({
    asleepMinutes: 450,
    sleepDebtMinutes: 30,
    sleepEfficiencyPct: 93.8,
    deepMinutes: 60,
    remMinutes: 90,
    lightMinutes: 270,
    unknownStageMinutes: 30,
    interruptionsCount: 0,
    targetMinutes: 480,
  });

  assert.equal(result.confidence, "high");
});

test("scoreSleepSummary fragmented sleep", () => {
  const result = scoreSleepSummary({
    asleepMinutes: 430,
    sleepDebtMinutes: 50,
    sleepEfficiencyPct: 72,
    deepMinutes: 70,
    remMinutes: 80,
    lightMinutes: 280,
    unknownStageMinutes: 0,
    interruptionsCount: 7,
    targetMinutes: 480,
  });

  assert.equal(result.status, "fragmented_sleep");
});

test("scoreSleepSummary keeps fragmented sleep confidence aligned with stage coverage", () => {
  const result = scoreSleepSummary({
    asleepMinutes: 430,
    sleepDebtMinutes: 50,
    sleepEfficiencyPct: 72,
    deepMinutes: 70,
    remMinutes: 80,
    lightMinutes: 280,
    unknownStageMinutes: 0,
    interruptionsCount: 7,
    targetMinutes: 480,
  });

  assert.equal(result.confidence, "high");
});

test("scoreSleepSummary does not assign high confidence to unknown-only fragmented sleep", () => {
  const result = scoreSleepSummary({
    asleepMinutes: 430,
    sleepDebtMinutes: 50,
    sleepEfficiencyPct: 72,
    deepMinutes: 0,
    remMinutes: 0,
    lightMinutes: 0,
    unknownStageMinutes: 430,
    interruptionsCount: 7,
    targetMinutes: 480,
  });

  assert.equal(result.status, "fragmented_sleep");
  assert.notEqual(result.confidence, "high");
});

test("summarizeSleepWindow for seven days returns derived rolling metrics", () => {
  const window = summarizeSleepWindow([
    {
      date: "2026-03-06",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 420,
      sleepDebtMinutes: 60,
      qualityScore: 85,
      confidence: "high",
      status: "acceptable",
    },
    {
      date: "2026-03-05",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 390,
      sleepDebtMinutes: 90,
      qualityScore: 80,
      confidence: "high",
      status: "mild_sleep_debt",
    },
    {
      date: "2026-03-07",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 405,
      sleepDebtMinutes: 75,
      qualityScore: 82,
      confidence: "high",
      status: "acceptable",
    },
    {
      date: "2026-03-01",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
    },
    {
      date: "2026-03-04",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 375,
      sleepDebtMinutes: 105,
      qualityScore: 74,
      confidence: "high",
      status: "mild_sleep_debt",
    },
    {
      date: "2026-03-02",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 450,
      sleepDebtMinutes: 30,
      qualityScore: 90,
      confidence: "high",
      status: "optimal",
    },
    {
      date: "2026-03-03",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 357,
      sleepDebtMinutes: 123,
      qualityScore: 70,
      confidence: "medium",
      status: "mild_sleep_debt",
    },
  ] as SleepDailySummary[]);

  assert.equal(window.lastNight?.date, "2026-03-07");
  assert.equal(window.sevenDayAverageMinutes, 411);
  assert.equal(window.averageSleepDebtMinutes, 69);
  assert.equal(window.status, "mild_sleep_debt");
});

test("summarizeSleepWindow escalates a severe last night over otherwise good average sleep", () => {
  const window = summarizeSleepWindow([
    {
      date: "2026-03-01",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
    },
    {
      date: "2026-03-02",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
    },
    {
      date: "2026-03-03",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
    },
    {
      date: "2026-03-04",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
    },
    {
      date: "2026-03-05",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
    },
    {
      date: "2026-03-06",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
    },
    {
      date: "2026-03-07",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 180,
      sleepDebtMinutes: 300,
      qualityScore: 20,
      confidence: "high",
      status: "high_sleep_debt",
    },
  ] as SleepDailySummary[]);

  assert.equal(window.lastNight?.status, "high_sleep_debt");
  assert.equal(window.status, "high_sleep_debt");
});

test("summarizeSleepWindow propagates fragmented last night over otherwise fine average sleep", () => {
  const window = summarizeSleepWindow([
    {
      date: "2026-03-01",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
    },
    {
      date: "2026-03-02",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
    },
    {
      date: "2026-03-03",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
    },
    {
      date: "2026-03-04",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
    },
    {
      date: "2026-03-05",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
    },
    {
      date: "2026-03-06",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
    },
    {
      date: "2026-03-07",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 420,
      sleepDebtMinutes: 60,
      qualityScore: 30,
      confidence: "high",
      status: "fragmented_sleep",
    },
  ] as SleepDailySummary[]);

  assert.equal(window.lastNight?.status, "fragmented_sleep");
  assert.equal(window.status, "fragmented_sleep");
});

test("summarizeSleepWindow for empty window returns low confidence low_confidence summary", () => {
  const window = summarizeSleepWindow([]);

  assert.equal(window.lastNight, null);
  assert.equal(window.sevenDayAverageMinutes, null);
  assert.equal(window.averageSleepDebtMinutes, null);
  assert.equal(window.status, "low_confidence");
  assert.equal(window.confidence, "low");
  assert.deepEqual(window.days, []);
});

test("summarizeSleepWindow uses only the last seven days for rolling metrics", () => {
  const window = summarizeSleepWindow([
    {
      date: "2026-03-08",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 420,
      sleepDebtMinutes: 60,
      qualityScore: 85,
      confidence: "high",
      status: "acceptable",
    },
    {
      date: "2026-03-07",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 420,
      sleepDebtMinutes: 60,
      qualityScore: 85,
      confidence: "high",
      status: "acceptable",
    },
    {
      date: "2026-03-06",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 420,
      sleepDebtMinutes: 60,
      qualityScore: 85,
      confidence: "high",
      status: "acceptable",
    },
    {
      date: "2026-03-05",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 420,
      sleepDebtMinutes: 60,
      qualityScore: 85,
      confidence: "high",
      status: "acceptable",
    },
    {
      date: "2026-03-04",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 420,
      sleepDebtMinutes: 60,
      qualityScore: 85,
      confidence: "high",
      status: "acceptable",
    },
    {
      date: "2026-03-03",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 420,
      sleepDebtMinutes: 60,
      qualityScore: 85,
      confidence: "high",
      status: "acceptable",
    },
    {
      date: "2026-03-02",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 420,
      sleepDebtMinutes: 60,
      qualityScore: 85,
      confidence: "high",
      status: "acceptable",
    },
    {
      date: "2026-03-01",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 0,
      sleepDebtMinutes: 480,
      qualityScore: 10,
      confidence: "low",
      status: "high_sleep_debt",
    },
  ] as SleepDailySummary[]);

  assert.equal(window.days[0]!.date, "2026-03-01");
  assert.equal(window.days.at(-1)?.date, "2026-03-08");
  assert.equal(window.lastNight?.date, "2026-03-08");
  assert.equal(window.sevenDayAverageMinutes, 420);
  assert.equal(window.averageSleepDebtMinutes, 60);
  assert.equal(window.status, "mild_sleep_debt");
});

test("summarizeSleepWindow keeps stable midpoints out of irregular_schedule", () => {
  const window = summarizeSleepWindow([
    {
      date: "2026-03-01",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 420,
      sleepDebtMinutes: 60,
      qualityScore: 85,
      confidence: "high",
      status: "acceptable",
      sleepMidpoint: "2026-03-01T03:00:00.000Z",
    },
    {
      date: "2026-03-02",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 420,
      sleepDebtMinutes: 60,
      qualityScore: 85,
      confidence: "high",
      status: "acceptable",
      sleepMidpoint: "2026-03-02T03:20:00.000Z",
    },
    {
      date: "2026-03-03",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 420,
      sleepDebtMinutes: 60,
      qualityScore: 85,
      confidence: "high",
      status: "acceptable",
      sleepMidpoint: "2026-03-03T03:40:00.000Z",
    },
  ] as SleepDailySummary[]);

  assert.equal(window.status, "mild_sleep_debt");
});

test("summarizeSleepWindow marks irregular_schedule when recent midpoint spread is at least 90 minutes", () => {
  const window = summarizeSleepWindow([
    {
      date: "2026-03-01",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
      sleepMidpoint: "2026-03-01T02:00:00.000Z",
    },
    {
      date: "2026-03-02",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
      sleepMidpoint: "2026-03-02T03:30:00.000Z",
    },
    {
      date: "2026-03-03",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
      sleepMidpoint: "2026-03-03T04:15:00.000Z",
    },
  ] as SleepDailySummary[]);

  assert.equal(window.status, "irregular_schedule");
});

test("summarizeSleepWindow keeps circular midpoints around midnight from being irregular", () => {
  const window = summarizeSleepWindow([
    {
      date: "2026-03-01",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
      sleepMidpoint: "2026-03-01T23:45:00.000Z",
    },
    {
      date: "2026-03-02",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
      sleepMidpoint: "2026-03-02T00:15:00.000Z",
    },
    {
      date: "2026-03-03",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
      sleepMidpoint: "2026-03-03T00:30:00.000Z",
    },
  ] as SleepDailySummary[]);

  assert.notEqual(window.status, "irregular_schedule");
});

test("summarizeSleepWindow marks irregular_schedule when circular midpoint spread reaches at least 90 minutes", () => {
  const window = summarizeSleepWindow([
    {
      date: "2026-03-01",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
      sleepMidpoint: "2026-03-01T01:00:00.000Z",
    },
    {
      date: "2026-03-02",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
      sleepMidpoint: "2026-03-02T03:00:00.000Z",
    },
    {
      date: "2026-03-03",
      mainSleepAsleepMinutes: null,
      asleepMinutes: 480,
      sleepDebtMinutes: 0,
      qualityScore: 100,
      confidence: "high",
      status: "optimal",
      sleepMidpoint: "2026-03-03T04:15:00.000Z",
    },
  ] as SleepDailySummary[]);

  assert.equal(window.status, "irregular_schedule");
});
