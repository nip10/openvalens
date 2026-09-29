import type { SleepConfidence, SleepStatus, SleepWindowSummary } from "./types";

/**
 * Sanitized sleep slice consumable by the AI coach surface (#13).
 *
 * Mirrors `anchovy/apps/web/src/lib/v2/sleep/coach-context.ts`. The shape is
 * intentionally narrow: it surfaces only the fields the coach policy needs
 * (constraint mapping, debt context, last-night duration, confidence) and
 * intentionally drops raw stage breakdown / per-day arrays.
 */
export type SleepCoachContext = {
  lastNightMinutes: number | null;
  sevenDayAverageMinutes: number | null;
  sleepDebtMinutesPerDay: number | null;
  status: SleepStatus;
  confidence: SleepConfidence;
  recommendedConstraint: "prioritize_recovery" | "avoid_max_effort_training" | null;
};

export function buildSleepCoachContext(summary: SleepWindowSummary): SleepCoachContext {
  const recommendedConstraint =
    summary.status === "high_sleep_debt"
      ? "prioritize_recovery"
      : summary.status === "mild_sleep_debt" || summary.status === "fragmented_sleep"
        ? "avoid_max_effort_training"
        : null;

  return {
    lastNightMinutes:
      summary.lastNight?.mainSleepAsleepMinutes ?? summary.lastNight?.asleepMinutes ?? null,
    sevenDayAverageMinutes: summary.sevenDayAverageMinutes,
    sleepDebtMinutesPerDay: summary.averageSleepDebtMinutes,
    status: summary.status,
    confidence: summary.confidence,
    recommendedConstraint,
  };
}
