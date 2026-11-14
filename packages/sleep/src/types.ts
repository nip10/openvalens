/**
 * Sleep analytics — public type surface (Issue #18).
 *
 * Verbatim port of `anchovy/apps/web/src/lib/v2/sleep/types.ts` so the AI coach
 * surface (#13) and any future web/native consumers share one shape.
 *
 * Sleep is private per member (#509), like workouts: `health_event` rows with
 * `eventType = "sleep_session"` carry the member who logged or synced them in
 * `user_id`, and every read returns the member's own nights plus legacy nights
 * with no author.
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
  /**
   * Typed in by the member (#440). A manual session that overlaps a device
   * session never counts: the device night wins and the manual one is a
   * possible duplicate (`manualSleepDuplicateIds`).
   */
  manual?: boolean;
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
