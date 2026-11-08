/**
 * TypeScript port of Gadgetbridge's workout statistics aggregation math.
 *
 * Upstream: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/activities/workouts/statistics/StatisticsAggregation.kt`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/activities/workouts/statistics/StatisticsAggregation.kt
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * This is the pure numeric core: mergeable weighted sums, per-workout totals,
 * metric maxima and pace. The calendar/period/chart layer (Java `LocalDate`,
 * `ZoneId`, `StatisticsPeriod`, bar layout) is intentionally not ported; it
 * is presentation grouping rather than the aggregation math.
 *
 * Pace is the harmonic mean of speed, not the arithmetic mean of paces:
 * `WeightedSum` accumulates `speed × movingSeconds`, so
 * `1 / (sum speed×time / sum time) = total time / total distance`.
 * Averaging per-workout paces directly would be wrong whenever the workouts
 * cover different distances.
 */

/** Sum and weight of a weighted average, so partial sums can be merged. */
export type WeightedSum = {
  sum: number;
  weight: number;
};

/** Upstream `WeightedSum()`. */
export const EMPTY_WEIGHTED_SUM: Readonly<WeightedSum> = Object.freeze({
  sum: 0,
  weight: 0,
});

/**
 * Upstream `WeightedSum.of`: a non-positive value contributes nothing, so
 * missing metrics do not drag an average toward zero.
 */
export function weightedSumOf(value: number, weight: number): WeightedSum {
  return value > 0 ? { sum: value * weight, weight } : { sum: 0, weight: 0 };
}

/** Upstream `WeightedSum.plus`. */
export function addWeightedSums(left: WeightedSum, right: WeightedSum): WeightedSum {
  return { sum: left.sum + right.sum, weight: left.weight + right.weight };
}

/** Upstream `WeightedSum.average`; 0 when the weight is 0. */
export function weightedAverage(value: WeightedSum): number {
  return value.weight > 0 ? value.sum / value.weight : 0;
}

/** Metric sums over workouts, in raw units. */
export type MetricTotals = {
  durationSeconds: number;
  distanceMeters: number;
  calories: number;
  ascentMeters: number;
  descentMeters: number;
  steps: number;
  speed: WeightedSum;
  maxSpeed: number;
  heartRate: WeightedSum;
  maxHeartRate: number;
  power: WeightedSum;
  maxPower: number;
  cadence: WeightedSum;
  maxCadence: number;
  swolf: WeightedSum;
  aerobicEffect: WeightedSum;
  anaerobicEffect: WeightedSum;
  trainingLoad: number;
  sets: number;
};

/** Upstream `MetricTotals()` defaults. */
export const EMPTY_METRIC_TOTALS: Readonly<MetricTotals> = Object.freeze({
  durationSeconds: 0,
  distanceMeters: 0,
  calories: 0,
  ascentMeters: 0,
  descentMeters: 0,
  steps: 0,
  speed: EMPTY_WEIGHTED_SUM,
  maxSpeed: 0,
  heartRate: EMPTY_WEIGHTED_SUM,
  maxHeartRate: 0,
  power: EMPTY_WEIGHTED_SUM,
  maxPower: 0,
  cadence: EMPTY_WEIGHTED_SUM,
  maxCadence: 0,
  swolf: EMPTY_WEIGHTED_SUM,
  aerobicEffect: EMPTY_WEIGHTED_SUM,
  anaerobicEffect: EMPTY_WEIGHTED_SUM,
  trainingLoad: 0,
  sets: 0,
});

/**
 * Upstream `MetricTotals.plus`: totals and weighted sums add, maxima take the
 * larger value.
 */
export function addMetricTotals(left: MetricTotals, right: MetricTotals): MetricTotals {
  return {
    durationSeconds: left.durationSeconds + right.durationSeconds,
    distanceMeters: left.distanceMeters + right.distanceMeters,
    calories: left.calories + right.calories,
    ascentMeters: left.ascentMeters + right.ascentMeters,
    descentMeters: left.descentMeters + right.descentMeters,
    steps: left.steps + right.steps,
    speed: addWeightedSums(left.speed, right.speed),
    maxSpeed: Math.max(left.maxSpeed, right.maxSpeed),
    heartRate: addWeightedSums(left.heartRate, right.heartRate),
    maxHeartRate: Math.max(left.maxHeartRate, right.maxHeartRate),
    power: addWeightedSums(left.power, right.power),
    maxPower: Math.max(left.maxPower, right.maxPower),
    cadence: addWeightedSums(left.cadence, right.cadence),
    maxCadence: Math.max(left.maxCadence, right.maxCadence),
    swolf: addWeightedSums(left.swolf, right.swolf),
    aerobicEffect: addWeightedSums(left.aerobicEffect, right.aerobicEffect),
    anaerobicEffect: addWeightedSums(left.anaerobicEffect, right.anaerobicEffect),
    trainingLoad: left.trainingLoad + right.trainingLoad,
    sets: left.sets + right.sets,
  };
}

