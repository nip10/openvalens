/**
 * Behavioural tests for the `TimeWeightedAverageAccumulator` port.
 *
 * Upstream has no tests for this class, so these are written from the source
 * semantics at revision 8976702fc3d00e6008c91fe994668cb4027f7bc2.
 * AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import { TimeWeightedAverageAccumulator, timeWeightedAverage } from "./time-weighted-average";

test("the first sample is seeded with the default weight", () => {
  const accumulator = new TimeWeightedAverageAccumulator(300_000, 60_000);

  accumulator.add(0, 60);
  expect(accumulator.average).toBe(60);
  expect(accumulator.count).toBe(0);
  expect(accumulator.min).toBe(60);
  expect(accumulator.max).toBe(60);

  accumulator.add(60_000, 80);
  expect(accumulator.average).toBe(70);
  expect(accumulator.count).toBe(1);
  expect(accumulator.min).toBe(60);
  expect(accumulator.max).toBe(80);
});

test("a long gap dominates when the cap is disabled", () => {
  const accumulator = new TimeWeightedAverageAccumulator(0, 60_000);

  accumulator.add(0, 60);
  accumulator.add(3_600_000, 120);

  // 60 × 60s + 120 × 3600s over 3660s.
  expect(accumulator.average).toBeCloseTo(119.01639344262296);
});

test("a long gap is capped to the default interval", () => {
  const accumulator = new TimeWeightedAverageAccumulator(300_000, 60_000);

  accumulator.add(0, 60);
  accumulator.add(3_600_000, 120);

  // Both samples now weigh 60s: (60 + 120) / 2.
  expect(accumulator.average).toBe(90);
});

test("min, max and count track every sample", () => {
  const result = timeWeightedAverage(
    [
      { time: 0, value: 60 },
      { time: 60_000, value: 80 },
      { time: 120_000, value: 40 },
    ],
    { maxTimeDiff: 300_000, defaultTimeDiff: 60_000 },
  );

  expect(result.average).toBe(60);
  expect(result.min).toBe(40);
  expect(result.max).toBe(80);
  // Upstream counts intervals, not samples.
  expect(result.count).toBe(2);
});

test("a zero default interval gives the first sample no weight", () => {
  const accumulator = new TimeWeightedAverageAccumulator(300_000, 0);

  accumulator.add(0, 60);
  expect(accumulator.average).toBe(0);
  expect(accumulator.count).toBe(0);

  accumulator.add(60_000, 80);
  expect(accumulator.average).toBe(80);
  expect(accumulator.count).toBe(1);
});

test("an empty accumulator returns the upstream sentinels", () => {
  const accumulator = new TimeWeightedAverageAccumulator(300_000, 60_000);

  expect(accumulator.average).toBe(0);
  expect(accumulator.min).toBe(Number.MAX_VALUE);
  expect(accumulator.max).toBe(-Number.MAX_VALUE);
  expect(accumulator.count).toBe(0);
});

test("the cap needs both limits to be positive", () => {
  const accumulator = new TimeWeightedAverageAccumulator(300_000, 0);

  accumulator.add(0, 60);
  accumulator.add(3_600_000, 120);

  // With no default interval there is no cap, and the first sample has no weight.
  expect(accumulator.average).toBe(120);
});
