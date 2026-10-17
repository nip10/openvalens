import type { Database } from "@openvalens/db";
import { referenceComparisonOptIn } from "@openvalens/db/schema/profile";
import { listSleepDailySummaries } from "@openvalens/sleep";
import { and, eq } from "drizzle-orm";

import { createActivityLoadService } from "./activity-load";
import { listDailyMetricBySource } from "./insights";
import {
  COMPARISON_METRICS,
  type ComparisonMetric,
  type ComparisonSettings,
  type ComparisonSettingsUpdate,
  type ReferenceComparisonsResult,
} from "./reference-comparison-contract";
import {
  computeReferenceComparisons,
  referenceComparisonsAdultsOnly,
  USUAL_WINDOW_DAYS,
} from "./reference-comparison-compute";
import { REFERENCE_DATA_VERSION } from "./reference-data";
import { createWellnessProfileService } from "./wellness-profile";
import { deriveWellnessProfileInputs } from "./wellness-profile-contract";

/**
 * Issue #96 — loads the person's own series (resting heart rate, sleep, WHO
 * active minutes) and their profile inputs and opt-ins, and hands them to the
 * pure `computeReferenceComparisons`. Nothing is cached or stored, and no
 * other person's data is read: the reference values are the static tables in
 * `reference-data.ts`.
 *
 * Scoping: record reads are keyed only by the active organization from the
 * trusted authz context; the profile and opt-ins only by the signed-in user.
 * Population comparisons are offered only to the workspace owner, because the
 * viewer's age and sex do not describe someone else's records. No value is
 * logged.
 */

export type ReferenceComparisonScope = {
  organizationId: string;
  viewerUserId: string;
  viewerOwnsWorkspace: boolean;
};

export type ReferenceComparisonService = {
  compare(scope: ReferenceComparisonScope): Promise<ReferenceComparisonsResult>;
  settings(userId: string): Promise<ComparisonSettings>;
  updateSettings(
    userId: string,
    input: ComparisonSettingsUpdate,
  ): Promise<{ settings: ComparisonSettings; changed: boolean }>;
};

export function createReferenceComparisonService(deps: {
  db: Database;
  now?: () => Date;
}): ReferenceComparisonService {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  async function readSettings(userId: string): Promise<ComparisonSettings> {
    const rows = await db
      .select()
      .from(referenceComparisonOptIn)
      .where(eq(referenceComparisonOptIn.userId, userId));
    return {
      referenceDataVersion: REFERENCE_DATA_VERSION,
      optIns: COMPARISON_METRICS.map((metric) => {
        const row = rows.find((candidate) => candidate.metric === metric);
        return {
          metric,
          enabled: row !== undefined,
          referenceVersion: row?.referenceVersion ?? null,
          enabledAt: row?.enabledAt.toISOString() ?? null,
        };
      }),
    };
  }

  return {
    async compare({ organizationId, viewerUserId, viewerOwnsWorkspace }) {
      const at = now();
      const asOf = at.toISOString().slice(0, 10);
      const snapshot = await createWellnessProfileService({ db }).read(viewerUserId);
      if (snapshot.eligibility.state === "recorded" && snapshot.eligibility.value === "under_18")
        return referenceComparisonsAdultsOnly(asOf);

      const [settings, rhr, sleep, activity] = await Promise.all([
        readSettings(viewerUserId),
        listDailyMetricBySource(db, organizationId, "resting_heart_rate", USUAL_WINDOW_DAYS + 1),
        listSleepDailySummaries(db, organizationId, USUAL_WINDOW_DAYS + 1),
        createActivityLoadService({ db, now }).weekly({ organizationId, viewerUserId }),
      ]);
      const optedIn = new Set<ComparisonMetric>(
        settings.optIns.filter((optIn) => optIn.enabled).map((optIn) => optIn.metric),
      );
      return computeReferenceComparisons({
        asOf,
        profile: deriveWellnessProfileInputs(snapshot, at),
        viewerOwnsWorkspace,
        optedIn,
        restingHeartRate: rhr,
        sleepMinutes: sleep.map((day) => ({ date: day.date, value: day.asleepMinutes })),
        activeMinutes: activity.load?.activeMinutes ?? null,
      });
    },

    settings: readSettings,

    async updateSettings(userId, { metric, enabled }) {
      const where = and(
        eq(referenceComparisonOptIn.userId, userId),
        eq(referenceComparisonOptIn.metric, metric),
      );
      let changed: boolean;
      if (enabled) {
        const inserted = await db
          .insert(referenceComparisonOptIn)
          .values({ userId, metric, referenceVersion: REFERENCE_DATA_VERSION, enabledAt: now() })
          .onConflictDoNothing()
          .returning({ metric: referenceComparisonOptIn.metric });
        changed = inserted.length > 0;
      } else {
        const removed = await db
          .delete(referenceComparisonOptIn)
          .where(where)
          .returning({ metric: referenceComparisonOptIn.metric });
        changed = removed.length > 0;
      }
      return { settings: await readSettings(userId), changed };
    },
  };
}
