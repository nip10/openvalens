import type { Database } from "@openvalens/db";
import { privateBodyMeasurement, dailyWeight } from "@openvalens/db/schema/body";
import { bloodMarker, bloodPanel } from "@openvalens/db/schema/clinical";
import { healthEvent, metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import { insightPreference } from "@openvalens/db/schema/insights";
import { workout, workoutExercise } from "@openvalens/db/schema/plans";
import { productSettings } from "@openvalens/db/schema/product-settings";
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

const VITAL_CODES = ["heart_rate", "resting_heart_rate", "hrv_rmssd"] as const;

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

    searchExercises,
  };
}
