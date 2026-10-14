import { listDailyActivityTotals, type DailyActivityTotals } from "@openvalens/activity";
import { getLatestWeight } from "@openvalens/body";
import type { Database } from "@openvalens/db";
import { listLabMarkerLatest, type LabMarkerLatest } from "@openvalens/labs";
import { getSleepSummary, type SleepWindowSummary } from "@openvalens/sleep";
import { listDailyVitals, type DailyVitalsSummary } from "@openvalens/vitals";

/**
 * Domain read ports for the AI health tools (Issue #124).
 *
 * Every port takes the `organizationId` explicitly; the tools bind it from the
 * server-side authz context and never from model or client input. The default
 * implementation delegates to the existing org-scoped domain queries — the AI
 * package adds no SQL of its own. Tests swap the ports for fakes.
 */
export type AiHealthToolSources = {
  listLabMarkers: (organizationId: string, recentLimit: number) => Promise<LabMarkerLatest[]>;
  listDailyVitals: (organizationId: string, days: number) => Promise<DailyVitalsSummary[]>;
  getSleepSummary: (organizationId: string, days: number) => Promise<SleepWindowSummary>;
  listDailyActivity: (organizationId: string, days: number) => Promise<DailyActivityTotals[]>;
  getLatestWeight: (
    organizationId: string,
  ) => Promise<{ date: string; weightKg: number } | null | undefined>;
};

/** Binds the ports to the real domain packages for one database handle. */
export function createDomainHealthToolSources(db: Database): AiHealthToolSources {
  return {
    listLabMarkers: (organizationId, recentLimit) =>
      listLabMarkerLatest(db, organizationId, recentLimit),
    listDailyVitals: (organizationId, days) => listDailyVitals(db, organizationId, days),
    getSleepSummary: (organizationId, days) => getSleepSummary(db, organizationId, days),
    listDailyActivity: (organizationId, days) => listDailyActivityTotals(db, organizationId, days),
    getLatestWeight: (organizationId) => getLatestWeight(db, organizationId),
  };
}
