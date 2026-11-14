import type { Database } from "@openvalens/db";
import { privateBodyMeasurement, dailyWeight } from "@openvalens/db/schema/body";
import { bloodMarker, bloodPanel } from "@openvalens/db/schema/clinical";
import { healthEvent, metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import { insightPreference } from "@openvalens/db/schema/insights";
import { painEntry, painPreference } from "@openvalens/db/schema/pain";
import { workout, workoutExercise } from "@openvalens/db/schema/plans";
import { productSettings } from "@openvalens/db/schema/product-settings";
import { customTracker, customTrackerEntry } from "@openvalens/db/schema/trackers";
import { countsInDailyTotals } from "@openvalens/vitals/device-overlap";
import { and, asc, between, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";

import type { Units } from "./format";

/**
 * The explicit allowlist of data sources the MCP and REST tools read
 * (Issue #439), next to the Coach tool ports in `@openvalens/ai`.
 *
 * Every read here is scoped to the grant's workspace and, for member-private
 * tables, to its member; none takes an id from tool input. The tables are
 * listed in {@link MCP_SOURCE_TABLES}, and `exclusions.test.ts` fails when a
 * file in this package imports a schema module or table outside that list, or
 * any cycle, photo or storage module. Cycle data and progress photos are
 * therefore unreachable from any tool.
 *
 * The exercise catalog lives in `@openvalens/api` (which depends on this
 * package), so the server injects it as the {@link ExerciseSearchPort}.
 */

/** Every table a tool may read, by SQL name. Reviewed: extend deliberately. */
export const MCP_SOURCE_TABLES = [
  // Range reads in this file
  "health_event", // only `event_type = 'sleep_session'`
  "workout",
  "workout_exercise", // counted only
  "metric_sample", // only heart rate, resting heart rate and HRV
  "metric_definition",
  "daily_weight",
  "blood_panel",
  "blood_marker",
  "private_body_measurement", // only with `private_body:read`
  // Custom trackers (#441): only with `trackers:read`, only the member's own,
  // and only trackers whose "Coach and connected AI apps" switch is on.
  "custom_tracker",
  "custom_tracker_entry", // `note` only with `notes:read`
  // Pain log (#442): only with `pain:read`, only the member's own, and only
  // while the pain log and its AI switch are both on.
  "pain_entry", // `note` only with `notes:read`
  "pain_preference", // the opt-in and the AI switch only
  // Member display preferences
  "insight_preference", // time zone only
  "product_settings", // units only
] as const;

export type GrantScope = { organizationId: string; userId: string };
export type DayRange = { from: string; to: string; offset: number; limit: number };

export type ExerciseSearchResult = {
  id: number;
  name: string;
  category: string | null;
  source: string;
  muscles: Array<{ name: string; role: string | null }>;
  equipment: Array<{ name: string }>;
  license: string | null;
  author: string | null;
  attribution: string | null;
};

/** Injected by the server: the same catalog search the app uses. */
export type ExerciseSearchPort = (input: {
  organizationId: string;
  query?: string;
  afterId?: number;
  limit: number;
}) => Promise<ExerciseSearchResult[]>;

const VITAL_CODES = [
  "heart_rate",
  "resting_heart_rate",
  "hrv_rmssd",
  "oxygen_saturation",
  "respiratory_rate",
] as const;

export type SleepSessionRow = { id: number; startAt: Date; payload: unknown };
export type WorkoutRow = {
  id: number;
  date: string;
  type: string;
  durationMinutes: number | null;
  intensity: string | null;
  effortRating: number | null;
  notes: string | null;
  exerciseCount: number;
};
export type VitalsDayRow = {
  date: string;
  code: string;
  avg: number | null;
  min: number | null;
  max: number | null;
  count: number;
};
export type WeightDayRow = { date: string; weightKg: number; source: string };
export type LabRow = {
  panelId: number;
  date: string;
  context: string | null;
  panelNotes: string | null;
  category: string;
  testKey: string;
  testName: string;
  valueNumeric: number | null;
  valueText: string | null;
  unit: string | null;
  refRangeLow: number | null;
  refRangeHigh: number | null;
  refRangeText: string | null;
  flag: string | null;
};
export type PrivateMeasurementRow = { kind: string; value: number; unit: string; measuredAt: Date };
export type TrackerRow = {
  id: string;
  name: string;
  template: string | null;
  type: string;
  unit: string | null;
  decimals: number;
  aggregation: string;
  targetValue: number | null;
  targetPeriod: string | null;
};
export type TrackerEntryRow = {
  id: string;
  trackerId: string;
  value: number;
  loggedAt: Date;
  localDate: string;
  /** Read only when the grant has `notes:read`; null otherwise. */
  note: string | null;
  loggedByMember: boolean;
};

export type PainEntryRow = {
  region: string;
  rating: number;
  type: string | null;
  loggedAt: Date;
  localDate: string;
  /** Read only when the grant has `notes:read`; null otherwise. */
  note: string | null;
};

export type McpDataSources = {
  preferences: (scope: GrantScope) => Promise<{ timeZone: string | null; units: Units }>;
  sleepSessions: (
    scope: GrantScope,
    range: DayRange,
    timeZone: string,
  ) => Promise<SleepSessionRow[]>;
  workouts: (scope: GrantScope, range: DayRange) => Promise<WorkoutRow[]>;
  dailyVitals: (scope: GrantScope, range: DayRange, timeZone: string) => Promise<VitalsDayRow[]>;
  dailyWeights: (scope: GrantScope, range: DayRange) => Promise<WeightDayRow[]>;
  labHistory: (scope: GrantScope, range: DayRange, marker?: string) => Promise<LabRow[]>;
  privateMeasurements: (
    scope: GrantScope,
    range: DayRange,
    timeZone: string,
  ) => Promise<PrivateMeasurementRow[]>;
  /** The member's own trackers with the AI switch on, not archived (#441). */
  trackers: (scope: GrantScope) => Promise<TrackerRow[]>;
  /**
   * Entries of those trackers by local day, newest first. `withNotes` is the
   * grant's `notes:read`; without it the note column is never selected.
   */
  trackerEntries: (
    scope: GrantScope,
    range: DayRange,
    options: { trackerIds: readonly string[]; withNotes: boolean },
  ) => Promise<TrackerEntryRow[]>;
  /**
   * The member's own pain entries by local day, newest first (#442): none
   * unless the pain log and its AI switch are on. `withNotes` is the grant's
   * `notes:read`; without it the note column is never selected.
   */
  painEntries: (
    scope: GrantScope,
    range: DayRange,
    options: { withNotes: boolean },
  ) => Promise<PainEntryRow[]>;
  searchExercises: ExerciseSearchPort;
};

function localDay(column: unknown, timeZone: string) {
  return sql<string>`to_char((${column} at time zone ${timeZone}), 'YYYY-MM-DD')`;
}

/** Binds the allowlisted reads to one database handle. */
export function createMcpDataSources(
  db: Database,
  searchExercises: ExerciseSearchPort,
): McpDataSources {
  return {
    async preferences(scope) {
      const [zone] = await db
        .select({ timeZone: insightPreference.timeZone })
        .from(insightPreference)
        .where(
          and(
            eq(insightPreference.organizationId, scope.organizationId),
            eq(insightPreference.userId, scope.userId),
          ),
        )
        .limit(1);
      const [display] = await db
        .select({ units: productSettings.units })
        .from(productSettings)
        .where(eq(productSettings.id, "instance"))
        .limit(1);
      return {
        timeZone: zone?.timeZone ?? null,
        units: display?.units === "imperial" ? "imperial" : "metric",
      };
    },

    async sleepSessions(scope, range, timeZone) {
      const day = localDay(healthEvent.eventAt, timeZone);
      const rows = await db
        .select({
          id: healthEvent.id,
          startAt: healthEvent.eventAt,
          payload: healthEvent.payloadJson,
        })
        .from(healthEvent)
        .where(
          and(
            eq(healthEvent.organizationId, scope.organizationId),
            eq(healthEvent.eventType, "sleep_session"),
            isNull(healthEvent.supersededAt),
            sql`${day} between ${range.from} and ${range.to}`,
          ),
        )
        .orderBy(desc(healthEvent.eventAt), desc(healthEvent.id))
        .limit(range.limit)
        .offset(range.offset);
      return rows;
    },

    async workouts(scope, range) {
      return db
        .select({
          id: workout.id,
          date: workout.date,
          type: workout.type,
          durationMinutes: workout.duration,
          intensity: workout.intensity,
          effortRating: workout.effortRating,
          notes: workout.notes,
          exerciseCount: sql<number>`(select count(*)::int from ${workoutExercise} where ${workoutExercise.organizationId} = ${workout.organizationId} and ${workoutExercise.workoutId} = ${workout.id})`,
        })
        .from(workout)
        .where(
          and(
            eq(workout.organizationId, scope.organizationId),
            between(sql`substring(${workout.date} from 1 for 10)`, range.from, range.to),
          ),
        )
        .orderBy(desc(workout.date), desc(workout.id))
        .limit(range.limit)
        .offset(range.offset);
    },

    async dailyVitals(scope, range, timeZone) {
      const day = localDay(metricSample.sampledAt, timeZone);
      const rows = await db
        .select({
          date: day,
          code: metricDefinition.code,
          avg: sql<number | null>`avg(${metricSample.numericValue})::float8`,
          min: sql<number | null>`min(${metricSample.numericValue})::float8`,
          max: sql<number | null>`max(${metricSample.numericValue})::float8`,
          count: sql<number>`count(*)::int`,
        })
        .from(metricSample)
        .innerJoin(
          metricDefinition,
          and(
            eq(metricDefinition.id, metricSample.metricDefinitionId),
            eq(metricDefinition.organizationId, metricSample.organizationId),
          ),
        )
        .where(
          and(
            eq(metricSample.organizationId, scope.organizationId),
            isNull(metricSample.supersededAt),
            inArray(metricDefinition.code, [...VITAL_CODES]),
            sql`${day} between ${range.from} and ${range.to}`,
            // Device data wins: an AI-written reading next to a device one is left out.
            countsInDailyTotals(),
          ),
        )
        // By position: the zone is a bound parameter, so the select and group-by
        // expressions would otherwise differ.
        .groupBy(sql`1`, sql`2`)
        .orderBy(sql`1 desc`, sql`2`);
      return rows.map((row) => ({ ...row, count: Number(row.count) }));
    },

    async dailyWeights(scope, range) {
      return db
        .select({
          date: dailyWeight.date,
          weightKg: dailyWeight.weightKg,
          source: dailyWeight.source,
        })
        .from(dailyWeight)
        .where(
          and(
            eq(dailyWeight.organizationId, scope.organizationId),
            eq(dailyWeight.userId, scope.userId),
            between(dailyWeight.date, range.from, range.to),
          ),
        )
        .orderBy(desc(dailyWeight.date), desc(dailyWeight.id))
        .limit(range.limit)
        .offset(range.offset);
    },

    async labHistory(scope, range, marker) {
      const panelDay = sql<string>`substring(${bloodPanel.date} from 1 for 10)`;
      return db
        .select({
          panelId: bloodPanel.id,
          date: panelDay,
          context: bloodPanel.context,
          panelNotes: bloodPanel.notes,
          category: bloodMarker.category,
          testKey: bloodMarker.testKey,
          testName: bloodMarker.testName,
          valueNumeric: bloodMarker.valueNumeric,
          valueText: bloodMarker.valueText,
          unit: bloodMarker.unit,
          refRangeLow: bloodMarker.refRangeLow,
          refRangeHigh: bloodMarker.refRangeHigh,
          refRangeText: bloodMarker.refRangeText,
          flag: bloodMarker.flag,
        })
        .from(bloodMarker)
        .innerJoin(
          bloodPanel,
          and(
            eq(bloodPanel.organizationId, bloodMarker.organizationId),
            eq(bloodPanel.id, bloodMarker.panelId),
          ),
        )
        .where(
          and(
            eq(bloodMarker.organizationId, scope.organizationId),
            between(panelDay, range.from, range.to),
            marker ? ilike(bloodMarker.testKey, marker.replace(/[\\%_]/g, "\\$&")) : undefined,
          ),
        )
        .orderBy(desc(panelDay), desc(bloodPanel.id), asc(bloodMarker.id))
        .limit(range.limit)
        .offset(range.offset);
    },

    async privateMeasurements(scope, range, timeZone) {
      const day = localDay(privateBodyMeasurement.measuredAt, timeZone);
      return db
        .select({
          kind: privateBodyMeasurement.kind,
          value: privateBodyMeasurement.value,
          unit: privateBodyMeasurement.unit,
          measuredAt: privateBodyMeasurement.measuredAt,
        })
        .from(privateBodyMeasurement)
        .where(
          and(
            eq(privateBodyMeasurement.organizationId, scope.organizationId),
            eq(privateBodyMeasurement.userId, scope.userId),
            sql`${day} between ${range.from} and ${range.to}`,
          ),
        )
        .orderBy(desc(privateBodyMeasurement.measuredAt), desc(privateBodyMeasurement.id))
        .limit(range.limit)
        .offset(range.offset);
    },

    async trackers(scope) {
      return db
        .select({
          id: customTracker.id,
          name: customTracker.name,
          template: customTracker.template,
          type: customTracker.type,
          unit: customTracker.unit,
          decimals: customTracker.decimals,
          aggregation: customTracker.aggregation,
          targetValue: customTracker.targetValue,
          targetPeriod: customTracker.targetPeriod,
        })
        .from(customTracker)
        .where(
          and(
            eq(customTracker.organizationId, scope.organizationId),
            eq(customTracker.userId, scope.userId),
            eq(customTracker.aiVisible, true),
            isNull(customTracker.archivedAt),
          ),
        )
        .orderBy(asc(customTracker.createdAt), asc(customTracker.id));
    },

    async trackerEntries(scope, range, options) {
      if (options.trackerIds.length === 0) return [];
      const query = db
        .select({
          id: customTrackerEntry.id,
          trackerId: customTrackerEntry.trackerId,
          value: customTrackerEntry.value,
          loggedAt: customTrackerEntry.loggedAt,
          localDate: customTrackerEntry.localDate,
          note: options.withNotes ? customTrackerEntry.note : sql<null>`null`,
          loggedByMember: sql<boolean>`coalesce(${customTrackerEntry.loggedByUserId} = ${scope.userId}, false)`,
        })
        .from(customTrackerEntry)
        .innerJoin(
          customTracker,
          and(
            eq(customTracker.id, customTrackerEntry.trackerId),
            eq(customTracker.organizationId, customTrackerEntry.organizationId),
            eq(customTracker.userId, customTrackerEntry.userId),
          ),
        )
        .where(
          and(
            eq(customTrackerEntry.organizationId, scope.organizationId),
            eq(customTrackerEntry.userId, scope.userId),
            // Re-checked here so a stale id list can never widen the read.
            eq(customTracker.aiVisible, true),
            isNull(customTracker.archivedAt),
            inArray(customTrackerEntry.trackerId, [...options.trackerIds]),
            between(customTrackerEntry.localDate, range.from, range.to),
          ),
        )
        .orderBy(desc(customTrackerEntry.loggedAt), desc(customTrackerEntry.id));
      return range.limit > 0 ? query.limit(range.limit).offset(range.offset) : query;
    },

    async painEntries(scope, range, options) {
      return db
        .select({
          region: painEntry.region,
          rating: painEntry.rating,
          type: painEntry.type,
          loggedAt: painEntry.loggedAt,
          localDate: painEntry.localDate,
          note: options.withNotes ? painEntry.note : sql<null>`null`,
        })
        .from(painEntry)
        .innerJoin(painPreference, eq(painPreference.userId, painEntry.userId))
        .where(
          and(
            eq(painEntry.organizationId, scope.organizationId),
            eq(painEntry.userId, scope.userId),
            eq(painPreference.enabled, true),
            eq(painPreference.aiVisible, true),
            between(painEntry.localDate, range.from, range.to),
          ),
        )
        .orderBy(desc(painEntry.loggedAt), desc(painEntry.id))
        .limit(range.limit)
        .offset(range.offset);
    },

    searchExercises,
  };
}
