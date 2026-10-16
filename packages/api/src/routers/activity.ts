import { listDailyActivityTotals } from "@openvalens/activity";
import { AuthzHttpError, requirePermission } from "@openvalens/auth/authz/guard";
import { createStructuredLogger } from "@openvalens/observability";
import { z } from "zod";

import { createActivityLoadService } from "../activity-load";
import { activityLoadInputSchema, activityLoadResultSchema } from "../activity-load-contract";
import { permissionedProcedure, raiseApiError, validateInput } from "../index";

/**
 * Activity oRPC surface — daily totals aggregated from `metric_sample`.
 *
 * - `activity.dailyTotals` — read; `permissionedProcedure` on the
 *   `records` resource with `read` action. Returns the most recent
 *   `days` calendar days (1..365, default 30), with per-day sums for
 *   steps / active calories / distance. Days with no rows return `null`
 *   for that metric; the presenter decides how to render.
 * - `activity.weeklyLoad` — read; needs both `workout:read` (manual sessions)
 *   and `records:read` (wearable sessions, steps). Issue #99: WHO active
 *   minutes, session effort points and the comparison with the person's own
 *   earlier weeks (`docs/activity-load.md`). Withheld for a declared under-18.
 *   Logs carry statuses only, never minutes or points.
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

const logger = createStructuredLogger({ level: "info" });

export const activityRouter = {
  dailyTotals: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(dailyTotalsInput))
    .input(dailyTotalsInput)
    .output(dailyTotalsOutput)
    .handler(async ({ input, context }) =>
      listDailyActivityTotals(context.db, context.authz.activeOrganizationId, input.days ?? 30),
    ),

  weeklyLoad: permissionedProcedure({ resource: "workout", action: "read" })
    .use(validateInput(activityLoadInputSchema))
    .input(activityLoadInputSchema)
    .output(activityLoadResultSchema)
    .handler(async ({ context }) => {
      try {
        await requirePermission(context.honoContext as never, {
          resource: "records",
          action: "read",
        });
      } catch (error) {
        if (error instanceof AuthzHttpError) throw raiseApiError(error.code, error.message);
        throw raiseApiError("INTERNAL", "Authorization failed.");
      }
      try {
        const result = await createActivityLoadService({ db: context.db }).weekly({
          organizationId: context.authz.activeOrganizationId,
          viewerUserId: context.authz.user.id,
        });
        logger.info("activity.weekly_load.computed", {
          correlationId: context.correlationId,
          status: result.status,
          activeMinutesStatus: result.load?.activeMinutes.status ?? null,
          effortStatus: result.load?.effort.status ?? null,
          comparisonStatus: result.load?.comparison.status ?? null,
        });
        return result;
      } catch {
        throw raiseApiError("INTERNAL", "Something went wrong.");
      }
    }),
};