/** Values of one workout used for aggregation. Missing values are 0. */
export type WorkoutInput = {
  startMillis: number;
  endMillis: number;
  distanceMeters?: number;
  calories?: number;
  ascentMeters?: number;
  descentMeters?: number;
  steps?: number;
  avgSpeedMetersPerSecond?: number;
  maxSpeedMetersPerSecond?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  avgPowerWatts?: number;
  maxPowerWatts?: number;
  avgCadence?: number;
  maxCadence?: number;
  cadenceUnit?: string | null;
  avgSwolf?: number;
  aerobicEffect?: number;
  anaerobicEffect?: number;
  trainingLoad?: number;
  sets?: number;
};

const MILLIS_PER_SECOND = 1000;

/**
 * Upstream `WorkoutInput.totals`: duration is the wall-clock span in whole
 * seconds; a workout with distance and speed weights speed by moving time,
 * otherwise by the full duration. Averages are weighted by duration.
 */
export function workoutTotals(input: WorkoutInput): MetricTotals {
  const distanceMeters = input.distanceMeters ?? 0;
  const calories = input.calories ?? 0;
  const ascentMeters = input.ascentMeters ?? 0;
  const descentMeters = input.descentMeters ?? 0;
  const steps = input.steps ?? 0;
  const avgSpeed = input.avgSpeedMetersPerSecond ?? 0;
  const maxSpeed = input.maxSpeedMetersPerSecond ?? 0;
  const avgHeartRate = input.avgHeartRate ?? 0;
  const maxHeartRate = input.maxHeartRate ?? 0;
  const avgPower = input.avgPowerWatts ?? 0;
  const maxPower = input.maxPowerWatts ?? 0;
  const avgCadence = input.avgCadence ?? 0;
  const maxCadence = input.maxCadence ?? 0;
  const avgSwolf = input.avgSwolf ?? 0;
  const aerobicEffect = input.aerobicEffect ?? 0;
  const anaerobicEffect = input.anaerobicEffect ?? 0;
  const trainingLoad = input.trainingLoad ?? 0;
  const sets = input.sets ?? 0;

  const durationSeconds = Math.trunc(
    Math.max(input.endMillis - input.startMillis, 0) / MILLIS_PER_SECOND,
  );
  const movingSeconds =
    distanceMeters > 0 && avgSpeed > 0 ? distanceMeters / avgSpeed : durationSeconds;

  return {
    durationSeconds,
    distanceMeters,
    calories,
    ascentMeters,
    descentMeters,
    steps,
    speed: weightedSumOf(avgSpeed, movingSeconds),
    maxSpeed,
    heartRate: weightedSumOf(avgHeartRate, durationSeconds),
    maxHeartRate,
    power: weightedSumOf(avgPower, durationSeconds),
    maxPower,
    cadence: weightedSumOf(avgCadence, durationSeconds),
    maxCadence,
    swolf: weightedSumOf(avgSwolf, durationSeconds),
    aerobicEffect: weightedSumOf(aerobicEffect, durationSeconds),
    anaerobicEffect: weightedSumOf(anaerobicEffect, durationSeconds),
    trainingLoad,
    sets,
  };
}

/** How a metric combines over several workouts. */
export type MetricAggregation = "total" | "average" | "maximum";

/** A sport metric's aggregation rule and value extractor. */
export type SportMetricDefinition = {
  aggregation: MetricAggregation;
  valueOf: (totals: MetricTotals) => number;
};

/**
 * Metrics a sport's chart can plot. Speed is in m/s, pace in s/m. Pace is
 * derived from the weighted-average speed, so it is a harmonic mean.
 */
