import type { AiHealthToolContext } from "@openvalens/ai/tools/access";
import { executeBodyComp } from "@openvalens/ai/tools/body-comp";
import { executeGoals, goalsInput } from "@openvalens/ai/tools/goals";
import { executeHealthSnapshot } from "@openvalens/ai/tools/health-snapshot";
import { executeLabs, labsInput } from "@openvalens/ai/tools/labs";
import { executeMarkerTrend, markerTrendInput } from "@openvalens/ai/tools/marker-trend";
import {
  executeNutritionContext,
  nutritionContextInput,
} from "@openvalens/ai/tools/nutrition-context";
import { executeOutOfRange, outOfRangeInput } from "@openvalens/ai/tools/out-of-range";
import { executePanelCompare, panelCompareInput } from "@openvalens/ai/tools/panel-compare";
import { executeSupplements, supplementsInput } from "@openvalens/ai/tools/supplements";
import {
  executeTimelineSummary,
  timelineSummaryInput,
} from "@openvalens/ai/tools/timeline-summary";
import { executeWeightTrend, weightTrendInput } from "@openvalens/ai/tools/weight-trend";
import type { Database } from "@openvalens/db";
import { aggregateValues, type TrackerAggregation } from "@openvalens/trackers/model";
import type { StructuredLogger } from "@openvalens/observability";
import { z } from "zod";

import {
  localDate,
  measurementValue,
  page,
  rangeInputShape,
  resolveRange,
  weightValue,
  zonedIso,
  type RangeInput,
  type Units,
} from "./format";
import type { AiAppGrantPrincipal } from "./grants";
import { BASE_SCOPE, hasScope, type GrantableScope } from "./scopes";
import type { McpDataSources, TrackerRow } from "./sources";

/**
 * The read tools of the MCP server and the REST tool API (Issue #439, M1).
 * One definition per tool serves both transports, so the two can never
 * drift: the MCP server registers each one and `POST /api/v1/tools/<name>`
 * runs the same `run`.
 *
 * - The 11 Coach tools, unchanged, with the grant standing in for the Coach
 *   consent (`nutritionContext` only with `nutrition:read`).
 * - Date-range reads: sleep sessions, workouts, vitals, weights and lab
 *   history, at most 365 days per call, paginated with an opaque cursor; and
 *   private body measurements with `private_body:read`.
 * - Custom trackers with `trackers:read` (#441): only the member's own trackers
 *   whose AI switch is on; notes only with `notes:read`.
 * - `exercises.search`, for catalog ids.
 *
 * Results are the member's recorded values only, with no interpretation
 * beyond the flags the app already shows. Free-text notes appear only with
 * `notes:read`. Cycle data and progress photos have no tool.
 */

export type McpToolContext = {
  db: Database;
  principal: AiAppGrantPrincipal;
  sources: McpDataSources;
  now: Date;
  timeZone: string;
  units: Units;
  logger: StructuredLogger;
  correlationId?: string;
};

export type McpToolResult = { result: unknown; rowCount: number | null };

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  scope: GrantableScope;
  input: z.ZodType<Record<string, unknown>>;
  run: (context: McpToolContext, input: Record<string, unknown>) => Promise<McpToolResult>;
};

const RECORDED = "Returns the member's recorded values";

/** The Coach tool context for one grant: the grant is the consent. */
function coachContext(context: McpToolContext): AiHealthToolContext {
  return {
    db: context.db,
    organizationId: context.principal.organizationId,
    userId: context.principal.userId,
    // The grant was re-checked for this request (owner, not revoked, workspace on).
    canReadRecords: async () => true,
    accessGate: async () => ({ allowed: true, includeNutritionNumbers: true }),
    now: () => context.now,
    logger: context.logger,
    correlationId: context.correlationId,
  };
}

function coachTool(
  name: string,
  title: string,
  description: string,
  input: z.ZodType<Record<string, unknown>>,
  execute: (context: AiHealthToolContext, input: never) => Promise<unknown>,
  scope: GrantableScope = BASE_SCOPE,
): McpToolDefinition {
  return {
    name,
    title,
    description: `${RECORDED}: ${description}`,
    scope,
    input,
    run: async (context, parsed) => ({
      result: await execute(coachContext(context), parsed as never),
      rowCount: null,
    }),
  };
}

