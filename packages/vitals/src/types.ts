/**
 * Vitals — public type surface.
 *
 * Daily summaries come from `metric_sample` rows for the canonical codes
 * `heart_rate` and `resting_heart_rate`. Heart rate per day is summarised as
 * average / max / min — samples are typically taken at intervals (a watch or
 * phone sample at a moment in time). Resting heart rate is averaged per day.
 * `hrv_rmssd` (overnight HRV, usually from a cloud wearable) is averaged per
 * day in milliseconds.
 */
export type DailyVitalsSummary = {
  date: string;
  heartRate: {
    avgBpm: number | null;
    minBpm: number | null;
    maxBpm: number | null;
    sampleCount: number;
  };
  restingHeartRate: {
    avgBpm: number | null;
    sampleCount: number;
  };
  hrv: {
    avgMs: number | null;
    sampleCount: number;
  };
};

export type VitalsSample = {
  sampledAt: string;
  heartRateBpm: number;
  source: string | null;
};
