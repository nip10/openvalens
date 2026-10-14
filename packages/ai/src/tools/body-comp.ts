import { tool } from "ai";
import { z } from "zod";

import { logToolExecuted, resolveToolAccess, type AiHealthToolContext } from "./access";
import { roundOrNull, unavailableReason } from "./format";
import type { BodyCompositionTimeline, DexaScanRow } from "./sources";

/**
 * `bodyComp` tool (Issue #13 plan, implemented in Issue #130).
 *
 * Reads the bound organization's recorded body composition through
 * `@openvalens/body`: the two newest DEXA scans and the newest
 * body-composition measurements (for example from a smart scale). Weight over
 * time is the `weightTrend` tool's job.
 *
 * Redaction: scan and measurement rows are projected field by field. Row ids,
 * source files, measurement source / device names, raw metadata, height and
 * age are never copied. DEXA masses stored in grams are reported in kg.
 */

/** Newest body-composition measurements returned. */
export const BODY_COMP_MAX_MEASUREMENTS = 10;

const dexaScan = z.object({
  date: z.string(),
  weightKg: z.number().nullable(),
  totalMassKg: z.number().nullable(),
  bodyFatPct: z.number().nullable(),
  fatMassKg: z.number().nullable(),
  leanMassKg: z.number().nullable(),
  boneMineralContentKg: z.number().nullable(),
  leanTissuePct: z.number().nullable(),
  bmi: z.number().nullable(),
  androidFatPct: z.number().nullable(),
  gynoidFatPct: z.number().nullable(),
  androidGynoidRatio: z.number().nullable(),
  restingMetabolicRateKcal: z.number().nullable(),
  appendicularLeanMassIndex: z.number().nullable(),
  boneMineralDensityGPerCm2: z.number().nullable(),
  tScore: z.number().nullable(),
  zScore: z.number().nullable(),
});

const measurement = z.object({
  date: z.string(),
  weightKg: z.number().nullable(),
  bodyFatPct: z.number().nullable(),
  fatMassKg: z.number().nullable(),
  leanMassKg: z.number().nullable(),
  boneMassKg: z.number().nullable(),
});

export const bodyCompOutput = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    dexa: z.object({
      status: z.enum(["ok", "no_data"]),
      scanCount: z.number(),
      latest: dexaScan.nullable(),
      previous: dexaScan.nullable(),
    }),
    measurements: z.object({
      status: z.enum(["ok", "no_data"]),
      count: z.number(),
      items: z.array(measurement),
    }),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("no_data"),
    summary: z.string(),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: unavailableReason,
    generatedAt: z.string(),
  }),
]);

export type BodyCompOutput = z.infer<typeof bodyCompOutput>;

function gramsToKg(value: number | null): number | null {
  return value === null ? null : roundOrNull(value / 1000, 2);
}

function projectDexaScan(row: DexaScanRow): z.infer<typeof dexaScan> {
  return {
    date: row.date,
    weightKg: roundOrNull(row.weight, 2),
    totalMassKg: roundOrNull(row.totalMass, 2),
    bodyFatPct: roundOrNull(row.bodyFatPct, 1),
    fatMassKg: gramsToKg(row.fatMass),
    leanMassKg: gramsToKg(row.leanMass),
    boneMineralContentKg: gramsToKg(row.boneMineralContent),
    leanTissuePct: roundOrNull(row.leanTissuePct, 1),
    bmi: roundOrNull(row.bmi, 1),
    androidFatPct: roundOrNull(row.androidFatPct, 1),
    gynoidFatPct: roundOrNull(row.gynoidFatPct, 1),
    androidGynoidRatio: roundOrNull(row.agRatio, 2),
    restingMetabolicRateKcal: roundOrNull(row.rmr, 0),
    appendicularLeanMassIndex: roundOrNull(row.rsmi, 2),
    boneMineralDensityGPerCm2: roundOrNull(row.bmdTotal, 3),
    tScore: roundOrNull(row.tScore, 1),
    zScore: roundOrNull(row.zScore, 1),
  };
}

function projectMeasurement(
  row: BodyCompositionTimeline["compositionMarkers"][number],
): z.infer<typeof measurement> {
  return {
    date: row.date,
    weightKg: roundOrNull(row.weightKg, 2),
    bodyFatPct: roundOrNull(row.bodyFatPct, 1),
    fatMassKg: roundOrNull(row.fatMassKg, 2),
    leanMassKg: roundOrNull(row.leanMassKg, 2),
    boneMassKg: roundOrNull(row.boneMassKg, 2),
  };
}

/** Pure projection; both inputs are newest first. */
export function buildBodyComp(
  scans: readonly DexaScanRow[],
  timeline: Pick<BodyCompositionTimeline, "compositionMarkers">,
  now: Date = new Date(),
): BodyCompOutput {
  const generatedAt = now.toISOString();
  const items = timeline.compositionMarkers
    .slice(0, BODY_COMP_MAX_MEASUREMENTS)
    .map(projectMeasurement);

  if (scans.length === 0 && items.length === 0) {
    return {
      status: "no_data",
      summary: "No DEXA scans or body-composition measurements are recorded yet.",
      generatedAt,
    };
  }

  const [latest, previous] = scans;
  return {
    status: "ok",
    dexa: {
      status: latest ? "ok" : "no_data",
      scanCount: scans.length,
      latest: latest ? projectDexaScan(latest) : null,
      previous: previous ? projectDexaScan(previous) : null,
    },
    measurements: {
      status: items.length > 0 ? "ok" : "no_data",
      count: items.length,
      items,
    },
    generatedAt,
  };
}

/** Freshly reads the bound organization's body composition. */
export async function executeBodyComp(context: AiHealthToolContext): Promise<BodyCompOutput> {
  const access = await resolveToolAccess(context, "bodyComp");
  if (!access.allowed) {
    return { status: "unavailable", reason: access.reason, generatedAt: access.now.toISOString() };
  }

  const organizationId = context.organizationId;
  const [scans, timeline] = await Promise.all([
    access.sources.listDexaScans(organizationId),
    access.sources.getBodyCompositionTimeline(organizationId, BODY_COMP_MAX_MEASUREMENTS),
  ]);
  const result = buildBodyComp(scans, timeline, access.now);

  logToolExecuted(
    context,
    access.logger,
    "bodyComp",
    result.status,
    result.status === "ok"
      ? { dexaScans: result.dexa.scanCount, measurements: result.measurements.count }
      : {},
  );
  return result;
}

export function createBodyCompTool(context: AiHealthToolContext) {
  return tool({
    description:
      "Get the user's recorded body composition: the two newest DEXA scans (body fat, fat and " +
      "lean mass, bone density and related values) and the newest body-composition " +
      "measurements such as smart-scale readings. Use weightTrend for weight over time.",
    inputSchema: z.strictObject({}),
    execute: async () => executeBodyComp(context),
  });
}
