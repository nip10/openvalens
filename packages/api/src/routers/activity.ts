import { listDailyActivityTotals } from "@openhealth/activity";
import { z } from "zod";

import { permissionedProcedure, validateInput } from "../index";

/**
 * Activity oRPC surface — daily totals aggregated from `metric_sample`.
 *
 * One procedure today:
 *
 * - `activity.dailyTotals` — read; `permissionedProcedure` on the
 *   `records` resource with `read` action. Returns the most recent
 *   `days` calendar days (1..365, default 30), with per-day sums for
 *   steps / active calories / distance. Days with no rows return `null`
 *   for that metric; the presenter decides how to render.
 *
 * Org/user are taken exclusively from authz — the input is `strictObject`
 * and any attempt to override `organizationId` or `userId` is rejected
 * with `INVALID_INPUT` at the boundary, before authz runs.
 *
 * No PHI is logged.
 */
const dailyTotalsInput = z.strictObject({
  days: z.number().int().min(1).max(365).optional(),
});

const dailyTotalsOutput = z.array(
  z.object({
    date: z.string(),
    steps: z.number().nullable(),
    activeCaloriesKcal: z.number().nullable(),
    distanceMeters: z.number().nullable(),
  }),
);

export const activityRouter = {
  dailyTotals: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(dailyTotalsInput))
    .input(dailyTotalsInput)
    .output(dailyTotalsOutput)
    .handler(async ({ input, context }) =>
      listDailyActivityTotals(context.db, context.authz.activeOrganizationId, input.days ?? 30),
    ),
};
