import { createStructuredLogger } from "@openvalens/observability";

import {
  drinkPresetsInput,
  drinkPresetsOutput,
  drinkSummaryInput,
  drinkSummaryOutput,
  lastCaffeineInput,
  lastCaffeineOutput,
} from "../contracts/nutrition-drinks";
import { permissionedProcedure, raiseApiError, validateInput } from "../index";
import { readDrinkPresets, readDrinkSummary, readLastCaffeine } from "../nutrition-drinks";
import { requireProfileOwner } from "../wellness-profile";

/**
 * Issue #443 (part b) — drink presets, the opt-in caffeine and alcohol day
 * totals and the sleep view's "last caffeine", mounted as
 * `appRouter.nutritionDrinks`. Read-only: a preset is logged through
 * `nutritionDiary.logEntry`. The totals and the sleep fact are the member's
 * own session only; logs carry statuses, never an amount or a time.
 */

const logger = createStructuredLogger({ level: "info" });
const read = () => permissionedProcedure({ resource: "records", action: "read" });

function ownScope(context: {
  authz: { activeOrganizationId: string; user: { id: string } };
  session: Parameters<typeof requireProfileOwner>[0];
}) {
  const userId = context.authz.user.id;
  if (requireProfileOwner(context.session) !== userId)
    throw raiseApiError("PERMISSION_DENIED", "You do not have permission to perform this action.");
  return { organizationId: context.authz.activeOrganizationId, userId };
}

export const nutritionDrinksRouter = {
  /** The drink presets, each with whether its catalog food is imported here. */
  presets: read()
    .use(validateInput(drinkPresetsInput))
    .input(drinkPresetsInput)
    .output(drinkPresetsOutput)
    .handler(({ context }) => readDrinkPresets(context.db)),

  /** The day's opt-in caffeine and alcohol totals, with coverage and sources. */
  summary: read()
    .use(validateInput(drinkSummaryInput))
    .input(drinkSummaryInput)
    .output(drinkSummaryOutput)
    .handler(async ({ context, input }) => {
      const result = await readDrinkSummary(context.db, ownScope(context), input.localDate);
      logger.info("nutrition.drinks.summary", {
        correlationId: context.correlationId,
        caffeine: result.caffeine.status,
        alcohol: result.alcohol.status,
      });
      return result;
    }),

  /** When the member last had caffeine before each sleep night; only with the caffeine setting on. */
  lastCaffeine: read()
    .use(validateInput(lastCaffeineInput))
    .input(lastCaffeineInput)
    .output(lastCaffeineOutput)
    .handler(({ context, input }) => readLastCaffeine(context.db, ownScope(context), input)),
};
