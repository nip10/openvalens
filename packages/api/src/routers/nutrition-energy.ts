import { AuthzHttpError, requirePermission } from "@openvalens/auth/authz/guard";
import { NutritionError, type NutritionScope } from "@openvalens/nutrition";
import { createStructuredLogger } from "@openvalens/observability";

import type { Context } from "../context";

import {
  acceptProposalInput,
  acceptProposalOutput,
  decideProposalInput,
  dismissProposalOutput,
  energyEstimateInput,
  energyEstimateOutput,
  listProposalsInput,
  listProposalsOutput,
  proposeInput,
  proposeOutput,
} from "../contracts/energy-estimate";
import { createEnergyEstimateService, EnergyEstimateRequestError } from "../energy-estimate";
import {
  permissionedProcedure,
  raiseApiError,
  tenantScopedProcedure,
  validateInput,
} from "../index";
import { requireProfileOwner } from "../wellness-profile";

/**
 * Issue #76 — experimental energy estimate and user-reviewed proposals,
 * mounted as `appRouter.nutritionEnergy`.
 *
 * - `estimate`        — transparent estimate for a 28-day window (`records:read` + `weight:read`).
 * - `listProposals`   — the member's recent proposals (`records:read`).
 * - `propose`         — on request, stores a pending maintenance proposal (`records:write` + `weight:read`).
 * - `acceptProposal`  — the member's explicit accept; writes the energy goal (`records:write`).
 * - `dismissProposal` — the member's explicit dismiss; no goal change (`records:write`).
 *
 * Every call is keyed by the session's organization and user; inputs are
 * strict and carry no ids or numbers that the server would trust. Proposal
 * decisions need the person's own, non-impersonated session. Writes are
 * audited with the proposal id only; logs carry statuses and reasons, never
 * a value.
 */

const logger = createStructuredLogger({ level: "info" });

function scopeOf(context: {
  authz: { activeOrganizationId: string; user: { id: string } };
}): NutritionScope {
  return { organizationId: context.authz.activeOrganizationId, userId: context.authz.user.id };
}

/** The estimate reads weights too, so it needs `weight:read` on top of the procedure's permission. */
async function requireWeightRead(context: Pick<Context, "honoContext">): Promise<void> {
  try {
    await requirePermission(context.honoContext as never, { resource: "weight", action: "read" });
  } catch (error) {
    if (error instanceof AuthzHttpError) throw raiseApiError(error.code, error.message);
    throw raiseApiError("INTERNAL", "Authorization failed.");
  }
}

/** A decision on a proposal is the person's own: no impersonated session. */
function requireSelf(context: Pick<Context, "session">, scope: NutritionScope): void {
  if (requireProfileOwner(context.session) !== scope.userId)
    throw raiseApiError("PERMISSION_DENIED", "You do not have permission to perform this action.");
}

/** Maps typed failures onto the stable envelope; messages carry no values. */
async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof EnergyEstimateRequestError)
      throw raiseApiError("INVALID_INPUT", error.message);
    if (error instanceof NutritionError) {
      if (error.code === "NOT_FOUND") throw raiseApiError("NOT_FOUND", error.message);
      throw raiseApiError("INVALID_INPUT", error.message, { reason: error.code });
    }
    throw error;
  }
}

const service = (context: Pick<Context, "db">) => createEnergyEstimateService({ db: context.db });
const write = (auditAction: "RECORD_CREATED" | "RECORD_UPDATED") =>
  tenantScopedProcedure({
    resource: "records",
    action: "write",
    auditAction,
    targetType: "nutrition_energy_proposal",
  });
const read = () => permissionedProcedure({ resource: "records", action: "read" });

export const nutritionEnergyRouter = {
  estimate: read()
    .use(validateInput(energyEstimateInput))
    .input(energyEstimateInput)
    .output(energyEstimateOutput)
    .handler(async ({ input, context }) => {
      await requireWeightRead(context);
      const result = await run(() => service(context).estimate(scopeOf(context), input));
      logger.info("nutrition.energy_estimate.computed", {
        correlationId: context.correlationId,
        status: result.status,
        reasons: result.status === "adults_only" || result.status === "off" ? [] : result.reasons,
      });
      return result;
    }),

  listProposals: read()
    .use(validateInput(listProposalsInput))
    .input(listProposalsInput)
    .output(listProposalsOutput)
    .handler(({ context }) =>
      run(async () => ({ proposals: await service(context).listProposals(scopeOf(context)) })),
    ),

  propose: write("RECORD_CREATED")
    .use(validateInput(proposeInput))
    .input(proposeInput)
    .output(proposeOutput)
    .handler(async ({ input, context }) => {
      const scope = scopeOf(context);
      requireSelf(context, scope);
      await requireWeightRead(context);
      const result = await run(() => service(context).propose(scope, input));
      logger.info("nutrition.energy_proposal.requested", {
        correlationId: context.correlationId,
        outcome: result.outcome,
        reason: result.outcome === "declined" ? result.reason : undefined,
      });
      return result;
    }),

  acceptProposal: write("RECORD_UPDATED")
    .use(validateInput(acceptProposalInput))
    .input(acceptProposalInput)
    .output(acceptProposalOutput)
    .handler(async ({ input, context }) => {
      const scope = scopeOf(context);
      requireSelf(context, scope);
      const result = await run(() => service(context).accept(scope, input));
      logger.info("nutrition.energy_proposal.accept", {
        correlationId: context.correlationId,
        outcome: result.outcome,
        reason: result.outcome === "declined" ? result.reason : undefined,
      });
      return result;
    }),

  dismissProposal: write("RECORD_UPDATED")
    .use(validateInput(decideProposalInput))
    .input(decideProposalInput)
    .output(dismissProposalOutput)
    .handler(async ({ input, context }) => {
      const scope = scopeOf(context);
      requireSelf(context, scope);
      return run(() => service(context).dismiss(scope, input));
    }),
};
