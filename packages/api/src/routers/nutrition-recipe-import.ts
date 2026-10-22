import type { NutritionScope } from "@openvalens/nutrition";
import { createStructuredLogger } from "@openvalens/observability";

import {
  importRecipeFromUrlInput,
  importRecipeFromUrlOutput,
} from "../contracts/nutrition-recipe-import";
import { permissionedProcedure, raiseApiError, validateInput } from "../index";
import { createRecipeImportService } from "../recipe-import/service";
import { requireProfileOwner } from "../wellness-profile";

/**
 * Issue #82 — opt-in recipe import from a URL, mounted as
 * `appRouter.nutritionRecipeImport`.
 *
 * - `fromUrl` — fetches the one page the member submitted and returns an
 *   unsaved, editable draft (`records:write`, the member's own session).
 *
 * Nothing is written: drafts live on the member's device until a save
 * exists. Logs carry the outcome only, never the URL, host or page content.
 */

const logger = createStructuredLogger({ level: "info" });

/** Process-wide so the per-user and per-domain limits hold across requests. */
const defaultService = createRecipeImportService();

function scopeOf(context: {
  authz: { activeOrganizationId: string; user: { id: string } };
}): NutritionScope {
  return { organizationId: context.authz.activeOrganizationId, userId: context.authz.user.id };
}

export const nutritionRecipeImportRouter = {
  fromUrl: permissionedProcedure({ resource: "records", action: "write" })
    .use(validateInput(importRecipeFromUrlInput))
    .input(importRecipeFromUrlInput)
    .output(importRecipeFromUrlOutput)
    .handler(async ({ input, context }) => {
      const scope = scopeOf(context);
      if (requireProfileOwner(context.session) !== scope.userId)
        throw raiseApiError(
          "PERMISSION_DENIED",
          "You do not have permission to perform this action.",
        );
      const service = context.recipeImportService ?? defaultService;
      const result = await service.importFromUrl(context.db, scope, input);
      logger.info("nutrition.recipe_import", {
        correlationId: context.correlationId,
        status: result.status,
      });
      return result;
    }),
};
