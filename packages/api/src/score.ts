import { listDailyActivityTotals } from "@openvalens/activity";
import type { Database } from "@openvalens/db";
import { createGoalRepository } from "@openvalens/plans";
import { listSleepDailySummaries } from "@openvalens/sleep";
import { listDailyVitals } from "@openvalens/vitals";

import type { GoalProgressResult, ReadinessResult } from "./score-contract";
import {
  computeGoalProgress,
  goalProgressAdultsOnly,
  type GoalWithHistory,
} from "./score-goal-progress";
import { computeReadiness, readinessAdultsOnly } from "./score-readiness";
import { createWellnessProfileService } from "./wellness-profile";

/**
 * Issue #95 — loads the inputs for the two scores from the existing domain
 * stores (sleep, vitals, activity, goals) and hands them to the pure
 * algorithms. Nothing is cached or stored: every call recomputes from the
 * workspace's current records, so there is no score history to splice.
 *
 * Scoping: record reads are keyed only by the active organization from the
 * trusted authz context; the 18+ scope check reads only the signed-in
 * person's own wellness profile (#98). No input or score value is logged.
 */

/** Days of history loaded: the longest recent window + 28-day baseline + slack. */
export const READINESS_HISTORY_DAYS = 35;

export type ScoreService = {
  readiness(scope: { organizationId: string; viewerUserId: string }): Promise<ReadinessResult>;
  goalProgress(scope: {
    organizationId: string;
    viewerUserId: string;
  }): Promise<GoalProgressResult>;
};

export function createScoreService(deps: { db: Database; now?: () => Date }): ScoreService {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  /** Scores are for adults (18+, general wellness): a declared under-18 gets none. */
  async function viewerDeclaredUnder18(userId: string): Promise<boolean> {
    const profile = await createWellnessProfileService({ db }).read(userId);
    return profile.eligibility.state === "recorded" && profile.eligibility.value === "under_18";
  }

  return {
    async readiness({ organizationId, viewerUserId }) {
      const asOf = now().toISOString().slice(0, 10);
      if (await viewerDeclaredUnder18(viewerUserId)) return readinessAdultsOnly(asOf);

      const [sleep, vitals, activity] = await Promise.all([
        listSleepDailySummaries(db, organizationId, READINESS_HISTORY_DAYS + 1),
        listDailyVitals(db, organizationId, READINESS_HISTORY_DAYS),
        listDailyActivityTotals(db, organizationId, READINESS_HISTORY_DAYS),
      ]);
      return computeReadiness(
        {
          sleepMinutes: sleep.map((day) => ({ date: day.date, value: day.asleepMinutes })),
          restingHeartRate: vitals.map((day) => ({
            date: day.date,
            value: day.restingHeartRate.sampleCount > 0 ? day.restingHeartRate.avgBpm : null,
          })),
          steps: activity.map((day) => ({ date: day.date, value: day.steps })),
        },
        asOf,
      );
    },

    async goalProgress({ organizationId, viewerUserId }) {
      if (await viewerDeclaredUnder18(viewerUserId)) return goalProgressAdultsOnly();

      const repository = createGoalRepository(db);
      const goals = await repository.listGoals(organizationId);
      const entries: GoalWithHistory[] = await Promise.all(
        goals.map(async (goal) => ({
          goal,
          checkins: await repository.listCheckins(organizationId, goal.id),
        })),
      );
      return computeGoalProgress(entries);
    },
  };
}