const emptyInput = z.strictObject({});

const rangeInput = z.strictObject(rangeInputShape);

function today(context: McpToolContext): string {
  return localDate(context.now, context.timeZone);
}

function rangeFor(context: McpToolContext, input: RangeInput) {
  const range = resolveRange(input, today(context));
  return {
    range,
    query: { from: range.from, to: range.to, offset: range.offset, limit: range.pageSize + 1 },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const SLEEP_STAGES = new Set(["awake", "light", "core", "deep", "rem", "asleep", "in_bed"]);

function stageMinutes(payload: unknown): Record<string, number> | null {
  if (!isRecord(payload) || !Array.isArray(payload.sleepStageIntervals)) return null;
  const totals: Record<string, number> = {};
  for (const interval of payload.sleepStageIntervals) {
    if (!isRecord(interval)) continue;
    const start = Date.parse(String(interval.start ?? ""));
    const end = Date.parse(String(interval.end ?? ""));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const raw = String(interval.stage ?? "")
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    const stage = SLEEP_STAGES.has(raw)
      ? raw
      : raw.includes("awake") || raw.includes("wake")
        ? "awake"
        : "other";
    totals[stage] = (totals[stage] ?? 0) + Math.round((end - start) / 60_000);
  }
  return Object.keys(totals).length > 0 ? totals : null;
}

function rangeEnvelope(context: McpToolContext, range: { from: string; to: string }) {
  return { from: range.from, to: range.to, timeZone: context.timeZone, units: context.units };
}

const sleepSessions: McpToolDefinition = {
  name: "sleep.sessions",
  title: "Sleep sessions",
  description: `${RECORDED}: sleep sessions that started on each day of a date range (at most 365 days, paginated), with start and end times, duration and minutes per recorded sleep stage. Device names and titles are not included.`,
  scope: BASE_SCOPE,
  input: rangeInput,
  run: async (context, input) => {
    const { range, query } = rangeFor(context, input as RangeInput);
    const rows = await context.sources.sleepSessions(context.principal, query, context.timeZone);
    const { items, nextCursor } = page(rows, range);
    return {
      rowCount: items.length,
      result: {
        ...rangeEnvelope(context, range),
        sessions: items.map((row) => {
          const payload = isRecord(row.payload) ? row.payload : {};
          const end = typeof payload.endAt === "string" ? new Date(payload.endAt) : null;
          const validEnd = end && Number.isFinite(end.getTime()) ? end : null;
          return {
            start: zonedIso(row.startAt, context.timeZone),
            end: validEnd ? zonedIso(validEnd, context.timeZone) : null,
            day: localDate(row.startAt, context.timeZone),
            durationMinutes: validEnd
              ? Math.round((validEnd.getTime() - row.startAt.getTime()) / 60_000)
              : null,
            stageMinutes: stageMinutes(payload),
          };
        }),
        nextCursor,
      },
    };
  },
};

const workoutsList: McpToolDefinition = {
  name: "workouts.list",
  title: "Workouts",
  description: `${RECORDED}: workouts logged in a date range (at most 365 days, paginated): day, type, duration in minutes, intensity, session effort (0-10) and how many exercises were logged. Notes are included only when the key has the notes scope.`,
  scope: BASE_SCOPE,
  input: rangeInput,
  run: async (context, input) => {
    const { range, query } = rangeFor(context, input as RangeInput);
    const rows = await context.sources.workouts(context.principal, query);
    const { items, nextCursor } = page(rows, range);
    const withNotes = hasScope(context.principal.scopes, "notes:read");
    return {
      rowCount: items.length,
      result: {
        ...rangeEnvelope(context, range),
        workouts: items.map((row) => ({
          day: row.date.slice(0, 10),
          type: row.type,
          durationMinutes: row.durationMinutes,
          intensity: row.intensity,
          effortRating: row.effortRating,
          exerciseCount: Number(row.exerciseCount),
          ...(withNotes ? { notes: row.notes } : {}),
        })),
        nextCursor,
      },
    };
  },
};

const VITAL_LABELS: Record<string, { key: string; label: string; unit: string }> = {
  heart_rate: { key: "heartRate", label: "Heart rate", unit: "bpm" },
  resting_heart_rate: { key: "restingHeartRate", label: "Resting heart rate", unit: "bpm" },
  hrv_rmssd: { key: "hrvRmssd", label: "Heart rate variability (RMSSD)", unit: "ms" },
  oxygen_saturation: { key: "oxygenSaturation", label: "Blood oxygen (SpO₂)", unit: "%" },
  respiratory_rate: { key: "respiratoryRate", label: "Respiratory rate", unit: "breaths/min" },
};

function roundOrNull(value: number | null, digits = 1): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const vitalsDaily: McpToolDefinition = {
  name: "vitals.daily",
  title: "Daily vitals",
  description: `${RECORDED}: per-day heart rate (average, minimum, maximum), resting heart rate and overnight heart rate variability for the days in a range that have readings (at most 365 days, paginated by day).`,
  scope: BASE_SCOPE,
  input: rangeInput,
  run: async (context, input) => {
    const { range } = rangeFor(context, input as RangeInput);
    const rows = await context.sources.dailyVitals(
      context.principal,
      { from: range.from, to: range.to, offset: 0, limit: 0 },
      context.timeZone,
    );
    const byDay = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const meta = VITAL_LABELS[row.code];
      if (!meta) continue;
      const day = byDay.get(row.date) ?? { day: row.date };
      day[meta.key] = {
        label: meta.label,
        unit: meta.unit,
        average: roundOrNull(row.avg),
        ...(row.code === "heart_rate"
          ? { minimum: roundOrNull(row.min), maximum: roundOrNull(row.max) }
          : {}),
        sampleCount: row.count,
      };
      byDay.set(row.date, day);
    }
    const days = [...byDay.values()];
    const { items, nextCursor } = page(
      days.slice(range.offset, range.offset + range.pageSize + 1),
      range,
    );
    return {
      rowCount: items.length,
      result: { ...rangeEnvelope(context, range), days: items, nextCursor },
    };
  },
};

const weightsList: McpToolDefinition = {
  name: "weights.daily",
  title: "Daily weights",
  description: `${RECORDED}: the member's daily weight for each day in a range that has one (at most 365 days, paginated), in kilograms with the member's preferred unit, and whether it came from a device or manual entry.`,
  scope: BASE_SCOPE,
  input: rangeInput,
  run: async (context, input) => {
    const { range, query } = rangeFor(context, input as RangeInput);
    const rows = await context.sources.dailyWeights(context.principal, query);
    const { items, nextCursor } = page(rows, range);
    return {
      rowCount: items.length,
      result: {
        ...rangeEnvelope(context, range),
        weights: items.map((row) => ({
          day: row.date,
          weight: weightValue(row.weightKg, context.units),
          source: row.source === "manual" ? "manual" : "device",
        })),
        nextCursor,
      },
    };
  },
};

const labsHistory: McpToolDefinition = {
  name: "labs.history",
  title: "Lab history",
  description: `${RECORDED}: lab results from panels dated in a range (at most 365 days, paginated), optionally for one marker key such as "ferritin": value as recorded with its unit, the reference range from the report and the flag the app shows. Panel notes are included only with the notes scope.`,
  scope: BASE_SCOPE,
  input: z.strictObject({
    ...rangeInputShape,
    marker: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe("A marker key (for example `ferritin` or `ldl`) to list only that marker."),
  }),
  run: async (context, input) => {
    const { range, query } = rangeFor(context, input as RangeInput);
    const marker = typeof input.marker === "string" ? input.marker : undefined;
    const rows = await context.sources.labHistory(context.principal, query, marker);
    const { items, nextCursor } = page(rows, range);
    const withNotes = hasScope(context.principal.scopes, "notes:read");
    return {
      rowCount: items.length,
      result: {
        ...rangeEnvelope(context, range),
        results: items.map((row) => ({
          day: row.date,
          panelId: row.panelId,
          panelContext: row.context,
          ...(withNotes ? { panelNotes: row.panelNotes } : {}),
          category: row.category,
          marker: row.testKey,
          name: row.testName,
          value: row.valueNumeric,
          valueText: row.valueText,
          unit: row.unit,
          referenceRange:
            row.refRangeLow === null && row.refRangeHigh === null && !row.refRangeText
              ? null
              : {
                  low: row.refRangeLow,
                  high: row.refRangeHigh,
                  text: row.refRangeText,
                  source: "from the report",
                },
          flag: row.flag,
        })),
        nextCursor,
      },
    };
  },
};

const PRIVATE_LABELS: Record<string, string> = {
  weight: "Weight",
  waist: "Waist",
  hip: "Hip",
  neck: "Neck",
  chest: "Chest",
  upper_arm: "Upper arm",
  thigh: "Thigh",
};

const privateMeasurements: McpToolDefinition = {
  name: "body.privateMeasurements",
  title: "Private body measurements",
  description: `${RECORDED}: the member's private manual body measurements (weight, waist, hip, neck, chest, upper arm, thigh) in a range (at most 365 days, paginated), in the unit they were entered with the member's preferred unit. Needs the private body measurements scope.`,
  scope: "private_body:read",
  input: rangeInput,
  run: async (context, input) => {
    const { range, query } = rangeFor(context, input as RangeInput);
    const rows = await context.sources.privateMeasurements(
      context.principal,
      query,
      context.timeZone,
    );
    const { items, nextCursor } = page(rows, range);
    return {
      rowCount: items.length,
      result: {
        ...rangeEnvelope(context, range),
        measurements: items.map((row) => ({
          measuredAt: zonedIso(row.measuredAt, context.timeZone),
          kind: row.kind,
          label: PRIVATE_LABELS[row.kind] ?? row.kind,
          ...measurementValue(row.value, row.unit, context.units),
        })),
        nextCursor,
      },
    };
  },
};

// ─── Custom trackers (#441) ───────────────────────────────────

const TRACKER_KIND: Record<string, string> = {
  number: "number",
  scale: "self-rating from 1 (low) to 5 (high), recorded by the member",
  yes_no: "yes or no",
  duration: "duration",
};

const TRACKER_COMBINE: Record<string, string> = {
  sum: "a day's entries are added up",
  average: "a day's entries are averaged",
  last: "the day's last entry counts",
  any: "yes if any entry that day says yes",
};

/** A stored tracker value as the tool reports it: durations in minutes, yes/no as a boolean. */
function trackerValue(type: string, value: number, decimals: number) {
  switch (type) {
    case "duration":
      return { value: roundOrNull(value / 60, 1), unit: "min" };
    case "yes_no":
      return { value: value > 0 };
    case "scale":
      return { value: roundOrNull(value, 1), unit: "rating 1-5" };
    default:
      return { value: roundOrNull(value, Math.max(0, Math.min(2, decimals))) };
  }
}

function trackerDescription(row: TrackerRow) {
  return {
    trackerId: row.id,
    name: row.name,
    kind: TRACKER_KIND[row.type] ?? row.type,
    unit: row.type === "number" ? row.unit : row.type === "duration" ? "min" : null,
    howDaysCombine: TRACKER_COMBINE[row.aggregation] ?? row.aggregation,
    target:
      row.targetValue !== null && row.targetPeriod
        ? {
            ...trackerValue(row.type === "yes_no" ? "number" : row.type, row.targetValue, 2),
            per: row.targetPeriod,
            ...(row.type === "yes_no" ? { unit: "days with yes" } : {}),
          }
        : null,
  };
}

const trackerFilter = {
  trackerId: z
    .uuid()
    .optional()
    .describe("A `trackerId` from `trackers.list`, to read only that tracker."),
};

async function readableTrackers(context: McpToolContext, trackerId: unknown) {
  const all = await context.sources.trackers(context.principal);
  return typeof trackerId === "string" ? all.filter((row) => row.id === trackerId) : all;
}

const trackersList: McpToolDefinition = {
  name: "trackers.list",
  title: "Custom trackers",
  description: `${RECORDED}: the custom trackers the member made (for example mood, sauna or dead hangs) and let connected AI apps read, with what each one records, its unit, how a day's entries combine and any daily or weekly target. Mood, energy and stress are the member's own 1-5 self-ratings, not scores. Needs the trackers scope.`,
  scope: "trackers:read",
  input: emptyInput,
  run: async (context) => {
    const rows = await context.sources.trackers(context.principal);
    return { rowCount: rows.length, result: { trackers: rows.map(trackerDescription) } };
  },
};

const trackersDaily: McpToolDefinition = {
  name: "trackers.daily",
  title: "Custom trackers by day",
  description: `${RECORDED}: one combined value per day for each readable custom tracker in a date range (at most 365 days), by the tracker's own rule, with the number of entries that day. Days with no entry are left out. Needs the trackers scope.`,
  scope: "trackers:read",
  input: z.strictObject({ ...rangeInputShape, ...trackerFilter }),
  run: async (context, input) => {
    const { range } = rangeFor(context, input as RangeInput);
    const trackers = await readableTrackers(context, input.trackerId);
    const entries = await context.sources.trackerEntries(
      context.principal,
      { from: range.from, to: range.to, offset: 0, limit: 0 },
      { trackerIds: trackers.map((row) => row.id), withNotes: false },
    );
    let rowCount = 0;
    const result = trackers.map((tracker) => {
      const byDay = new Map<string, { value: number; loggedAt: Date }[]>();
      for (const entry of entries) {
        if (entry.trackerId !== tracker.id) continue;
        const list = byDay.get(entry.localDate) ?? [];
        list.push(entry);
        byDay.set(entry.localDate, list);
      }
      const days = [...byDay.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([day, list]) => ({
          day,
          ...trackerValue(
            tracker.type,
            aggregateValues(tracker.aggregation as TrackerAggregation, list) ?? 0,
            tracker.decimals,
          ),
          entryCount: list.length,
        }));
      rowCount += days.length;
      return { ...trackerDescription(tracker), days };
    });
    return { rowCount, result: { ...rangeEnvelope(context, range), trackers: result } };
  },
};

const trackersEntries: McpToolDefinition = {
  name: "trackers.entries",
  title: "Custom tracker entries",
  description: `${RECORDED}: the individual entries of the readable custom trackers logged in a date range (at most 365 days, paginated, newest first), with the time, the value and whether the member or another workspace member logged it. Notes are included only when the key has the notes scope. Needs the trackers scope.`,
  scope: "trackers:read",
  input: z.strictObject({ ...rangeInputShape, ...trackerFilter }),
  run: async (context, input) => {
    const { range, query } = rangeFor(context, input as RangeInput);
    const trackers = await readableTrackers(context, input.trackerId);
    const withNotes = hasScope(context.principal.scopes, "notes:read");
    const rows = await context.sources.trackerEntries(context.principal, query, {
      trackerIds: trackers.map((row) => row.id),
      withNotes,
    });
    const { items, nextCursor } = page(rows, range);
    const byId = new Map(trackers.map((row) => [row.id, row]));
    return {
      rowCount: items.length,
      result: {
        ...rangeEnvelope(context, range),
        entries: items.flatMap((row) => {
          const tracker = byId.get(row.trackerId);
          if (!tracker) return [];
          return [
            {
              trackerId: row.trackerId,
              tracker: tracker.name,
              loggedAt: zonedIso(row.loggedAt, context.timeZone),
              day: row.localDate,
              ...trackerValue(tracker.type, row.value, tracker.decimals),
              ...(tracker.type === "number" && tracker.unit ? { unit: tracker.unit } : {}),
              loggedBy: row.loggedByMember ? "member" : "another workspace member",
              ...(withNotes ? { note: row.note } : {}),
            },
          ];
        }),
        nextCursor,
      },
    };
  },
};

const exercisesSearch: McpToolDefinition = {
  name: "exercises.search",
  title: "Search exercises",
  description:
    "Searches the exercise catalog (and the member's own custom exercises) by name. Returns catalog ids, names, category, muscles and equipment, with the catalog licence and attribution.",
  scope: BASE_SCOPE,
  input: z.strictObject({
    query: z.string().trim().min(1).max(80).optional().describe("Part of an exercise name."),
    afterId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Return exercises after this id (paging)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("How many to return (1-50, default 20)."),
  }),
  run: async (context, input) => {
    const limit = typeof input.limit === "number" ? input.limit : 20;
    const exercises = await context.sources.searchExercises({
      organizationId: context.principal.organizationId,
      ...(typeof input.query === "string" ? { query: input.query } : {}),
      ...(typeof input.afterId === "number" ? { afterId: input.afterId } : {}),
      limit,
    });
    return {
      rowCount: exercises.length,
      result: {
        exercises,
        nextAfterId: exercises.length === limit ? (exercises.at(-1)?.id ?? null) : null,
      },
    };
  },
};

/** Every tool, in the order `tools/list` returns them. */
export const MCP_TOOLS: readonly McpToolDefinition[] = Object.freeze([
  coachTool(
    "healthSnapshot",
    "Health snapshot",
    "latest lab marker values, 7-day heart rate and step averages, recent sleep and the latest weight. Sections with no records are marked no_data.",
    emptyInput,
    executeHealthSnapshot as never,
  ),
  coachTool(
    "labs",
    "Lab panels",
    "the member's recent blood panels with their markers, values, units and the flags the app shows.",
    labsInput,
    executeLabs as never,
  ),
  coachTool(
    "markerTrend",
    "Marker trend",
    "the recorded readings of one lab marker over time.",
    markerTrendInput,
    executeMarkerTrend as never,
  ),
  coachTool(
    "panelCompare",
    "Compare panels",
    "two blood panels side by side, marker by marker.",
    panelCompareInput,
    executePanelCompare as never,
  ),
  coachTool(
    "outOfRange",
    "Out-of-range markers",
    "markers whose latest reading is outside the report's reference range, as the app flags them.",
    outOfRangeInput,
    executeOutOfRange as never,
  ),
  coachTool(
    "bodyComp",
    "Body composition",
    "the latest DEXA scan and body-composition readings.",
    emptyInput,
    executeBodyComp as never,
  ),
  coachTool(
    "weightTrend",
    "Weight trend",
    "daily weights and the smoothed trend over a window.",
    weightTrendInput,
    executeWeightTrend as never,
  ),
  coachTool(
    "supplements",
    "Supplements",
    "the supplements the member takes with their schedules.",
    supplementsInput,
    executeSupplements as never,
  ),
  coachTool(
    "goals",
    "Goals",
    "the member's goals with their recent check-ins.",
    goalsInput,
    executeGoals as never,
  ),
  coachTool(
    "timelineSummary",
    "Timeline summary",
    "counts of recorded entries per domain and kind over recent days. Titles and free-text notes are not included.",
    timelineSummaryInput,
    executeTimelineSummary as never,
  ),
  coachTool(
    "nutritionContext",
    "Nutrition summary",
    "per logged day averages for energy, protein, carbohydrate, fat and fibre over the member's last days, with how complete the log is. Needs the nutrition scope.",
    nutritionContextInput,
    executeNutritionContext as never,
    "nutrition:read",
  ),
  sleepSessions,
  workoutsList,
  vitalsDaily,
  weightsList,
  labsHistory,
  privateMeasurements,
  trackersList,
  trackersDaily,
  trackersEntries,
  exercisesSearch,
]);

export function findTool(name: string): McpToolDefinition | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name);
}

/** The tools this grant may call: base tools plus those its opt-in scopes unlock. */
export function toolsForScopes(scopes: readonly string[]): McpToolDefinition[] {
  return MCP_TOOLS.filter((tool) => hasScope(scopes, tool.scope));
}