export const SportMetric = {
  DISTANCE: { aggregation: "total", valueOf: (totals) => totals.distanceMeters },
  DURATION: { aggregation: "total", valueOf: (totals) => totals.durationSeconds },
  AVG_PACE: {
    aggregation: "average",
    valueOf: (totals) => {
      const speed = weightedAverage(totals.speed);
      return speed > 0 ? 1 / speed : 0;
    },
  },
  AVG_SPEED: { aggregation: "average", valueOf: (totals) => weightedAverage(totals.speed) },
  MAX_PACE: {
    aggregation: "maximum",
    valueOf: (totals) => (totals.maxSpeed > 0 ? 1 / totals.maxSpeed : 0),
  },
  MAX_SPEED: { aggregation: "maximum", valueOf: (totals) => totals.maxSpeed },
  AVG_HEART_RATE: {
    aggregation: "average",
    valueOf: (totals) => weightedAverage(totals.heartRate),
  },
  MAX_HEART_RATE: { aggregation: "maximum", valueOf: (totals) => totals.maxHeartRate },
  AVG_POWER: { aggregation: "average", valueOf: (totals) => weightedAverage(totals.power) },
  MAX_POWER: { aggregation: "maximum", valueOf: (totals) => totals.maxPower },
  AVG_CADENCE: {
    aggregation: "average",
    valueOf: (totals) => weightedAverage(totals.cadence),
  },
  MAX_CADENCE: { aggregation: "maximum", valueOf: (totals) => totals.maxCadence },
  AVG_SWOLF: { aggregation: "average", valueOf: (totals) => weightedAverage(totals.swolf) },
  CALORIES: { aggregation: "total", valueOf: (totals) => totals.calories },
  ASCENT: { aggregation: "total", valueOf: (totals) => totals.ascentMeters },
  DESCENT: { aggregation: "total", valueOf: (totals) => totals.descentMeters },
  STEPS: { aggregation: "total", valueOf: (totals) => totals.steps },
  TRAINING_LOAD: { aggregation: "total", valueOf: (totals) => totals.trainingLoad },
  SETS: { aggregation: "total", valueOf: (totals) => totals.sets },
  AVG_AEROBIC_EFFECT: {
    aggregation: "average",
    valueOf: (totals) => weightedAverage(totals.aerobicEffect),
  },
  AVG_ANAEROBIC_EFFECT: {
    aggregation: "average",
    valueOf: (totals) => weightedAverage(totals.anaerobicEffect),
  },
} as const satisfies Record<string, SportMetricDefinition>;

export type SportMetric = keyof typeof SportMetric;

/** Every sport metric, in upstream declaration order. */
export const SPORT_METRICS = Object.keys(SportMetric) as SportMetric[];

/** Upstream `SportMetric.valueOf`. */
export function metricValue(metric: SportMetric, totals: MetricTotals): number {
  return SportMetric[metric].valueOf(totals);
}

/** Upstream `SportMetric.lineOnly`: averages and maxima are not totals. */
export function isLineOnly(metric: SportMetric): boolean {
  return SportMetric[metric].aggregation !== "total";
}

/** Unit strings upstream `ActivitySummaryEntries` uses for speed/pace. */
export const SPEED_UNITS = {
  METERS_PER_SECOND: "meters_second",
  KMPH: "km_h",
  SECONDS_PER_KM: "seconds_km",
  SECONDS_PER_100_METERS: "seconds_100m",
  SECONDS_PER_M: "seconds_m",
} as const;

const KMPH_PER_METER_PER_SECOND = 3.6;
const METERS_PER_KM = 1000;
const METERS_PER_100_METERS = 100;

/**
 * Upstream `StatisticsAggregation.speedMetersPerSecond`: converts a speed or
 * pace value to m/s. Unknown units and non-positive values return 0.
 */
export function speedMetersPerSecond(value: number, unit: string): number {
  if (value <= 0) return 0;
  switch (unit) {
    case SPEED_UNITS.METERS_PER_SECOND:
      return value;
    case SPEED_UNITS.KMPH:
      return value / KMPH_PER_METER_PER_SECOND;
    case SPEED_UNITS.SECONDS_PER_KM:
      return METERS_PER_KM / value;
    case SPEED_UNITS.SECONDS_PER_100_METERS:
      return METERS_PER_100_METERS / value;
    case SPEED_UNITS.SECONDS_PER_M:
      return 1 / value;
    default:
      return 0;
  }
}
