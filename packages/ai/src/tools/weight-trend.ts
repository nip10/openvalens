import { tool } from "ai";
import { z } from "zod";

import { logToolExecuted, resolveToolAccess, type AiHealthToolContext } from "./access";
import { daysBefore, round, unavailableReason } from "./format";
import { computeTrendDirection } from "./marker-trend";
import type { BodyCompositionTimeline, LegacyWeightCheckinRow } from "./sources";

/**
 * `weightTrend` tool (Issue #13 plan, implemented in Issue #130).
 *
 * Reads the bound organization's canonical daily weights (`@openvalens/body`)
 * over a requested window and reports the recorded first / latest / min / max
 * values and the direction (`up` / `down` / `flat`). When no canonical daily
 * weight falls in the window, the pre-materialization weight check-ins are
 * used instead and `basis` says so. The direction describes recorded numbers
 * only; fewer than two days yield `insufficient_data`, never a guessed trend.
 *
 * Redaction: only dates and kilograms are copied. Row ids, weight sources and
 * check-in notes never reach the output.
 */

export const WEIGHT_TREND_DEFAULT_DAYS = 90;
/** Relative change below which the series is reported as `flat`. */
export const WEIGHT_TREND_FLAT_THRESHOLD = 0.01;
/** Newest daily points returned, to keep the prompt small. */
export const WEIGHT_TREND_MAX_POINTS = 60;

export const weightTrendInput = z.strictObject({
  days: z.number().int().min(7).max(365).default(WEIGHT_TREND_DEFAULT_DAYS),
});

const point = z.object({ date: z.string(), weightKg: z.number() });

export const weightTrendOutput = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    windowDays: z.number(),
    basis: z.enum(["canonical_daily", "legacy_checkins"]),
    trend: z.enum(["up", "down", "flat", "insufficient_data"]),
    sampleCount: z.number(),
    first: point,
    latest: point,
    minKg: z.number(),
    maxKg: z.number(),
    averageKg: z.number(),
    changeKg: z.number(),
    points: z.array(point),
    pointsTruncated: z.boolean(),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("no_data"),
    windowDays: z.number(),
    trend: z.literal("insufficient_data"),
    sampleCount: z.literal(0),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: unavailableReason,
    generatedAt: z.string(),
  }),
]);

export type WeightTrendInput = z.input<typeof weightTrendInput>;
export type WeightTrendOutput = z.infer<typeof weightTrendOutput>;

type WeightPoint = z.infer<typeof point>;

/** One point per date (first row per date wins; rows are newest first), oldest first. */
function toSeries(
  rows: ReadonlyArray<{ date: string; weightKg: number | null }>,
  since: string,
): WeightPoint[] {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    if (row.date < since || byDate.has(row.date)) continue;
    if (row.weightKg === null || !Number.isFinite(row.weightKg)) continue;
    byDate.set(row.date, row.weightKg);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, weightKg]) => ({ date, weightKg: round(weightKg, 2) }));
}

/** Pure projection; `canonical` and `legacy` rows are newest first. */
export function buildWeightTrend(
  canonical: Pick<BodyCompositionTimeline, "canonicalDailyPoints">,
  legacy: ReadonlyArray<Pick<LegacyWeightCheckinRow, "date" | "weightKg">>,
  input: WeightTrendInput,
  now: Date = new Date(),
): WeightTrendOutput {
  const windowDays = input.days ?? WEIGHT_TREND_DEFAULT_DAYS;
  const generatedAt = now.toISOString();
  const since = daysBefore(now, windowDays);

  const canonicalSeries = toSeries(canonical.canonicalDailyPoints, since);
  const basis = canonicalSeries.length > 0 ? "canonical_daily" : "legacy_checkins";
  const series = canonicalSeries.length > 0 ? canonicalSeries : toSeries(legacy, since);

  const first = series[0];
  const latest = series.at(-1);
  if (!first || !latest) {
    return {
      status: "no_data",
      windowDays,
      trend: "insufficient_data",
      sampleCount: 0,
      generatedAt,
    };
  }

  const values = series.map((entry) => entry.weightKg);
  return {
    status: "ok",
    windowDays,
    basis,
    trend: computeTrendDirection(values, WEIGHT_TREND_FLAT_THRESHOLD),
    sampleCount: series.length,
    first,
    latest,
    minKg: Math.min(...values),
    maxKg: Math.max(...values),
    averageKg: round(values.reduce((sum, value) => sum + value, 0) / values.length, 2),
    changeKg: round(latest.weightKg - first.weightKg, 2),
    points: series.slice(-WEIGHT_TREND_MAX_POINTS),
    pointsTruncated: series.length > WEIGHT_TREND_MAX_POINTS,
    generatedAt,
  };
}

/** Freshly reads the bound organization's weights and builds the trend. */
export async function executeWeightTrend(
  context: AiHealthToolContext,
  input: WeightTrendInput,
): Promise<WeightTrendOutput> {
  const access = await resolveToolAccess(context, "weightTrend");
  if (!access.allowed) {
    return { status: "unavailable", reason: access.reason, generatedAt: access.now.toISOString() };
  }

  const organizationId = context.organizationId;
  const days = input.days ?? WEIGHT_TREND_DEFAULT_DAYS;
  const canonical = await access.sources.getBodyCompositionTimeline(organizationId, days);
  const since = daysBefore(access.now, days);
  // The legacy table is only a fallback for orgs without canonical rows.
  const legacy = canonical.canonicalDailyPoints.some((row) => row.date >= since)
    ? []
    : await access.sources.listLegacyWeightCheckins(organizationId, days * 2);
  const result = buildWeightTrend(canonical, legacy, { days }, access.now);

  logToolExecuted(context, access.logger, "weightTrend", result.status, {
    windowDays: days,
    ...(result.status === "ok" ? { sampleCount: result.sampleCount, basis: result.basis } : {}),
  });
  return result;
}

export function createWeightTrendTool(context: AiHealthToolContext) {
  return tool({
    description:
      "Get the user's recorded body weight over the last N days (default 90, 7-365): first, " +
      "latest, min, max and average in kg, the change, the direction (up, down, flat) and the " +
      "daily points. Fewer than two recorded days returns insufficient_data as the trend.",
    inputSchema: weightTrendInput,
    execute: async (input) => executeWeightTrend(context, input),
  });
}
