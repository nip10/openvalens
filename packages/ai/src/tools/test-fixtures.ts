import type {
  BloodMarkerWithContext,
  BloodPanel,
  BloodPanelWithContext,
} from "@openvalens/clinical";
import type { Database } from "@openvalens/db";
import { userAiConsent } from "@openvalens/db/schema/auth";
import { nutritionCoachConsent } from "@openvalens/db/schema/nutrition";
import type { TimelineEvent } from "@openvalens/health-record";
import type { LabMarkerLatest } from "@openvalens/labs";
import type { DailyTotals } from "@openvalens/nutrition";
import type { Goal, GoalCheckin, SupplementListItem, SupplementSchedule } from "@openvalens/plans";
import type { SleepDailySummary, SleepWindowSummary } from "@openvalens/sleep";
import type { StructuredLogger } from "@openvalens/observability";

import type { AiHealthToolContext } from "./access";
import type {
  AiHealthToolSources,
  BodyCompositionTimeline,
  DexaScanRow,
  LegacyWeightCheckinRow,
} from "./sources";

/**
 * Synthetic fixtures shared by the AI health tool unit tests (Issues #124,
 * #130).
 * No real people, values or dates.
 */

export const ORG_A = "org-tools-a";
export const ORG_B = "org-tools-b";
export const USER_A = "user-tools-a";
export const FIXED_NOW = new Date("2026-03-10T12:00:00.000Z");

export type ConsentFixture = {
  orgMetadata: unknown;
  userGranted: boolean | null;
};

export const FULL_CONSENT: ConsentFixture = {
  orgMetadata: { aiConsent: { enabled: true, scope: "insights" } },
  userGranted: true,
};

/** Per-member Coach nutrition-context consent fixture (Issue #86). */
export type NutritionConsentFixture = {
  granted: boolean;
  includeNumbers: boolean;
  consentVersion?: string;
} | null;

/** Drizzle-shaped fake answering only the consent reads (#123, #86). */
export function createConsentDb(
  consent: ConsentFixture,
  nutrition: NutritionConsentFixture = null,
): Database {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === userAiConsent) {
              if (consent.userGranted === null) return [];
              return [
                {
                  granted: consent.userGranted,
                  grantedAt: new Date("2026-01-01T00:00:00.000Z"),
                  revokedAt: consent.userGranted ? null : new Date("2026-01-02T00:00:00.000Z"),
                  consentVersion: "v1",
                },
              ];
            }
            if (table === nutritionCoachConsent) {
              if (nutrition === null) return [];
              return [
                {
                  granted: nutrition.granted,
                  includeNumbers: nutrition.includeNumbers,
                  grantedAt: new Date("2026-01-01T00:00:00.000Z"),
                  revokedAt: nutrition.granted ? null : new Date("2026-01-02T00:00:00.000Z"),
                  consentVersion: nutrition.consentVersion ?? "v1",
                },
              ];
            }
            return [{ metadata: consent.orgMetadata }];
          },
        }),
      }),
    }),
  } as unknown as Database;
}

export function emptySleepSummary(): SleepWindowSummary {
  return {
    days: [],
    lastNight: null,
    sevenDayAverageMinutes: null,
    averageSleepDebtMinutes: null,
    status: "low_confidence",
    confidence: "low",
  };
}

export function sleepDay(date: string, asleepMinutes: number): SleepDailySummary {
  return {
    date,
    mainSleepStart: `${date}T00:00:00.000Z`,
    mainSleepEnd: `${date}T07:00:00.000Z`,
    mainSleepAsleepMinutes: asleepMinutes,
    asleepMinutes,
    timeInBedMinutes: asleepMinutes + 20,
    awakeMinutes: 20,
    sleepEfficiencyPct: 95,
    deepMinutes: 60,
    remMinutes: 90,
    lightMinutes: asleepMinutes - 150,
    unknownStageMinutes: 0,
    interruptionsCount: 1,
    sleepMidpoint: `${date}T03:30:00.000Z`,
    targetMinutes: 450,
    sleepDebtMinutes: Math.max(0, 450 - asleepMinutes),
    qualityScore: 80,
    confidence: "high",
    status: "acceptable",
    // Sensitive-looking extras the tool must not copy into its output.
    sourceSummary: "SYNTHETIC_DEVICE_NAME",
    sessionIds: ["SYNTHETIC_SESSION_ID"],
  };
}

