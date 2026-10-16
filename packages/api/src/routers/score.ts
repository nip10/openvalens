import { createStructuredLogger } from "@openvalens/observability";

import { permissionedProcedure, raiseApiError, validateInput } from "../index";
import { createScoreService } from "../score";
import {
  goalProgressResultSchema,
  readinessResultSchema,
  scoreInputSchema,
} from "../score-contract";

/**
 * Issue #95 — the two "how am I doing?" numbers, computed on request.
 *
 * - `score.readiness`    — experimental readiness index; `records:read`.
 * - `score.goalProgress` — progress toward configured goals; `goals:read`.
 *
 * Two procedures on purpose: the numbers are never blended, and each is
 * gated by the permission for the records it reads. The organization comes
 * only from authz (inputs are empty `strictObject`s, so any attempt to pass
 * an `organizationId` is `INVALID_INPUT`). Logs carry the outcome state and
 * profile, never a score or input value.
 */

const logger = createStructuredLogger({ level: "info" });

export const scoreRouter = {
  readiness: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(scoreInputSchema))
    .input(scoreInputSchema)
    .output(readinessResultSchema)
    .handler(async ({ context }) => {
      try {
        const result = await createScoreService({ db: context.db }).readiness({
          organizationId: context.authz.activeOrganizationId,
          viewerUserId: context.authz.user.id,
        });
        logger.info("score.readiness.computed", {
          correlationId: context.correlationId,
          status: result.status,
          profile: result.profile,
          usedInputs: result.coverage.usedInputs.length,
        });
        return result;
      } catch {
        throw raiseApiError("INTERNAL", "Something went wrong.");
      }
    }),

  goalProgress: permissionedProcedure({ resource: "goals", action: "read" })
    .use(validateInput(scoreInputSchema))
    .input(scoreInputSchema)
    .output(goalProgressResultSchema)
    .handler(async ({ context }) => {
      try {
        const result = await createScoreService({ db: context.db }).goalProgress({
          organizationId: context.authz.activeOrganizationId,
          viewerUserId: context.authz.user.id,
        });
        logger.info("score.goal_progress.computed", {
          correlationId: context.correlationId,
          status: result.status,
          scoredGoals: result.coverage.scored,
          totalGoals: result.coverage.total,
        });
        return result;
      } catch {
        throw raiseApiError("INTERNAL", "Something went wrong.");
      }
    }),
};
