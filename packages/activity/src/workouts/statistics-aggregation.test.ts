/**
 * Behavioural tests for the workout statistics aggregation port.
 *
 * Upstream has no tests for `StatisticsAggregation.kt`, so these are written
 * from the source semantics at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  addMetricTotals,
  addWeightedSums,
  EMPTY_WEIGHTED_SUM,
  isLineOnly,
  metricValue,
  SPORT_METRICS,
  SPEED_UNITS,
  speedMetersPerSecond,
  SportMetric,
  weightedAverage,
  weightedSumOf,
  workoutTotals,
  type MetricTotals,
} from "./statistics-aggregation";

test("WeightedSum.of ignores non-positive values and merges partials", () => {
  expect(weightedSumOf(0, 10)).toEqual({ sum: 0, weight: 0 });
  expect(weightedSumOf(-5, 10)).toEqual({ sum: 0, weight: 0 });
  expect(weightedSumOf(10, 5)).toEqual({ sum: 50, weight: 5 });
  expect(weightedAverage(weightedSumOf(10, 5))).toBe(10);
  expect(weightedAverage(EMPTY_WEIGHTED_SUM)).toBe(0);

  const merged = addWeightedSums(weightedSumOf(10, 5), weightedSumOf(20, 3));
  expect(merged).toEqual({ sum: 110, weight: 8 });
  expect(weightedAverage(merged)).toBeCloseTo(13.75);
});

test("MetricTotals.plus sums totals and takes maxima", () => {
  const first = workoutTotals({
    startMillis: 0,
    endMillis: 600_000,
    distanceMeters: 1000,
    calories: 100,
    ascentMeters: 10,
    descentMeters: 5,
    steps: 1000,
    avgSpeedMetersPerSecond: 5,
    maxSpeedMetersPerSecond: 6,
    avgHeartRate: 120,
    maxHeartRate: 150,
    avgPowerWatts: 200,
    maxPowerWatts: 250,
    avgCadence: 80,
    maxCadence: 90,
    avgSwolf: 30,
    aerobicEffect: 3,
    anaerobicEffect: 1,
    trainingLoad: 50,
    sets: 2,
  });
  const second = workoutTotals({
    startMillis: 0,
    endMillis: 300_000,
    distanceMeters: 600,
    calories: 50,
    ascentMeters: 20,
    descentMeters: 10,
    steps: 500,
    avgSpeedMetersPerSecond: 4,
    maxSpeedMetersPerSecond: 7,
    avgHeartRate: 100,
    maxHeartRate: 160,
    avgPowerWatts: 180,
    maxPowerWatts: 260,
    avgCadence: 70,
    maxCadence: 100,
    avgSwolf: 20,
    aerobicEffect: 2,
    anaerobicEffect: 2,
    trainingLoad: 30,
    sets: 1,
  });

  const merged = addMetricTotals(first, second);

  expect(merged.durationSeconds).toBe(900);
  expect(merged.distanceMeters).toBe(1600);
  expect(merged.calories).toBe(150);
  expect(merged.ascentMeters).toBe(30);
  expect(merged.descentMeters).toBe(15);
  expect(merged.steps).toBe(1500);
  expect(merged.trainingLoad).toBe(80);
  expect(merged.sets).toBe(3);

  // Speed is weighted by moving time: 1000/5 + 600/4 = 350s.
  expect(merged.speed).toEqual({ sum: 1600, weight: 350 });
  expect(weightedAverage(merged.speed)).toBeCloseTo(4.571428571428571);
  expect(merged.maxSpeed).toBe(7);

  expect(merged.heartRate).toEqual({ sum: 102_000, weight: 900 });
  expect(weightedAverage(merged.heartRate)).toBeCloseTo(113.33333333333333);
  expect(merged.maxHeartRate).toBe(160);

  expect(merged.power).toEqual({ sum: 174_000, weight: 900 });
  expect(weightedAverage(merged.power)).toBeCloseTo(193.33333333333334);
  expect(merged.maxPower).toBe(260);

  expect(merged.cadence).toEqual({ sum: 69_000, weight: 900 });
  expect(weightedAverage(merged.cadence)).toBeCloseTo(76.66666666666667);
  expect(merged.maxCadence).toBe(100);

  expect(merged.swolf).toEqual({ sum: 24_000, weight: 900 });
  expect(weightedAverage(merged.swolf)).toBeCloseTo(26.666666666666668);

  expect(merged.aerobicEffect).toEqual({ sum: 2400, weight: 900 });
  expect(weightedAverage(merged.aerobicEffect)).toBeCloseTo(2.6666666666666665);
  expect(merged.anaerobicEffect).toEqual({ sum: 1200, weight: 900 });
  expect(weightedAverage(merged.anaerobicEffect)).toBeCloseTo(1.3333333333333333);
});

test("workoutTotals falls back to duration when distance or speed is missing", () => {
  const noDistance = workoutTotals({
    startMillis: 0,
    endMillis: 300_000,
    avgSpeedMetersPerSecond: 5,
  });
  expect(noDistance.speed).toEqual({ sum: 1500, weight: 300 });
  expect(weightedAverage(noDistance.speed)).toBe(5);

  const noSpeed = workoutTotals({
    startMillis: 0,
    endMillis: 300_000,
    distanceMeters: 1000,
  });
  expect(noSpeed.speed).toEqual({ sum: 0, weight: 0 });
  expect(weightedAverage(noSpeed.speed)).toBe(0);
});

test("pace is the harmonic mean of speed, not the arithmetic mean of paces", () => {
  // 1000 m at 10 m/s (100 s) and 200 m at 2 m/s (100 s).
  const fast = workoutTotals({
    startMillis: 0,
    endMillis: 100_000,
    distanceMeters: 1000,
    avgSpeedMetersPerSecond: 10,
    maxSpeedMetersPerSecond: 12,
  });
  const slow = workoutTotals({
    startMillis: 0,
    endMillis: 100_000,
    distanceMeters: 200,
    avgSpeedMetersPerSecond: 2,
    maxSpeedMetersPerSecond: 4,
  });
  const merged = addMetricTotals(fast, slow);

  // 1200 m in 200 s → 6 m/s → 1/6 s/m.
  expect(metricValue("AVG_SPEED", merged)).toBeCloseTo(6);
  expect(metricValue("AVG_PACE", merged)).toBeCloseTo(1 / 6);
  // The arithmetic mean of the two paces would be (0.1 + 0.5) / 2 = 0.3.
  expect(metricValue("AVG_PACE", merged)).not.toBeCloseTo(0.3, 3);
  expect(metricValue("MAX_PACE", merged)).toBeCloseTo(1 / 12);
});

test("speedMetersPerSecond converts every supported unit", () => {
  expect(speedMetersPerSecond(5, SPEED_UNITS.METERS_PER_SECOND)).toBe(5);
  expect(speedMetersPerSecond(18, SPEED_UNITS.KMPH)).toBeCloseTo(5);
  expect(speedMetersPerSecond(200, SPEED_UNITS.SECONDS_PER_KM)).toBeCloseTo(5);
  expect(speedMetersPerSecond(20, SPEED_UNITS.SECONDS_PER_100_METERS)).toBeCloseTo(5);
  expect(speedMetersPerSecond(0.2, SPEED_UNITS.SECONDS_PER_M)).toBeCloseTo(5);
  expect(speedMetersPerSecond(5, "furlongs")).toBe(0);
  expect(speedMetersPerSecond(0, SPEED_UNITS.METERS_PER_SECOND)).toBe(0);
  expect(speedMetersPerSecond(-1, SPEED_UNITS.METERS_PER_SECOND)).toBe(0);
});

test("sport metrics carry upstream aggregation rules", () => {
  expect(SportMetric.DISTANCE.aggregation).toBe("total");
  expect(SportMetric.AVG_PACE.aggregation).toBe("average");
  expect(SportMetric.MAX_PACE.aggregation).toBe("maximum");
  expect(isLineOnly("DISTANCE")).toBe(false);
  expect(isLineOnly("AVG_PACE")).toBe(true);
  expect(isLineOnly("MAX_HEART_RATE")).toBe(true);
  expect(SPORT_METRICS).toHaveLength(21);
});

test("metricValue extracts totals, averages and maxima", () => {
  const totals: MetricTotals = {
    ...workoutTotals({
      startMillis: 0,
      endMillis: 600_000,
      distanceMeters: 1000,
      avgHeartRate: 120,
      maxHeartRate: 150,
      avgPowerWatts: 200,
      maxPowerWatts: 250,
      avgCadence: 80,
      maxCadence: 90,
      avgSwolf: 30,
      aerobicEffect: 3,
      anaerobicEffect: 1,
      calories: 100,
      ascentMeters: 10,
      descentMeters: 5,
      steps: 1000,
      trainingLoad: 50,
      sets: 2,
    }),
  };

  expect(metricValue("DISTANCE", totals)).toBe(1000);
  expect(metricValue("DURATION", totals)).toBe(600);
  expect(metricValue("AVG_HEART_RATE", totals)).toBe(120);
  expect(metricValue("MAX_HEART_RATE", totals)).toBe(150);
  expect(metricValue("AVG_POWER", totals)).toBe(200);
  expect(metricValue("MAX_POWER", totals)).toBe(250);
  expect(metricValue("AVG_CADENCE", totals)).toBe(80);
  expect(metricValue("MAX_CADENCE", totals)).toBe(90);
  expect(metricValue("AVG_SWOLF", totals)).toBe(30);
  expect(metricValue("CALORIES", totals)).toBe(100);
  expect(metricValue("ASCENT", totals)).toBe(10);
  expect(metricValue("DESCENT", totals)).toBe(5);
  expect(metricValue("STEPS", totals)).toBe(1000);
  expect(metricValue("TRAINING_LOAD", totals)).toBe(50);
  expect(metricValue("SETS", totals)).toBe(2);
  expect(metricValue("AVG_AEROBIC_EFFECT", totals)).toBe(3);
  expect(metricValue("AVG_ANAEROBIC_EFFECT", totals)).toBe(1);
});