export function marker(
  code: string,
  displayName: string,
  unit: string | null,
  values: number[],
): LabMarkerLatest {
  const recentValues = values.map((value, index) => ({
    sampledAt: new Date(Date.UTC(2026, 0, 1 + index * 7)).toISOString(),
    value,
  }));
  const latest = recentValues.at(-1);
  return {
    code,
    displayName,
    unit,
    latestValue: latest?.value ?? null,
    latestSampledAt: latest?.sampledAt ?? null,
    sampleCount: recentValues.length,
    recentValues,
  };
}

export type SourceCalls = Array<{ port: keyof AiHealthToolSources; organizationId: string }>;

/**
 * Per-organization fake ports. Each read records the org it was asked for so
 * tests can assert the tool never asks for anything but the bound org.
 */
export function createFakeSources(data: Partial<Record<string, Partial<FakeOrgData>>>): {
  sources: AiHealthToolSources;
  calls: SourceCalls;
} {
  const calls: SourceCalls = [];
  const forOrg = (organizationId: string): FakeOrgData => ({
    labs: [],
    vitals: [],
    sleep: emptySleepSummary(),
    activity: [],
    latestWeight: null,
    bloodPanels: [],
    dexaScans: [],
    bodyComp: { canonicalDailyPoints: [], compositionMarkers: [] },
    legacyCheckins: [],
    supplements: [],
    goals: [],
    timeline: [],
    nutritionTotals: [],
    ...data[organizationId],
  });

  return {
    calls,
    sources: {
      listLabMarkers: async (organizationId) => {
        calls.push({ port: "listLabMarkers", organizationId });
        return forOrg(organizationId).labs;
      },
      listDailyVitals: async (organizationId) => {
        calls.push({ port: "listDailyVitals", organizationId });
        return forOrg(organizationId).vitals;
      },
      getSleepSummary: async (organizationId) => {
        calls.push({ port: "getSleepSummary", organizationId });
        return forOrg(organizationId).sleep;
      },
      listDailyActivity: async (organizationId) => {
        calls.push({ port: "listDailyActivity", organizationId });
        return forOrg(organizationId).activity;
      },
      getLatestWeight: async (organizationId) => {
        calls.push({ port: "getLatestWeight", organizationId });
        return forOrg(organizationId).latestWeight;
      },
      listBloodPanels: async (organizationId, limit) => {
        calls.push({ port: "listBloodPanels", organizationId });
        return newestPanelsFirst(forOrg(organizationId).bloodPanels)
          .slice(0, limit)
          .map((entry) => entry.panel);
      },
      getBloodPanel: async (organizationId, panelId) => {
        calls.push({ port: "getBloodPanel", organizationId });
        return (
          forOrg(organizationId).bloodPanels.find((entry) => entry.panel.id === panelId) ?? null
        );
      },
      getBodyCompositionTimeline: async (organizationId, limit) => {
        calls.push({ port: "getBodyCompositionTimeline", organizationId });
        const { canonicalDailyPoints, compositionMarkers } = forOrg(organizationId).bodyComp;
        return {
          canonicalDailyPoints: canonicalDailyPoints.slice(0, limit),
          compositionMarkers: compositionMarkers.slice(0, limit),
        };
      },
      listDexaScans: async (organizationId) => {
        calls.push({ port: "listDexaScans", organizationId });
        return forOrg(organizationId).dexaScans;
      },
      listLegacyWeightCheckins: async (organizationId, limit) => {
        calls.push({ port: "listLegacyWeightCheckins", organizationId });
        return forOrg(organizationId).legacyCheckins.slice(0, limit);
      },
      listSupplements: async (organizationId) => {
        calls.push({ port: "listSupplements", organizationId });
        return forOrg(organizationId).supplements.map((entry) => entry.supplement);
      },
      listSupplementSchedules: async (organizationId, supplementId) => {
        calls.push({ port: "listSupplementSchedules", organizationId });
        return (
          forOrg(organizationId).supplements.find((entry) => entry.supplement.id === supplementId)
            ?.schedules ?? []
        );
      },
      listGoals: async (organizationId) => {
        calls.push({ port: "listGoals", organizationId });
        return forOrg(organizationId).goals.map((entry) => entry.goal);
      },
      listGoalCheckins: async (organizationId, goalId) => {
        calls.push({ port: "listGoalCheckins", organizationId });
        return (
          forOrg(organizationId).goals.find((entry) => entry.goal.id === goalId)?.checkins ?? []
        );
      },
      listTimeline: async (organizationId, filters) => {
        calls.push({ port: "listTimeline", organizationId });
        const from = filters.from ? Date.parse(`${filters.from}T00:00:00.000Z`) : -Infinity;
        const to = filters.to ? Date.parse(filters.to) : Infinity;
        const matching = forOrg(organizationId)
          .timeline.filter((entry) => Date.parse(entry.at) >= from && Date.parse(entry.at) <= to)
          .sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at > b.at ? -1 : 1));
        const limit = filters.limit ?? 50;
        return {
          items: matching.slice(0, limit),
          nextCursor: matching.length > limit ? "cursor" : null,
        };
      },
      listNutritionDailyTotals: async (scope, range) => {
        calls.push({ port: "listNutritionDailyTotals", organizationId: scope.organizationId });
        return forOrg(scope.organizationId).nutritionTotals.filter(
          (day) => day.localDate >= range.from && day.localDate <= range.to,
        );
      },
    },
  };
}

