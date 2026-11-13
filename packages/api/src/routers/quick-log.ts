import { requirePermission } from "@openvalens/auth/authz/guard";
import { readNutritionTargetSettings } from "@openvalens/nutrition";

import {
  quickLogRecentsInput,
  quickLogRecentsOutput,
  supplementsDueInput,
  supplementsDueOutput,
} from "../contracts/quick-log";
import { permissionedProcedure, validateInput } from "../index";
import {
  buildRecentLogEntries,
  DEFAULT_RECENTS_LIMIT,
  loadRecentIntakeRows,
  loadRecentMetricRows,
  loadRecentWaterRows,
  loadSupplementsDue,
} from "../quick-log";

/**
 * Quick log (#440): reads behind the web command palette and the mobile log
 * picker. Writes go through each kind's own procedure (ingestMetricSample,
 * plainWater.add, supplementIntake.create, sleep.logManualSession, …).
 */
export const quickLogRouter = {
  /**
   * The member's last distinct typed-in entries (metrics, blood pressure,
   * water, supplement intakes), newest first, to repeat with the time set to
   * now. Supplement intakes are left out when the role cannot read
   * supplements; water when the member hides nutrition numbers.
   */
  recents: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(quickLogRecentsInput))
    .input(quickLogRecentsInput)
    .output(quickLogRecentsOutput)
    .handler(async ({ input, context }) => {
      const owner = {
        organizationId: context.authz.activeOrganizationId,
        userId: context.authz.user.id,
      };
      const canReadSupplements = await requirePermission(
        { req: { raw: { headers: context.honoContext.req.raw.headers } } },
        { resource: "supplements", action: "read" },
      ).then(
        () => true,
        () => false,
      );
      const [metrics, settings, intakes] = await Promise.all([
        loadRecentMetricRows(context.db, owner),
        readNutritionTargetSettings(context.db, owner),
        canReadSupplements ? loadRecentIntakeRows(context.db, owner) : Promise.resolve([]),
      ]);
      const water = settings.hideNumbers ? [] : await loadRecentWaterRows(context.db, owner);
      return {
        entries: buildRecentLogEntries(
          { metrics, water, intakes },
          input?.limit ?? DEFAULT_RECENTS_LIMIT,
        ),
      };
    }),

  /**
   * Supplements whose scheduled time has come today (in `timeZone`) and that
   * are not yet taken as often as they were due, for a one-tap "Taken".
   */
  supplementsDue: permissionedProcedure({ resource: "supplements", action: "read" })
    .use(validateInput(supplementsDueInput))
    .input(supplementsDueInput)
    .output(supplementsDueOutput)
    .handler(({ input, context }) =>
      loadSupplementsDue(
        context.db,
        { organizationId: context.authz.activeOrganizationId, userId: context.authz.user.id },
        input.timeZone,
      ),
    ),
};
