/**
 * Sleep analytics — public type surface (Issue #18).
 *
 * Verbatim port of `anchovy/apps/web/src/lib/v2/sleep/types.ts` so the AI coach
 * surface (#13) and any future web/native consumers share one shape.
 *
 * The domain model is org-scoped: `health_event` rows with `eventType =
 * "sleep_session"` carry no per-user id (the openhealth schema intentionally
 * keeps sleep sessions org-scoped until #18 follow-ups land a `user_id` column).
 * Callers that want per-user slicing must filter post-query.
 */

export type SleepConfidence = "high" | "medium" | "low";

export type SleepStatus =
  | "optimal"
  | "acceptable"
  | "mild_sleep_debt"
  | "high_sleep_debt"
  | "fragmented_sleep"
  | "irregular_schedule"
  | "low_confidence";

export type SleepStage = "awake" | "light" | "deep" | "rem" | "unknown";

export type SleepStageInterval = {
  stage: string;
  start: string;
  end: string;
};

export type SleepSessionInput = {
  id: string;
  start: string;
  end: string | null;
  title?: string | null;
  sourceApp?: string | null;
  sourceDevice?: string | null;
  stageIntervals?: SleepStageInterval[];
};

export type SleepDailySummary = {
  date: string;
  mainSleepStart: string | null;
  mainSleepEnd: string | null;
  mainSleepAsleepMinutes: number | null;
  asleepMinutes: number;
  timeInBedMinutes: number | null;
  awakeMinutes: number;
  sleepEfficiencyPct: number | null;
  deepMinutes: number;
  remMinutes: number;
  lightMinutes: number;
  unknownStageMinutes: number;
  interruptionsCount: number;
  sleepMidpoint: string | null;
  targetMinutes: number;
  sleepDebtMinutes: number;
  qualityScore: number;
  confidence: SleepConfidence;
  status: SleepStatus;
  sourceSummary: string | null;
  sessionIds: string[];
};

export type SleepWindowSummary = {
  days: SleepDailySummary[];
  lastNight: SleepDailySummary | null;
  sevenDayAverageMinutes: number | null;
  averageSleepDebtMinutes: number | null;
  status: SleepStatus;
  confidence: SleepConfidence;
};