export type FakeOrgData = {
  labs: LabMarkerLatest[];
  vitals: Awaited<ReturnType<AiHealthToolSources["listDailyVitals"]>>;
  sleep: SleepWindowSummary;
  activity: Awaited<ReturnType<AiHealthToolSources["listDailyActivity"]>>;
  latestWeight: Awaited<ReturnType<AiHealthToolSources["getLatestWeight"]>>;
  bloodPanels: BloodPanelWithContext[];
  dexaScans: DexaScanRow[];
  bodyComp: BodyCompositionTimeline;
  legacyCheckins: LegacyWeightCheckinRow[];
  supplements: Array<{ supplement: SupplementListItem; schedules: SupplementSchedule[] }>;
  goals: Array<{ goal: Goal; checkins: GoalCheckin[] }>;
  timeline: TimelineEvent[];
  nutritionTotals: DailyTotals[];
};

function newestPanelsFirst(panels: readonly BloodPanelWithContext[]): BloodPanelWithContext[] {
  return [...panels].sort((a, b) =>
    a.panel.date === b.panel.date ? b.panel.id - a.panel.id : a.panel.date < b.panel.date ? 1 : -1,
  );
}

// ─── Issue #130 fixture builders (synthetic only) ──────────────

export type MarkerFixture = {
  testKey: string;
  value: number | null;
  testName?: string;
  category?: string;
  unit?: string | null;
  valueText?: string | null;
  flag?: string | null;
  outOfRangeFlag?: "HIGH" | "LOW" | null;
  refRangeLow?: number | null;
  refRangeHigh?: number | null;
};

/**
 * One blood panel with markers. Facility, physician, notes and file paths are
 * filled with sentinel strings so tests can assert they never leak.
 */
export function bloodPanel(
  id: number,
  date: string,
  markers: MarkerFixture[],
  organizationId = ORG_A,
): BloodPanelWithContext {
  const panel: BloodPanel = {
    id,
    organizationId,
    date,
    context: "SYNTHETIC_PANEL_CONTEXT",
    facility: "SYNTHETIC_FACILITY",
    physician: "SYNTHETIC_PHYSICIAN",
    sourceFile: "SYNTHETIC_SOURCE_FILE.md",
    pdfPath: "SYNTHETIC_PDF_PATH.pdf",
    notes: "SYNTHETIC_PANEL_NOTE",
    createdAt: `${date}T00:00:00.000Z`,
  };
  const rows: BloodMarkerWithContext[] = markers.map((m, index) => ({
    id: id * 1000 + index,
    organizationId,
    panelId: id,
    category: m.category ?? "Biochemistry",
    subcategory: null,
    testName: m.testName ?? m.testKey,
    testKey: m.testKey,
    valueNumeric: m.value,
    valueText: m.valueText ?? null,
    unit: m.unit === undefined ? "mg/dL" : m.unit,
    refRangeLow: m.refRangeLow ?? null,
    refRangeHigh: m.refRangeHigh ?? null,
    refRangeText: null,
    flag: m.flag ?? null,
    outOfRangeFlag: m.outOfRangeFlag ?? null,
    flaggedBySource: m.flag === "HIGH" || m.flag === "LOW" || m.flag === "CRITICAL",
  }));
  return {
    panel,
    markers: rows,
    markerInfos: [],
    outOfRangeCount: rows.filter((row) => row.outOfRangeFlag !== null).length,
  };
}

