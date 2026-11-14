import { listDailyActivityTotals, type DailyActivityTotals } from "@openvalens/activity";
import {
  getBodyCompositionTimeline,
  getLatestWeight,
  listAllDexaScans,
  listLegacyCheckins,
} from "@openvalens/body";
import {
  createClinicalRepository,
  type BloodPanel,
  type BloodPanelWithContext,
} from "@openvalens/clinical";
import type { Database } from "@openvalens/db";
import { wellnessProfile } from "@openvalens/db/schema/profile";
import {
  createHealthRecordRepository,
  type TimelineFilters,
  type TimelinePage,
} from "@openvalens/health-record";
import { listLabMarkerLatest, type LabMarkerLatest } from "@openvalens/labs";
import {
  createNutritionTotals,
  type DailyTotals,
  type NutritionScope,
} from "@openvalens/nutrition";
import {
  createGoalRepository,
  createPersonalGoalRepository,
  createPlansRepository,
  type Goal,
  type GoalCheckin,
  type GoalSummary,
  type SupplementListItem,
  type SupplementSchedule,
} from "@openvalens/plans";
import { listAiPainEntries, type AiPainEntry } from "@openvalens/pain/service";
import { getSleepSummary, type SleepWindowSummary } from "@openvalens/sleep";
import { getPersonalSleepDailyEvidence } from "@openvalens/sleep/queries";
import {
  listAiReadableTrackers,
  listAiTrackerDays,
  type AiTrackerRow,
} from "@openvalens/trackers/service";
import { listDailyVitals, type DailyVitalsSummary } from "@openvalens/vitals";
import { eq } from "drizzle-orm";

export type BodyCompositionTimeline = Awaited<ReturnType<typeof getBodyCompositionTimeline>>;
export type DexaScanRow = Awaited<ReturnType<typeof listAllDexaScans>>[number];
export type LegacyWeightCheckinRow = Awaited<ReturnType<typeof listLegacyCheckins>>[number];

/**
 * Domain read ports for the AI health tools (Issues #124, #130).
 *
 * Every port takes the `organizationId` explicitly; the tools bind it from the
 * server-side authz context and never from model or client input. The default
 * implementation delegates to the existing org-scoped domain queries — the AI
 * package adds no SQL of its own, apart from reading the member's module
 * choice. Tests swap the ports for fakes.
 */
export type AiHealthToolSources = {
  listLabMarkers: (organizationId: string, recentLimit: number) => Promise<LabMarkerLatest[]>;
  listDailyVitals: (organizationId: string, days: number) => Promise<DailyVitalsSummary[]>;
  getSleepSummary: (organizationId: string, days: number) => Promise<SleepWindowSummary>;
  listDailyActivity: (organizationId: string, days: number) => Promise<DailyActivityTotals[]>;
  getLatestWeight: (
    organizationId: string,
  ) => Promise<{ date: string; weightKg: number } | null | undefined>;
  /** Blood panels, newest first (`@openvalens/clinical`). */
  listBloodPanels: (organizationId: string, limit: number) => Promise<BloodPanel[]>;
  /** One panel with its markers and recomputed range flags, or `null`. */
  getBloodPanel: (organizationId: string, panelId: number) => Promise<BloodPanelWithContext | null>;
  /** Canonical daily weights and body-composition events, newest first. */
  getBodyCompositionTimeline: (
    organizationId: string,
    limit: number,
  ) => Promise<BodyCompositionTimeline>;
  /** DEXA scans, newest first. */
  listDexaScans: (organizationId: string) => Promise<DexaScanRow[]>;
  /** Pre-materialization weight check-ins, newest first (fallback only). */
  listLegacyWeightCheckins: (
    organizationId: string,
    limit: number,
  ) => Promise<LegacyWeightCheckinRow[]>;
  /** Supplements with at least one schedule in the org (`@openvalens/plans`). */
  listSupplements: (organizationId: string) => Promise<SupplementListItem[]>;
  listSupplementSchedules: (
    organizationId: string,
    supplementId: number,
  ) => Promise<SupplementSchedule[]>;
  listGoals: (organizationId: string, userId: string) => Promise<Goal[]>;
  listGoalCheckins: (
    organizationId: string,
    userId: string,
    goalId: number,
  ) => Promise<GoalCheckin[]>;
  /**
   * The member's own personal goals of every source (#500), each with its
   * evaluation, newest first. Owner-only: never another member's goals.
   */
  listPersonalGoals: (scope: { organizationId: string; userId: string }) => Promise<GoalSummary[]>;
  /**
   * The modules the member switched on (`wellness_profile.enabled_modules`),
   * or `null` when they never chose, which reads as every module on.
   */
  getEnabledModules: (scope: { userId: string }) => Promise<readonly string[] | null>;
  /** Merged health-record timeline page (`@openvalens/health-record`). */
  listTimeline: (organizationId: string, filters: TimelineFilters) => Promise<TimelinePage>;
  /**
   * Per-day nutrition totals for one member (Issue #86). Nutrition is
   * member-private, so this port takes the full {@link NutritionScope} the
   * tool derives from the session — never just the organization.
   */
  listNutritionDailyTotals: (
    scope: NutritionScope,
    range: { from: string; to: string },
  ) => Promise<DailyTotals[]>;
  /**
   * The member's own custom trackers that have "Coach and connected AI apps
   * can read this" on (#441), each with its per-day values in the range. No
   * notes, and never another member's tracker.
   */
  listAiTrackers: (
    scope: { organizationId: string; userId: string },
    range: { from: string; to: string },
  ) => Promise<AiTrackerWithDays[]>;
  /**
   * The member's own pain entries by local date (#442), newest first: none
   * unless the pain log and its AI switch are both on. Never notes, never
   * another member's entries.
   */
  listAiPain: (
    scope: { organizationId: string; userId: string },
    range: { from: string; to: string; limit: number },
  ) => Promise<AiPainRow[]>;
};

