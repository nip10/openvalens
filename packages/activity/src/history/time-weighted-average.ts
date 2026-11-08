/**
 * TypeScript port of Gadgetbridge's `TimeWeightedAverageAccumulator`.
 *
 * Upstream: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/util/TimeWeightedAverageAccumulator.java`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/util/TimeWeightedAverageAccumulator.java
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * A running time-weighted mean: each sample contributes `value × interval`
 * to the sum and `interval` to the weight. When the interval since the
 * previous sample exceeds `maxTimeDiff`, it is replaced by
 * `defaultTimeDiff`, so a long gap (a watch off the wrist, a sync hole) does
 * not dominate the average. The first sample is seeded with
 * `defaultTimeDiff`; when that is 0 it contributes no weight.
 *
 * Timestamps are epoch milliseconds.
 *
 * Upstream quirks preserved deliberately:
 * - `count` excludes the first sample (it counts intervals, not samples).
 * - With no samples, `min`/`max` are the `Double.MAX_VALUE` sentinels, not
 *   `NaN` or `null`.
 * - A backwards timestamp is not capped; its negative interval is added as-is.
 * - The cap only applies when both `maxTimeDiff` and `defaultTimeDiff` are
 *   positive.
 */

/** One timestamped value; `time` is epoch milliseconds. */
export type TimeWeightedSample = {
  time: number;
  value: number;
};

/** Constructor arguments of the upstream accumulator. */
export type TimeWeightedAverageOptions = {
  /** Intervals longer than this are capped; 0 disables the cap. */
  maxTimeDiff: number;
  /** Weight given to the first sample and to every capped interval. */
  defaultTimeDiff: number;
};

/** Snapshot of an accumulator. */
export type TimeWeightedAverageResult = {
  average: number;
  min: number;
  max: number;
  count: number;
};

/** Running accumulator, mirroring upstream's mutable class. */
export class TimeWeightedAverageAccumulator {
  private lastTimestamp = 0;
  private sampleCount = 0;

  private minValue = Number.MAX_VALUE;
  private maxValue = -Number.MAX_VALUE;

  private weightedSum = 0;
  private totalWeight = 0;
  private first = true;

  constructor(
    private readonly maxTimeDiff: number,
    private readonly defaultTimeDiff: number,
  ) {}

  add(timestamp: number, value: number): void {
    if (value > this.maxValue) this.maxValue = value;
    if (value < this.minValue) this.minValue = value;

    if (this.first) {
      if (this.defaultTimeDiff > 0) {
        this.weightedSum = value * this.defaultTimeDiff;
        this.totalWeight = this.defaultTimeDiff;
      } else {
        this.weightedSum = 0;
        this.totalWeight = 0;
      }
      this.lastTimestamp = timestamp;
      this.first = false;
      return;
    }

    let timeDiff = timestamp - this.lastTimestamp;
    if (this.maxTimeDiff > 0 && this.defaultTimeDiff > 0 && timeDiff > this.maxTimeDiff) {
      timeDiff = this.defaultTimeDiff;
    }

    this.weightedSum += value * timeDiff;
    this.totalWeight += timeDiff;
    this.lastTimestamp = timestamp;
    this.sampleCount += 1;
  }

  /** Upstream `getAverage()`; 0 when no weight has accumulated. */
  get average(): number {
    return this.totalWeight === 0 ? 0 : this.weightedSum / this.totalWeight;
  }

  /** Upstream `getMin()`; `Number.MAX_VALUE` before any sample. */
  get min(): number {
    return this.minValue;
  }

  /** Upstream `getMax()`; `-Number.MAX_VALUE` before any sample. */
  get max(): number {
    return this.maxValue;
  }

  /** Upstream `getCount()`; the number of intervals, i.e. samples minus one. */
  get count(): number {
    return this.sampleCount;
  }
}

/** Convenience wrapper over a finite sample list. */
export function timeWeightedAverage(
  samples: readonly TimeWeightedSample[],
  options: TimeWeightedAverageOptions,
): TimeWeightedAverageResult {
  const accumulator = new TimeWeightedAverageAccumulator(
    options.maxTimeDiff,
    options.defaultTimeDiff,
  );
  for (const sample of samples) accumulator.add(sample.time, sample.value);
  return {
    average: accumulator.average,
    min: accumulator.min,
    max: accumulator.max,
    count: accumulator.count,
  };
}
