/**
 * Activity aggregation — public type surface.
 *
 * Daily totals come from `metric_sample` rows that the mobile ingest pipeline
 * (#7) and the historical manual-import path write. Each row references one
 * `metric_definition` whose `code` is in the canonical taxonomy (`steps`,
 * `active_calories`, `distance`, `heart_rate`).
 */
export type ActivityMetricCode = "steps" | "active_calories" | "distance";

export type DailyActivityTotals = {
  date: string;
  steps: number | null;
  activeCaloriesKcal: number | null;
  distanceMeters: number | null;
};

export type DailyActivitySummary = {
  date: string;
  steps: number;
  activeCaloriesKcal: number;
  distanceMeters: number;
};
