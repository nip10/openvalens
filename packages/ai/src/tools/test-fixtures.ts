import type { Database } from "@openvalens/db";
import { userAiConsent } from "@openvalens/db/schema/auth";
import type { LabMarkerLatest } from "@openvalens/labs";
import type { SleepDailySummary, SleepWindowSummary } from "@openvalens/sleep";
import type { StructuredLogger } from "@openvalens/observability";

import type { AiHealthToolContext } from "./access";
import type { AiHealthToolSources } from "./sources";

/**
 * Synthetic fixtures shared by the AI health tool unit tests (Issue #124).
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

/** Drizzle-shaped fake answering only the two consent reads. */
export function createConsentDb(consent: ConsentFixture): Database {
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
    },
  };
}

export type FakeOrgData = {
  labs: LabMarkerLatest[];
  vitals: Awaited<ReturnType<AiHealthToolSources["listDailyVitals"]>>;
  sleep: SleepWindowSummary;
  activity: Awaited<ReturnType<AiHealthToolSources["listDailyActivity"]>>;
  latestWeight: Awaited<ReturnType<AiHealthToolSources["getLatestWeight"]>>;
};

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
  overrides: Partial<AiHealthToolContext> & { consent?: ConsentFixture } = {},
): AiHealthToolContext {
  const { consent, ...rest } = overrides;
  return {
    db: createConsentDb(consent ?? FULL_CONSENT),
    organizationId: ORG_A,
    userId: USER_A,
    canReadRecords: async () => true,
    now: () => FIXED_NOW,
    correlationId: "corr-tools-1",
    logger: createCapturingLogger().logger,
    ...rest,
  };
}