export function dexaScanRow(
  id: number,
  date: string,
  overrides: Partial<DexaScanRow> = {},
): DexaScanRow {
  return {
    id,
    organizationId: ORG_A,
    date,
    height: 180,
    weight: 75,
    age: 40,
    totalMass: 75,
    fatMass: 15_000,
    leanMass: 57_000,
    boneMineralContent: 3_000,
    bodyFatPct: 20,
    leanTissuePct: 76,
    bmi: 23.1,
    androidFatPct: 22,
    gynoidFatPct: 24,
    agRatio: 0.92,
    rmr: 1700,
    rsmi: 8.1,
    bmdTotal: 1.234,
    tScore: 0.5,
    zScore: 0.4,
    bmdPercentile: 60,
    sourceFile: "SYNTHETIC_DEXA_FILE.pdf",
    createdAt: `${date}T00:00:00.000Z`,
    ...overrides,
  };
}

export function supplementEntry(
  id: number,
  name: string,
  statuses: Array<"active" | "paused" | "stopped">,
): { supplement: SupplementListItem; schedules: SupplementSchedule[] } {
  return {
    supplement: {
      id,
      name,
      dose: "1000 IU",
      form: "capsule",
      category: "vitamin",
      latestChangeReason: "SYNTHETIC_CHANGE_REASON",
      latestChangeDate: "2026-02-01",
      activeScheduleCount: statuses.filter((status) => status === "active").length,
    },
    schedules: statuses.map((status, index) => ({
      id: id * 100 + index,
      organizationId: ORG_A,
      userId: USER_A,
      supplementId: id,
      timeOfDay: "morning",
      quantity: "1",
      frequency: "daily",
      notes: "SYNTHETIC_SCHEDULE_NOTE",
      status,
    })),
  };
}

export function goalEntry(
  id: number,
  title: string,
  status: string,
  values: { current?: string | null; target?: string | null; checkins?: string[] } = {},
): { goal: Goal; checkins: GoalCheckin[] } {
  return {
    goal: {
      id,
      organizationId: ORG_A,
      title,
      category: "body_composition",
      horizon: "medium",
      status,
      currentValue: values.current ?? null,
      targetValue: values.target ?? null,
      targetDate: "2026-06-30",
      notes: "SYNTHETIC_GOAL_NOTE",
      direction: null,
      baselineValue: null,
      priority: null,
    },
    checkins: (values.checkins ?? []).map((value, index) => ({
      id: id * 100 + index,
      organizationId: ORG_A,
      goalId: id,
      date: `2026-02-0${index + 1}`,
      value,
      notes: "SYNTHETIC_CHECKIN_NOTE",
      createdAt: "2026-02-01T00:00:00.000Z",
    })),
  };
}

export function timelineEntry(
  id: string,
  at: string,
  overrides: Partial<TimelineEvent> = {},
): TimelineEvent {
  return {
    kind: "event",
    id,
    at,
    domain: "sleep",
    title: "SYNTHETIC_EVENT_TITLE",
    summary: "SYNTHETIC_EVENT_SUMMARY",
    severity: "none",
    confidence: "high",
    reviewState: "unreviewed",
    sourceRefs: [{ type: "data_source", label: "SYNTHETIC_DEVICE_NAME", id: 77 }],
    provenanceRefs: [],
    relatedRefs: [],
    canonical: { diagnosis: "SYNTHETIC_DIAGNOSIS" },
    ...overrides,
  };
}

/** Logger that captures every record in memory instead of writing to stdout. */
export function createCapturingLogger(): {
  logger: StructuredLogger;
  records: Array<{ level: string; event: string; metadata?: Record<string, unknown> }>;
} {
  const records: Array<{ level: string; event: string; metadata?: Record<string, unknown> }> = [];
  const make = (): StructuredLogger => ({
    debug: (event, metadata) => records.push({ level: "debug", event, metadata }),
    info: (event, metadata) => records.push({ level: "info", event, metadata }),
    warn: (event, metadata) => records.push({ level: "warn", event, metadata }),
    error: (event, metadata) => records.push({ level: "error", event, metadata }),
    child: () => make(),
  });
  return { logger: make(), records };
}

export function toolContext(
  overrides: Partial<AiHealthToolContext> & {
    consent?: ConsentFixture;
    nutritionConsent?: NutritionConsentFixture;
  } = {},
): AiHealthToolContext {
  const { consent, nutritionConsent, ...rest } = overrides;
  return {
    db: createConsentDb(consent ?? FULL_CONSENT, nutritionConsent ?? null),
    organizationId: ORG_A,
    userId: USER_A,
    canReadRecords: async () => true,
    now: () => FIXED_NOW,
    correlationId: "corr-tools-1",
    logger: createCapturingLogger().logger,
    ...rest,
  };
}
