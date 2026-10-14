import type { DailyActivityTotals } from "@openvalens/activity";
import type { LabMarkerLatest } from "@openvalens/labs";
import type { SleepWindowSummary } from "@openvalens/sleep";
import type { DailyVitalsSummary } from "@openvalens/vitals";
import { tool } from "ai";
import { z } from "zod";

import { resolveToolAccess, type AiHealthToolContext } from "./access";

/**
 * `healthSnapshot` tool (Issue #13, real data since Issue #124).
 *
 * Reads the active organization's recorded labs, heart rate, sleep, activity
 * and latest weight through the existing domain queries at call time — there
 * is no cache, so every call reflects what is stored right now.
 *
 * Redaction: the output is an explicit allowlist of measurements, units,
 * dates and counts. Row ids, user ids, data-source / device names, sleep
 * session titles, and free-text notes are never copied into it, so none of
 * them reach the model provider.
 *
 * Missing data is reported as `status: "no_data"` with `null` values — the
 * tool never fills gaps with defaults. The output describes what is recorded;
 * it carries no reference ranges and makes no clinical judgement.
 */

/** Days covered by the vitals and activity windows. */
export const HEALTH_SNAPSHOT_WINDOW_DAYS = 7;
/** Sleep look-back, so a seven-night average has room to fill. */
export const HEALTH_SNAPSHOT_SLEEP_DAYS = 14;
/** Upper bound on markers listed, to keep the prompt small. */
export const HEALTH_SNAPSHOT_MAX_MARKERS = 25;

const sectionStatus = z.enum(["ok", "no_data"]);

const labsSection = z.object({
  status: sectionStatus,
  definedMarkerCount: z.number(),
  markersWithReadings: z.number(),
  latestSampledAt: z.string().nullable(),
  markers: z.array(
    z.object({
      code: z.string(),
      displayName: z.string(),
      unit: z.string().nullable(),
      latestValue: z.number(),
      latestSampledAt: z.string(),
    }),
  ),
});

const vitalsSection = z.object({
  status: sectionStatus,
  windowDays: z.number(),
  daysWithData: z.number(),
  averageHeartRateBpm: z.number().nullable(),
  averageRestingHeartRateBpm: z.number().nullable(),
  latestDate: z.string().nullable(),
});

const sleepSection = z.object({
  status: sectionStatus,
  nightsWithData: z.number(),
  lastNightDate: z.string().nullable(),
  lastNightAsleepMinutes: z.number().nullable(),
  sevenDayAverageMinutes: z.number().nullable(),
  averageSleepDebtMinutes: z.number().nullable(),
  sleepStatus: z.string().nullable(),
  confidence: z.enum(["low", "medium", "high"]).nullable(),
});

const activitySection = z.object({
  status: sectionStatus,
  windowDays: z.number(),
  daysWithSteps: z.number(),
  averageDailySteps: z.number().nullable(),
  latestDate: z.string().nullable(),
});

const bodySection = z.object({
  status: sectionStatus,
  latestWeightKg: z.number().nullable(),
  latestWeightDate: z.string().nullable(),
});

export const healthSnapshotOutput = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    generatedAt: z.string(),
    labs: labsSection,
    vitals: vitalsSection,
    sleep: sleepSection,
    activity: activitySection,
    body: bodySection,
  }),
  z.object({
    status: z.literal("no_data"),
    generatedAt: z.string(),
    summary: z.string(),
  }),
  z.object({
    status: z.literal("unavailable"),
    generatedAt: z.string(),
    reason: z.enum(["permission_denied", "consent_required"]),
  }),
]);

export type HealthSnapshotOutput = z.infer<typeof healthSnapshotOutput>;

export type HealthSnapshotInputs = {
  labs: LabMarkerLatest[];
  vitals: DailyVitalsSummary[];
  sleep: SleepWindowSummary;
  activity: DailyActivityTotals[];
  latestWeight: { date: string; weightKg: number } | null | undefined;
};

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildLabs(markers: LabMarkerLatest[]): z.infer<typeof labsSection> {
  const withReadings = markers.filter(
    (marker): marker is LabMarkerLatest & { latestValue: number; latestSampledAt: string } =>
      marker.latestValue !== null && marker.latestSampledAt !== null,
  );
  const latestSampledAt =
    withReadings
      .map((marker) => marker.latestSampledAt)
      .sort()
      .at(-1) ?? null;

  return {
    status: withReadings.length > 0 ? "ok" : "no_data",
    definedMarkerCount: markers.length,
    markersWithReadings: withReadings.length,
    latestSampledAt,
    markers: withReadings.slice(0, HEALTH_SNAPSHOT_MAX_MARKERS).map((marker) => ({
      code: marker.code,
      displayName: marker.displayName,
      unit: marker.unit,
      latestValue: marker.latestValue,
      latestSampledAt: marker.latestSampledAt,
    })),
  };
}

function buildVitals(days: DailyVitalsSummary[]): z.infer<typeof vitalsSection> {
  const withData = days.filter(
    (day) => day.heartRate.sampleCount > 0 || day.restingHeartRate.sampleCount > 0,
  );
  const heartRate = mean(
    withData.flatMap((day) => (day.heartRate.avgBpm === null ? [] : [day.heartRate.avgBpm])),
  );
  const resting = mean(
    withData.flatMap((day) =>
      day.restingHeartRate.avgBpm === null ? [] : [day.restingHeartRate.avgBpm],
    ),
  );

  return {
    status: withData.length > 0 ? "ok" : "no_data",
    windowDays: HEALTH_SNAPSHOT_WINDOW_DAYS,
    daysWithData: withData.length,
    averageHeartRateBpm: heartRate === null ? null : round(heartRate, 1),
    averageRestingHeartRateBpm: resting === null ? null : round(resting, 1),
    latestDate: withData.at(-1)?.date ?? null,
  };
}

