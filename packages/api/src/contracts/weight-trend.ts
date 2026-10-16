import { z } from "zod";

/**
 * `body.weightTrend` wire contract (Issue #87). Imports only `zod` so web and
 * native can share it. The input is strict: unknown keys — including any
 * `organizationId` or `userId` — are rejected; the member always comes from
 * the session.
 *
 * Every response is labelled provisional and carries the versioned method.
 * `points` holds recorded days only; missing days appear in `gaps`, never as
 * values. Consumers such as the TDEE estimate (#76) read `completeness` and
 * `status` and must treat `insufficient_data` as "no trend", never as zero.
 */

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const weightTrendInput = z.strictObject({ from: localDate, to: localDate });
export type WeightTrendInput = z.infer<typeof weightTrendInput>;

export const weightTrendPoint = z.object({
  date: z.string(),
  observedKg: z.number(),
  source: z.enum(["auto", "override"]),
  manualCorrection: z.boolean(),
  trendKg: z.number().nullable(),
  windowObservations: z.number().int(),
});

export const weightTrendOutput = z.object({
  status: z.enum(["provisional", "insufficient_data"]),
  provisional: z.literal(true),
  range: z.object({ from: z.string(), to: z.string() }),
  method: z.object({
    id: z.literal("trailing_mean"),
    version: z.literal(1),
    windowDays: z.number().int(),
    minObservations: z.number().int(),
    precisionKg: z.number(),
  }),
  points: z.array(weightTrendPoint),
  gaps: z.array(z.object({ from: z.string(), to: z.string(), days: z.number().int() })),
  completeness: z.object({
    days: z.number().int(),
    observedDays: z.number().int(),
    missingDays: z.number().int(),
    trendDays: z.number().int(),
    manualCorrectionDays: z.number().int(),
    longestGapDays: z.number().int(),
    firstObservedDate: z.string().nullable(),
    lastObservedDate: z.string().nullable(),
  }),
  change: z
    .object({ from: z.string(), to: z.string(), days: z.number().int(), kg: z.number() })
    .nullable(),
  notes: z.object({
    provisional: z.string(),
    variability: z.string(),
    gaps: z.string(),
    sparse: z.string(),
  }),
});
export type WeightTrendOutput = z.infer<typeof weightTrendOutput>;
