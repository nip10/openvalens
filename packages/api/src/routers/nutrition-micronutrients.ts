import { createStructuredLogger } from "@openvalens/observability";

import {
  micronutrientSummaryInput,
  micronutrientSummaryOutput,
} from "../contracts/nutrition-micronutrients";
import { permissionedProcedure, raiseApiError, validateInput } from "../index";
import { readMicronutrientSummary } from "../nutrition-micronutrients";
import { requireProfileOwner } from "../wellness-profile";

/**
 * Issue #78 — opt-in micronutrient summary, mounted as
 * `appRouter.nutritionMicronutrients`. The member's own session only; logs
 * carry the status, never an amount or a declaration.
 */

const logger = createStructuredLogger({ level: "info" });

export const nutritionMicronutrientsRouter = {
  summary: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(micronutrientSummaryInput))
    .input(micronutrientSummaryInput)
    .output(micronutrientSummaryOutput)
    .handler(async ({ context, input }) => {
      const userId = context.authz.user.id;
      if (requireProfileOwner(context.session) !== userId)
        throw raiseApiError(
          "PERMISSION_DENIED",
          "You do not have permission to perform this action.",
        );
      const result = await readMicronutrientSummary(
        context.db,
        { organizationId: context.authz.activeOrganizationId, userId },
        input.localDate,
      );
      logger.info("nutrition.micronutrients.summary", {
        correlationId: context.correlationId,
        status: result.status,
      });
      return result;
    }),
};
