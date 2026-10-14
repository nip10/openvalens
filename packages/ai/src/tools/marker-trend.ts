import type { LabMarkerLatest } from "@openvalens/labs";
import { tool } from "ai";
import { z } from "zod";

import { resolveToolAccess, type AiHealthToolContext } from "./access";

/**
 * `markerTrend` tool (Issue #13, real data since Issue #124).
 *
 * Resolves the requested marker against the active organization's own lab
 * marker definitions (via `@openvalens/labs`), then reports the direction of
 * its recorded values over the most recent readings. The marker key is only
 * ever compared against those definitions — it is never used to build a query
 * — so a model-supplied key cannot reach another tenant's data.
 *
 * The direction describes recorded numbers only (`up` / `down` / `flat`); it
 * makes no claim about whether a change is good, bad or clinically relevant.
 * Fewer than two readings yield `insufficient_data`, never a guessed trend.
 */

/** Most recent readings considered for the direction. */
export const MARKER_TREND_MAX_POINTS = 12;
/** Relative change below which the series is reported as `flat`. */
export const MARKER_TREND_FLAT_THRESHOLD = 0.05;
/** Cap on marker codes echoed back when the key does not match. */
const MAX_AVAILABLE_MARKERS = 50;

const BLOOD_MARKER_PREFIX = "blood_marker_";

export const markerTrendInput = z.strictObject({
  markerKey: z.string().trim().min(1).max(64),
});

const trendDirection = z.enum(["up", "down", "flat", "insufficient_data"]);

const point = z.object({ sampledAt: z.string(), value: z.number() });

export const markerTrendOutput = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    markerKey: z.string(),
    code: z.string(),
    displayName: z.string(),
    unit: z.string().nullable(),
    trend: trendDirection,
    sampleCount: z.number(),
    first: point,
    latest: point,
    changeAbsolute: z.number(),
    points: z.array(point),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("no_data"),
    markerKey: z.string(),
    code: z.string(),
    displayName: z.string(),
    unit: z.string().nullable(),
    trend: z.literal("insufficient_data"),
    sampleCount: z.literal(0),
    points: z.array(point).length(0),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("not_found"),
    markerKey: z.string(),
    availableMarkers: z.array(z.string()),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("unavailable"),
    markerKey: z.string(),
    reason: z.enum(["permission_denied", "consent_required"]),
    generatedAt: z.string(),
  }),
]);

export type MarkerTrendInput = z.infer<typeof markerTrendInput>;
export type MarkerTrendOutput = z.infer<typeof markerTrendOutput>;
export type MarkerTrendDirection = z.infer<typeof trendDirection>;

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/**
 * Matches a free-form key (`ferritin`, `blood_marker_ferritin`, or the display
 * name) against the org's marker definitions. Exact matches only.
 */
export function resolveMarker(
  markers: readonly LabMarkerLatest[],
  markerKey: string,
): LabMarkerLatest | null {
  const key = normalizeKey(markerKey);
  const code = key.startsWith(BLOOD_MARKER_PREFIX) ? key : `${BLOOD_MARKER_PREFIX}${key}`;
  return (
    markers.find((marker) => marker.code.toLowerCase() === code) ??
    markers.find((marker) => normalizeKey(marker.displayName) === key) ??
    null
  );
}

/**
 * Direction of an oldest-first series: compares the latest reading with the
 * first one in the window.
 */
export function computeTrendDirection(
  values: readonly number[],
  flatThreshold = MARKER_TREND_FLAT_THRESHOLD,
): MarkerTrendDirection {
  if (values.length < 2) return "insufficient_data";
  const first = values[0] as number;
  const last = values.at(-1) as number;
  const delta = last - first;
  if (delta === 0) return "flat";
  const relative = first === 0 ? Number.POSITIVE_INFINITY : Math.abs(delta) / Math.abs(first);
  if (relative < flatThreshold) return "flat";
  return delta > 0 ? "up" : "down";
}

/** Pure projection of one org's marker list into the redacted trend result. */
export function buildMarkerTrend(
  markers: readonly LabMarkerLatest[],
  input: MarkerTrendInput,
  now: Date = new Date(),
): MarkerTrendOutput {
  const generatedAt = now.toISOString();
  const marker = resolveMarker(markers, input.markerKey);

  if (!marker) {
    return {
      status: "not_found",
      markerKey: input.markerKey,
      availableMarkers: markers.map((entry) => entry.code).slice(0, MAX_AVAILABLE_MARKERS),
      generatedAt,
    };
  }

  // `recentValues` is oldest-first; keep only the newest window.
  const points = marker.recentValues
    .slice(-MARKER_TREND_MAX_POINTS)
    .map((entry) => ({ sampledAt: entry.sampledAt, value: entry.value }));
  const first = points[0];
  const latest = points.at(-1);

  if (!first || !latest) {
    return {
      status: "no_data",
      markerKey: input.markerKey,
      code: marker.code,
      displayName: marker.displayName,
      unit: marker.unit,
      trend: "insufficient_data",
      sampleCount: 0,
      points: [],
      generatedAt,
    };
  }

  return {
    status: "ok",
    markerKey: input.markerKey,
    code: marker.code,
    displayName: marker.displayName,
    unit: marker.unit,
    trend: computeTrendDirection(points.map((entry) => entry.value)),
    sampleCount: points.length,
    first,
    latest,
    changeAbsolute: Math.round((latest.value - first.value) * 1000) / 1000,
    points,
    generatedAt,
  };
}

/** Freshly reads the bound organization's markers and builds the trend. */
export async function executeMarkerTrend(
  context: AiHealthToolContext,
  input: MarkerTrendInput,
): Promise<MarkerTrendOutput> {
  const access = await resolveToolAccess(context, "markerTrend");
  if (!access.allowed) {
    return {
      status: "unavailable",
      markerKey: input.markerKey,
      reason: access.reason,
      generatedAt: access.now.toISOString(),
    };
  }

  const markers = await access.sources.listLabMarkers(
    context.organizationId,
    MARKER_TREND_MAX_POINTS,
  );
  const result = buildMarkerTrend(markers, input, access.now);

  // No marker key, values or dates — the key is model-supplied free text.
  access.logger.info("ai.tool.executed", {
    correlationId: context.correlationId,
    organizationId: context.organizationId,
    tool: "markerTrend",
    status: result.status,
    ...(result.status === "ok" ? { sampleCount: result.sampleCount } : {}),
  });

  return result;
}

export function createMarkerTrendTool(context: AiHealthToolContext) {
  return tool({
    description:
      "Get the direction (up, down, flat) of one recorded lab marker over its most recent " +
      "readings, with the readings themselves. markerKey is the marker code (for example " +
      "'ferritin' or 'blood_marker_ferritin') or its display name. Fewer than two readings " +
      "returns insufficient_data; an unknown key returns the available marker codes.",
    inputSchema: markerTrendInput,
    execute: async (input) => executeMarkerTrend(context, input),
  });
}
