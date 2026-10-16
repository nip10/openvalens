import {
  activityWindow,
  computeWeeklyActivityLoad,
  EFFORT_BASELINE_WINDOWS,
  listActivitySessions,
  listDailyActivityTotals,
} from "@openvalens/activity";
import type { Database } from "@openvalens/db";

import type { ActivityLoadResult } from "./activity-load-contract";
import { createWellnessProfileService } from "./wellness-profile";

/**
 * Issue #99 — loads the last five 7-day windows of activity sessions (manual
 * workouts and wearable workouts) plus daily steps, and hands them to the pure
 * `computeWeeklyActivityLoad`. Nothing is cached or stored: every call
 * recomputes from the workspace's current records.
 *
 * Scoping: record reads are keyed only by the active organization from the
 * trusted authz context; the 18+ scope check reads only the signed-in
 * person's own wellness profile (#98), matching the #95 scores. No input or
 * output value is logged.
 */
export type ActivityLoadService = {
  weekly(scope: { organizationId: string; viewerUserId: string }): Promise<ActivityLoadResult>;
};

export function createActivityLoadService(deps: {
  db: Database;
  now?: () => Date;
}): ActivityLoadService {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    async weekly({ organizationId, viewerUserId }) {
      const profile = await createWellnessProfileService({ db }).read(viewerUserId);
      if (profile.eligibility.state === "recorded" && profile.eligibility.value === "under_18")
        return {
          kind: "activity_load",
          status: "withheld",
          withheldReason: "adults_only",
          load: null,
        };

      const asOf = now().toISOString().slice(0, 10);
      const oldest = activityWindow(asOf, EFFORT_BASELINE_WINDOWS).start;
      const [sessions, totals] = await Promise.all([
        listActivitySessions(db, organizationId, { from: oldest, to: asOf }),
        listDailyActivityTotals(db, organizationId, 7),
      ]);
      const load = computeWeeklyActivityLoad({
        asOf,
        sessions,
        steps: totals.map((day) => ({ date: day.date, steps: day.steps })),
      });
      return { kind: "activity_load", status: "available", withheldReason: null, load };
    },
  };
}
