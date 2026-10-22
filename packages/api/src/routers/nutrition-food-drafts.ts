import type { NutritionScope } from "@openvalens/nutrition";
import { createStructuredLogger } from "@openvalens/observability";
import { z } from "zod";

import {
  foodDraftProviderOutput,
  parseFoodDraftInput,
  parseFoodDraftOutput,
} from "../contracts/nutrition-food-drafts";
import { createFoodDraftService, describeFoodDraftProvider, FoodDraftError } from "../food-drafts";
import { permissionedProcedure, raiseApiError, validateInput } from "../index";
import { requireProfileOwner } from "../wellness-profile";

/**
 * Issue #73 — opt-in food drafts from a spoken or typed description, mounted
 * as `appRouter.nutritionFoodDrafts`.
 *
 * - `provider` — which provider and host the optional AI mode would use.
 * - `parse`    — returns unresolved candidates; writes nothing.
 *
 * The member's own session only. Logs carry the mode and outcome, never the
 * transcript or candidates.
 */

const logger = createStructuredLogger({ level: "info" });
const defaultService = createFoodDraftService();
const empty = z.strictObject({});

function scopeOf(context: {
  session: Parameters<typeof requireProfileOwner>[0];
  authz: { activeOrganizationId: string; user: { id: string } };
}): NutritionScope {
  if (requireProfileOwner(context.session) !== context.authz.user.id)
    throw raiseApiError("PERMISSION_DENIED", "You do not have permission to perform this action.");
  return { organizationId: context.authz.activeOrganizationId, userId: context.authz.user.id };
}

export const nutritionFoodDraftsRouter = {
  provider: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(empty))
    .input(empty)
    .output(foodDraftProviderOutput)
    .handler(async ({ context }) => {
      scopeOf(context);
      return describeFoodDraftProvider(context.aiConfig);
    }),

  parse: permissionedProcedure({ resource: "records", action: "write" })
    .use(validateInput(parseFoodDraftInput))
    .input(parseFoodDraftInput)
    .output(parseFoodDraftOutput)
    .handler(async ({ context, input }) => {
      const scope = scopeOf(context);
      const service = context.foodDraftService ?? defaultService;
      try {
        const result = await service.parse(context.db, scope, input, {
          config: context.aiConfig,
          rateLimiter: context.aiRateLimiter,
        });
        logger.info("nutrition.food_draft", {
          correlationId: context.correlationId,
          mode: result.mode,
          status: result.status,
          candidates: result.candidates.length,
        });
        return result;
      } catch (error) {
        if (error instanceof FoodDraftError)
          throw error.code === "AI_DISABLED"
            ? raiseApiError("AI_DISABLED", "AI processing is disabled by org policy.")
            : raiseApiError("RATE_LIMITED", "AI usage limit reached. Try again later.");
        throw error;
      }
    }),
};
