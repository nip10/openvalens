import { listDailyVitals, listRecentHeartRateSamples } from "@openhealth/vitals";
import { z } from "zod";

import { permissionedProcedure, validateInput } from "../index";

/**
 * Vitals oRPC surface — daily averages + recent samples from `metric_sample`.
 *
 * Two procedures:
 *
 * - `vitals.daily`           — read; `permissionedProcedure` on `records`
 *   with `read` action. Returns per-day avg/min/max heart rate and avg
 *   resting heart rate for the last `days` calendar days (default 30).
 * - `vitals.recentSamples`   — read; same permission. Returns the most
 *   recent `limit` heart-rate samples (default 20).
 *
 * Org/user are taken exclusively from authz — the inputs are `strictObject`
 * and any payload attempt to override `organizationId` or `userId` is rejected
 * with `INVALID_INPUT` at the boundary, before authz runs.
 */
const dailyInput = z.strictObject({
  days: z.number().int().min(1).max(365).optional(),
});

const recentSamplesInput = z.strictObject({
  limit: z.number().int().min(1).max(500).optional(),
});

const dailyOutput = z.array(
  z.object({
    date: z.string(),
    heartRate: z.object({
      avgBpm: z.number().nullable(),
      minBpm: z.number().nullable(),
      maxBpm: z.number().nullable(),
      sampleCount: z.number(),
    }),
    restingHeartRate: z.object({
      avgBpm: z.number().nullable(),
      sampleCount: z.number(),
    }),
  }),
);

const recentSamplesOutput = z.array(
  z.object({
    sampledAt: z.string(),
    heartRateBpm: z.number(),
    source: z.string().nullable(),
  }),
);

export const vitalsRouter = {
  daily: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(dailyInput))
    .input(dailyInput)
    .output(dailyOutput)
    .handler(async ({ input, context }) =>
      listDailyVitals(context.db, context.authz.activeOrganizationId, input.days ?? 30),
    ),

  recentSamples: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(recentSamplesInput))
    .input(recentSamplesInput)
    .output(recentSamplesOutput)
    .handler(async ({ input, context }) =>
      listRecentHeartRateSamples(context.db, context.authz.activeOrganizationId, input.limit ?? 20),
    ),
};
