import { listDailyActivityTotals } from "@openvalens/activity";
import type { Database } from "@openvalens/db";
import { listSleepDailySummaries } from "@openvalens/sleep";
import { listDailyMoodRatings } from "@openvalens/trackers/check-in";
import { listDailyVitals } from "@openvalens/vitals";

import {
  READINESS_ALGORITHM_VERSION,
  READINESS_TREND_DAYS,
  type ReadinessHistory,
  type ReadinessResult,
} from "./score-contract";
import {
  computeReadiness,
  readinessAdultsOnly,
  readinessHistoryDay,
  type ReadinessSeries,
} from "./score-readiness";
import { createWellnessProfileService } from "./wellness-profile";

/**
 * Issue #95 — loads readiness inputs from the existing domain
 * stores (sleep, vitals, activity, and the viewer's own Mood tracker) and
 * hands them to the pure algorithms. Nothing is cached or stored: every call
 * recomputes from the workspace's current records, so there is no score
 * history to splice. The 30-day history (scores#8) is the same
 * `computeReadiness` run as of each past day over one read of the records.
 *
 * Scoping: record reads are keyed only by the active organization from the
 * trusted authz context; sleep and the Mood check-in read only the signed-in
 * person's own rows, and the 18+ scope check reads only their own wellness
 * profile (#98). No input or score value is logged.
 */

/** Days of history loaded: the longest recent window + 28-day baseline + slack. */
export const READINESS_HISTORY_DAYS = 35;

type ScoreScope = { organizationId: string; viewerUserId: string };

export type ScoreService = {
  readiness(scope: ScoreScope): Promise<ReadinessResult>;
  /**
   * The same index for each of the last 30 days (oldest first, ending today),
   * each computed by `computeReadiness` as of that day.
   */
  readinessHistory(scope: ScoreScope): Promise<ReadinessHistory>;
};

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function createScoreService(deps: { db: Database; now?: () => Date }): ScoreService {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  /** Scores are for adults (18+, general wellness): a declared under-18 gets none. */
  async function viewerDeclaredUnder18(userId: string): Promise<boolean> {
    const profile = await createWellnessProfileService({ db }).read(userId);
    return profile.eligibility.state === "recorded" && profile.eligibility.value === "under_18";
  }

  /**
   * The readiness inputs over the last `days` days: sleep, resting heart rate,
   * steps, HRV and the Mood check-in (0.2.0).
   */
  async function loadSeries(
    { organizationId, viewerUserId }: ScoreScope,
    days: number,
  ): Promise<ReadinessSeries> {
    const today = now().toISOString().slice(0, 10);
    const [sleep, vitals, activity, mood] = await Promise.all([
      listSleepDailySummaries(db, organizationId, viewerUserId, days + 1),
      listDailyVitals(db, organizationId, days),
      listDailyActivityTotals(db, organizationId, days),
      listDailyMoodRatings(db, { organizationId, userId: viewerUserId }, addDays(today, -days)),
    ]);
    return {
      sleepMinutes: sleep.map((day) => ({ date: day.date, value: day.asleepMinutes })),
      restingHeartRate: vitals.map((day) => ({
        date: day.date,
        value: day.restingHeartRate.sampleCount > 0 ? day.restingHeartRate.avgBpm : null,
      })),
      steps: activity.map((day) => ({ date: day.date, value: day.steps })),
      hrv: vitals.map((day) => ({
        date: day.date,
        value: day.hrv.sampleCount > 0 ? day.hrv.avgMs : null,
      })),
      checkIn: mood,
    };
  }

  return {
    async readiness(scope) {
      const asOf = now().toISOString().slice(0, 10);
      if (await viewerDeclaredUnder18(scope.viewerUserId)) return readinessAdultsOnly(asOf);
      return computeReadiness(await loadSeries(scope, READINESS_HISTORY_DAYS), asOf);
    },

    async readinessHistory(scope) {
      const today = now().toISOString().slice(0, 10);
      const base = {
        kind: "readiness_history" as const,
        experimental: true as const,
        algorithmVersion: READINESS_ALGORITHM_VERSION,
      };
      if (await viewerDeclaredUnder18(scope.viewerUserId))
        return { ...base, status: "withheld", withheldReason: "adults_only", days: [] };
      // One read reaches back far enough for the oldest day's own baseline.
      const series = await loadSeries(scope, READINESS_HISTORY_DAYS + READINESS_TREND_DAYS);
      const days = Array.from({ length: READINESS_TREND_DAYS }, (_, index) =>
        readinessHistoryDay(
          computeReadiness(series, addDays(today, index - (READINESS_TREND_DAYS - 1))),
        ),
      );
      return { ...base, status: "available", withheldReason: null, days };
    },
  };
}
