import { AuthzHttpError, requirePermission } from "@openvalens/auth/authz/guard";
import { NutritionError, type NutritionScope } from "@openvalens/nutrition";
import { createStructuredLogger } from "@openvalens/observability";

import type { Context } from "../context";

import {
  clearTargetInput,
  clearTargetOutput,
  setTargetInput,
  setTargetOutput,
  targetsOverviewInput,
  targetsOverviewOutput,
  updateSettingsInput,
  updateSettingsOutput,
} from "../contracts/nutrition-targets";
import {
  permissionedProcedure,
  raiseApiError,
  tenantScopedProcedure,
  validateInput,
} from "../index";
import { createNutritionTargetsService, NutritionTargetsRequestError } from "../nutrition-targets";
import { requireProfileOwner } from "../wellness-profile";

/**
 * Issue #80 — user-owned nutrition targets, safety settings and hide-numbers
 * mode, mounted as `appRouter.nutritionTargets`.
 *
 * - `get`            — settings, safety state, targets (active and on a date), protein reference (`records:read`).
 * - `setTarget`      — the member's own target for one nutrient (`records:write`).
 * - `clearTarget`    — ends the member's target for one nutrient (`records:write`).
 * - `updateSettings` — hide-numbers, direction, active opt-in, height, declarations (`records:write`).
 *
 * Every call is keyed by the session's organization and user; inputs are
 * strict. Writes need the person's own, non-impersonated session: targets and
 * declarations are theirs alone. Audit entries carry the nutrient key or
 * "settings" only; logs carry outcomes, never a value or a declaration.
 */

const logger = createStructuredLogger({ level: "info" });

function scopeOf(context: {
  authz: { activeOrganizationId: string; user: { id: string } };
}): NutritionScope {
  return { organizationId: context.authz.activeOrganizationId, userId: context.authz.user.id };
}

/** Targets and declarations are the person's own: no impersonated session. */
function requireSelf(context: Pick<Context, "session">, scope: NutritionScope): void {
  if (requireProfileOwner(context.session) !== scope.userId)
    throw raiseApiError("PERMISSION_DENIED", "You do not have permission to perform this action.");
}

/** The protein reference reads weights; without `weight:read` it is simply left out. */
async function canReadWeight(context: Pick<Context, "honoContext">): Promise<boolean> {
  try {
    await requirePermission(context.honoContext as never, { resource: "weight", action: "read" });
    return true;
  } catch (error) {
    if (error instanceof AuthzHttpError) return false;
    throw raiseApiError("INTERNAL", "Authorization failed.");
  }
}

/** Maps typed failures onto the stable envelope; messages carry no values. */
async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof NutritionTargetsRequestError)
      throw raiseApiError("INVALID_INPUT", error.message);
    if (error instanceof NutritionError) {
      if (error.code === "NOT_FOUND") throw raiseApiError("NOT_FOUND", error.message);
      throw raiseApiError("INVALID_INPUT", error.message, { reason: error.code });
    }
    throw error;
  }
}

const service = (context: Pick<Context, "db">) => createNutritionTargetsService({ db: context.db });
const write = (auditAction: "RECORD_CREATED" | "RECORD_UPDATED") =>
  tenantScopedProcedure({
    resource: "records",
    action: "write",
    auditAction,
    targetType: "nutrition_target",
  });

export const nutritionTargetsRouter = {
  get: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(targetsOverviewInput))
    .input(targetsOverviewInput)
    .output(targetsOverviewOutput)
    .handler(async ({ input, context }) => {
      const scope = scopeOf(context);
      requireSelf(context, scope);
      const readWeight = await canReadWeight(context);
      return run(() => service(context).overview(scope, input, { readWeight }));
    }),

  setTarget: write("RECORD_UPDATED")
    .use(validateInput(setTargetInput))
    .input(setTargetInput)
    .output(setTargetOutput)
    .handler(async ({ input, context }) => {
      const scope = scopeOf(context);
      requireSelf(context, scope);
      const target = await run(() => service(context).setTarget(scope, input));
      logger.info("nutrition.target.set", {
        correlationId: context.correlationId,
        nutrient: target.nutrient,
      });
      return { target, targetId: target.nutrient };
    }),

  clearTarget: write("RECORD_UPDATED")
    .use(validateInput(clearTargetInput))
    .input(clearTargetInput)
    .output(clearTargetOutput)
    .handler(async ({ input, context }) => {
      const scope = scopeOf(context);
      requireSelf(context, scope);
      const cleared = await run(() => service(context).clearTarget(scope, input));
      return { cleared, targetId: input.nutrient };
    }),

  updateSettings: write("RECORD_UPDATED")
    .use(validateInput(updateSettingsInput))
    .input(updateSettingsInput)
    .output(updateSettingsOutput)
    .handler(async ({ input, context }) => {
      const scope = scopeOf(context);
      requireSelf(context, scope);
      const result = await run(() => service(context).updateSettings(scope, input));
      logger.info("nutrition.target_settings.update", {
        correlationId: context.correlationId,
        outcome: result.outcome,
      });
      return { ...result, targetId: "settings" };
    }),
};