export type AiPainRow = AiPainEntry;

export type AiTrackerWithDays = AiTrackerRow & {
  /** Newest first. */
  days: { date: string; value: number; count: number }[];
};

/** Binds the ports to the real domain packages for one database handle. */
export function createDomainHealthToolSources(db: Database, userId: string): AiHealthToolSources {
  const clinical = createClinicalRepository(db);
  const plans = createPlansRepository(db);
  const goals = createGoalRepository(db, userId);
  const healthRecord = createHealthRecordRepository(db);
  const nutritionTotals = createNutritionTotals(db);
  return {
    listLabMarkers: (organizationId, recentLimit) =>
      listLabMarkerLatest(db, organizationId, recentLimit),
    listDailyVitals: (organizationId, days) => listDailyVitals(db, organizationId, days),
    getSleepSummary: (organizationId, days) => getSleepSummary(db, organizationId, days),
    listDailyActivity: (organizationId, days) => listDailyActivityTotals(db, organizationId, days),
    getLatestWeight: (organizationId) => getLatestWeight(db, organizationId),
    listBloodPanels: (organizationId, limit) => clinical.listBloodPanels(organizationId, limit),
    getBloodPanel: (organizationId, panelId) => clinical.getBloodPanel(organizationId, panelId),
    getBodyCompositionTimeline: (organizationId, limit) =>
      getBodyCompositionTimeline(db, organizationId, limit),
    listDexaScans: (organizationId) => listAllDexaScans(db, organizationId),
    listLegacyWeightCheckins: (organizationId, limit) =>
      listLegacyCheckins(db, organizationId, limit),
    listSupplements: (organizationId) => plans.listSupplements(organizationId),
    listSupplementSchedules: (organizationId, supplementId) =>
      plans.listSchedules(organizationId, supplementId),
    listGoals: async (organizationId) =>
      (await goals.listGoals(organizationId)).filter((item) => item.deletedAt == null),
    listGoalCheckins: async (organizationId, _userId, goalId) =>
      (await goals.listCheckins(organizationId, goalId)).filter((item) => item.deletedAt == null),
    listPersonalGoals: (scope) =>
      createPersonalGoalRepository(db, scope.organizationId, scope.userId, (range) =>
        getPersonalSleepDailyEvidence(db, { ...scope, ...range }),
      ).list(),
    getEnabledModules: async (scope) => {
      const rows = await db
        .select({ enabledModules: wellnessProfile.enabledModules })
        .from(wellnessProfile)
        .where(eq(wellnessProfile.userId, scope.userId))
        .limit(1);
      return rows[0]?.enabledModules ?? null;
    },
    listTimeline: (organizationId, filters) => healthRecord.listTimeline(organizationId, filters),
    listNutritionDailyTotals: (scope, range) => nutritionTotals.listDays(scope, range),
    listAiTrackers: async (scope, range) => {
      const trackers = await listAiReadableTrackers(db, scope);
      const days = await listAiTrackerDays(db, scope, trackers, range);
      return trackers.map((tracker) => ({ ...tracker, days: days.get(tracker.id) ?? [] }));
    },
    listAiPain: (scope, range) => listAiPainEntries(db, scope, range),
  };
}
