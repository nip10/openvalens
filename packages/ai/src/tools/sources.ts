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
import {
  createHealthRecordRepository,
  type TimelineFilters,
  type TimelinePage,
} from "@openvalens/health-record";
import { listLabMarkerLatest, type LabMarkerLatest } from "@openvalens/labs";
import {
  createGoalRepository,
  createPlansRepository,
  type Goal,
  type GoalCheckin,
  type SupplementListItem,
  type SupplementSchedule,
} from "@openvalens/plans";
import { getSleepSummary, type SleepWindowSummary } from "@openvalens/sleep";
import { listDailyVitals, type DailyVitalsSummary } from "@openvalens/vitals";

export type BodyCompositionTimeline = Awaited<ReturnType<typeof getBodyCompositionTimeline>>;
export type DexaScanRow = Awaited<ReturnType<typeof listAllDexaScans>>[number];
export type LegacyWeightCheckinRow = Awaited<ReturnType<typeof listLegacyCheckins>>[number];

/**
 * Domain read ports for the AI health tools (Issues #124, #130).
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
  listGoals: (organizationId: string) => Promise<Goal[]>;
  listGoalCheckins: (organizationId: string, goalId: number) => Promise<GoalCheckin[]>;
  /** Merged health-record timeline page (`@openvalens/health-record`). */
  listTimeline: (organizationId: string, filters: TimelineFilters) => Promise<TimelinePage>;
};

/** Binds the ports to the real domain packages for one database handle. */
export function createDomainHealthToolSources(db: Database): AiHealthToolSources {
  const clinical = createClinicalRepository(db);
  const plans = createPlansRepository(db);
  const goals = createGoalRepository(db);
  const healthRecord = createHealthRecordRepository(db);
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
    listGoals: (organizationId) => goals.listGoals(organizationId),
    listGoalCheckins: (organizationId, goalId) => goals.listCheckins(organizationId, goalId),
    listTimeline: (organizationId, filters) => healthRecord.listTimeline(organizationId, filters),
  };
}
