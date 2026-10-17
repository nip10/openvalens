import { createStructuredLogger } from "@openvalens/observability";
import { z } from "zod";

import { permissionedProcedure, protectedProcedure, raiseApiError, validateInput } from "../index";
import { createReferenceComparisonService } from "../reference-comparison";
import {
  comparisonSettingsSchema,
  comparisonSettingsUpdateInput,
  referenceComparisonsInputSchema,
  referenceComparisonsResultSchema,
} from "../reference-comparison-contract";
import { requireProfileOwner } from "../wellness-profile";

/**
 * Issue #96 — reference comparisons.
 *
 * - `comparison.get`            — your own trend plus, for metrics you turned
 *                                 on, a cited guideline range or coarse band;
 *                                 `records:read` on the active workspace.
 * - `comparison.settings`       — your per-metric opt-ins.
 * - `comparison.updateSettings` — turn one metric's comparison on or off.
 *
 * The profile (age, sex) and opt-ins are keyed only by the trusted session
 * user, and an impersonated session is denied (as for `profile.*`). Records
 * are keyed only by the active organization from authz. Logs carry statuses,
 * reasons and metric names, never a value or a profile answer.
 */

const logger = createStructuredLogger({ level: "info" });
const emptyInput = z.strictObject({});

export const comparisonRouter = {
  get: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(referenceComparisonsInputSchema))
    .input(referenceComparisonsInputSchema)
    .output(referenceComparisonsResultSchema)
    .handler(async ({ context }) => {
      const userId = requireProfileOwner(context.session);
      if (userId !== context.authz.user.id)
        throw raiseApiError(
          "PERMISSION_DENIED",
          "You do not have permission to perform this action.",
        );
      try {
        const result = await createReferenceComparisonService({ db: context.db }).compare({
          organizationId: context.authz.activeOrganizationId,
          viewerUserId: userId,
          viewerOwnsWorkspace: context.authz.role === "owner",
        });
        logger.info("comparison.computed", {
          correlationId: context.correlationId,
          status: result.status,
          comparisons: result.comparisons.map(
            (c) => `${c.metric}:${c.status}${c.unavailableReason ? `:${c.unavailableReason}` : ""}`,
          ),
        });
        return result;
      } catch {
        throw raiseApiError("INTERNAL", "Something went wrong.");
      }
    }),

  settings: protectedProcedure
    .use(validateInput(emptyInput))
    .input(emptyInput)
    .output(comparisonSettingsSchema)
    .handler(async ({ context }) => {
      const userId = requireProfileOwner(context.session);
      try {
        return await createReferenceComparisonService({ db: context.db }).settings(userId);
      } catch {
        throw raiseApiError("INTERNAL", "Something went wrong.");
      }
    }),

  updateSettings: protectedProcedure
    .use(validateInput(comparisonSettingsUpdateInput))
    .input(comparisonSettingsUpdateInput)
    .output(comparisonSettingsSchema)
    .handler(async ({ context, input }) => {
      const userId = requireProfileOwner(context.session);
      try {
        const outcome = await createReferenceComparisonService({
          db: context.db,
        }).updateSettings(userId, input);
        if (outcome.changed)
          logger.info("comparison.opt_in_changed", {
            correlationId: context.correlationId,
            metric: input.metric,
            enabled: input.enabled,
          });
        return outcome.settings;
      } catch {
        throw raiseApiError("INTERNAL", "Something went wrong.");
      }
    }),
};