function buildSleep(summary: SleepWindowSummary): z.infer<typeof sleepSection> {
  if (summary.days.length === 0) {
    return {
      status: "no_data",
      nightsWithData: 0,
      lastNightDate: null,
      lastNightAsleepMinutes: null,
      sevenDayAverageMinutes: null,
      averageSleepDebtMinutes: null,
      sleepStatus: null,
      confidence: null,
    };
  }

  const lastNight = summary.lastNight;
  return {
    status: "ok",
    nightsWithData: summary.days.length,
    lastNightDate: lastNight?.date ?? null,
    lastNightAsleepMinutes: lastNight
      ? (lastNight.mainSleepAsleepMinutes ?? lastNight.asleepMinutes)
      : null,
    sevenDayAverageMinutes: summary.sevenDayAverageMinutes,
    averageSleepDebtMinutes: summary.averageSleepDebtMinutes,
    sleepStatus: summary.status,
    confidence: summary.confidence,
  };
}

function buildActivity(days: DailyActivityTotals[]): z.infer<typeof activitySection> {
  const withSteps = days.filter(
    (day): day is DailyActivityTotals & { steps: number } => day.steps !== null,
  );
  const average = mean(withSteps.map((day) => day.steps));

  return {
    status: withSteps.length > 0 ? "ok" : "no_data",
    windowDays: HEALTH_SNAPSHOT_WINDOW_DAYS,
    daysWithSteps: withSteps.length,
    averageDailySteps: average === null ? null : Math.round(average),
    latestDate: withSteps.at(-1)?.date ?? null,
  };
}

function buildBody(
  latest: { date: string; weightKg: number } | null | undefined,
): z.infer<typeof bodySection> {
  if (!latest) {
    return { status: "no_data", latestWeightKg: null, latestWeightDate: null };
  }
  return {
    status: "ok",
    latestWeightKg: round(latest.weightKg, 2),
    latestWeightDate: latest.date,
  };
}

/**
 * Pure projection of the domain reads into the redacted snapshot. When no
 * section has any data the whole snapshot collapses to `status: "no_data"`, so
 * the model gets an unambiguous "nothing recorded" instead of a page of nulls.
 */
export function buildHealthSnapshot(
  inputs: HealthSnapshotInputs,
  now: Date = new Date(),
): HealthSnapshotOutput {
  const labs = buildLabs(inputs.labs);
  const vitals = buildVitals(inputs.vitals);
  const sleep = buildSleep(inputs.sleep);
  const activity = buildActivity(inputs.activity);
  const body = buildBody(inputs.latestWeight);
  const generatedAt = now.toISOString();

  const sections = [labs, vitals, sleep, activity, body];
  if (sections.every((section) => section.status === "no_data")) {
    return {
      status: "no_data",
      generatedAt,
      summary: "No labs, heart rate, sleep, activity or weight records are stored yet.",
    };
  }

  return { status: "ok", generatedAt, labs, vitals, sleep, activity, body };
}

/** Freshly reads every domain for the bound organization and builds the snapshot. */
export async function executeHealthSnapshot(
  context: AiHealthToolContext,
): Promise<HealthSnapshotOutput> {
  const access = await resolveToolAccess(context, "healthSnapshot");
  if (!access.allowed) {
    return { status: "unavailable", generatedAt: access.now.toISOString(), reason: access.reason };
  }

  const { sources } = access;
  const organizationId = context.organizationId;
  const [labs, vitals, sleep, activity, latestWeight] = await Promise.all([
    sources.listLabMarkers(organizationId, 2),
    sources.listDailyVitals(organizationId, HEALTH_SNAPSHOT_WINDOW_DAYS),
    sources.getSleepSummary(organizationId, HEALTH_SNAPSHOT_SLEEP_DAYS),
    sources.listDailyActivity(organizationId, HEALTH_SNAPSHOT_WINDOW_DAYS),
    sources.getLatestWeight(organizationId),
  ]);

  const snapshot = buildHealthSnapshot({ labs, vitals, sleep, activity, latestWeight }, access.now);

  // Counts and statuses only — never a measured value.
  access.logger.info("ai.tool.executed", {
    correlationId: context.correlationId,
    organizationId,
    tool: "healthSnapshot",
    status: snapshot.status,
    ...(snapshot.status === "ok"
      ? {
          markersWithReadings: snapshot.labs.markersWithReadings,
          vitalsDays: snapshot.vitals.daysWithData,
          sleepNights: snapshot.sleep.nightsWithData,
          activityDays: snapshot.activity.daysWithSteps,
          hasWeight: snapshot.body.status === "ok",
        }
      : {}),
  });

  return snapshot;
}

export function createHealthSnapshotTool(context: AiHealthToolContext) {
  return tool({
    description:
      "Get a read-only snapshot of the user's recorded health data: latest lab marker values, " +
      "7-day heart rate and steps averages, recent sleep, and latest weight. Values are what is " +
      "recorded in the app; sections with no records are marked no_data.",
    inputSchema: z.strictObject({}),
    execute: async () => executeHealthSnapshot(context),
  });
}
