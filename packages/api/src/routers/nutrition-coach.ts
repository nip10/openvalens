import {
  buildNutritionCoachContext,
  createNutritionCoachConsent,
  createNutritionTotals,
  NUTRITION_COACH_DEFAULT_WINDOW_DAYS,
  NUTRITION_COACH_MAX_WINDOW_DAYS,
  NutritionError,
  type NutritionCoachContext as NutritionCoachContextPayload,
  type NutritionScope,
} from "@openvalens/nutrition";
import { createStructuredLogger } from "@openvalens/observability";
import { z } from "zod";

import { permissionedProcedure, raiseApiError, validateInput } from "../index";

/**
 * Coach nutrition-context consent (Issue #86), mounted as
 * `appRouter.nutritionCoach`.
 *
 * Four procedures, all scoped to the session's active organization AND the
 * signed-in member (never to a client-supplied id):
 *
 * - `getConsent`      — the member's own consent state, or `null`.
 * - `grantConsent`    — grants/re-grants at the current disclosure version,
 *                       recording the member's hide-numbers choice.
 * - `revokeConsent`   — revokes; the next Coach call stops including context.
 * - `previewContext`  — the exact sanitized summary the Coach would receive,
 *                       so the member can review it before anything is sent.
 *
 * The context is built with the same pure builder the chat tool uses, so the
 * preview can never show more than what would actually be transmitted. Writes
 * carry ids only; no nutrient value or food is ever logged.
 */

const logger = createStructuredLogger({ level: "info" });

type AuthzContext = { authz: { activeOrganizationId: string; user: { id: string } } };

function scopeOf(context: AuthzContext): NutritionScope {
  return { organizationId: context.authz.activeOrganizationId, userId: context.authz.user.id };
}

const read = () => permissionedProcedure({ resource: "records", action: "read" });

const consentStateShape = z.object({
  granted: z.boolean(),
  includeNumbers: z.boolean(),
  grantedAt: z.string(),
  revokedAt: z.string().nullable(),
  consentVersion: z.string(),
});

const contextShape: z.ZodType<NutritionCoachContextPayload> = z.object({
  windowDays: z.number(),
  loggedDays: z.number(),
  completeDays: z.number(),
  coverage: z.enum(["full", "partial", "none", "no_entries"]),
  numbersHidden: z.boolean(),
  averages: z
    .record(
      z.enum(["energyKcal", "proteinG", "carbohydrateG", "fatG", "fiberG"]),
      z.number().nullable(),
    )
    .nullable(),
  notes: z.array(z.string()),
});

const emptyInput = z.strictObject({});
const grantInput = z.strictObject({ includeNumbers: z.boolean() });
const previewInput = z.strictObject({
  windowDays: z.number().int().min(1).max(NUTRITION_COACH_MAX_WINDOW_DAYS).optional(),
});

/** Maps a typed nutrition failure onto the stable envelope; messages carry no values. */
function run<T>(work: () => Promise<T>): Promise<T> {
  return work().catch((error: unknown) => {
    if (error instanceof NutritionError)
      throw raiseApiError("INVALID_INPUT", error.message, { reason: error.code });
    throw error;
  });
}

export const nutritionCoachRouter = {
  getConsent: read()
    .use(validateInput(emptyInput))
    .input(emptyInput)
    .output(consentStateShape.nullable())
    .handler(({ context }) => createNutritionCoachConsent(context.db).get(scopeOf(context))),

  grantConsent: read()
    .use(validateInput(grantInput))
    .input(grantInput)
    .output(consentStateShape)
    .handler(({ input, context }) =>
      run(async () => {
        const state = await createNutritionCoachConsent(context.db).grant(scopeOf(context), {
          includeNumbers: input.includeNumbers,
        });
        logger.info("nutrition.coach_consent.granted", {
          correlationId: context.correlationId,
          organizationId: context.authz.activeOrganizationId,
          includeNumbers: input.includeNumbers,
        });
        return state;
      }),
    ),

  revokeConsent: read()
    .use(validateInput(emptyInput))
    .input(emptyInput)
    .output(consentStateShape)
    .handler(({ context }) =>
      run(async () => {
        const state = await createNutritionCoachConsent(context.db).revoke(scopeOf(context));
        logger.info("nutrition.coach_consent.revoked", {
          correlationId: context.correlationId,
          organizationId: context.authz.activeOrganizationId,
        });
        return state;
      }),
    ),

  /**
   * The exact sanitized summary the Coach would send right now, plus whether
   * it would be shared. Reads the member's own totals (#79); numbers come from
   * the consent's `includeNumbers` choice (default off), so a revoke or a
   * numbers-off consent is reflected immediately.
   */
  previewContext: read()
    .use(validateInput(previewInput))
    .input(previewInput)
    .output(
      z.object({
        sharedWithProvider: z.boolean(),
        context: contextShape,
      }),
    )
    .handler(({ input, context }) =>
      run(async () => {
        const scope = scopeOf(context);
        const consent = await createNutritionCoachConsent(context.db).get(scope);
        const sharedWithProvider = consent?.granted === true && consent.revokedAt === null;
        const includeNumbers = sharedWithProvider ? consent.includeNumbers : false;

        const windowDays = input.windowDays ?? NUTRITION_COACH_DEFAULT_WINDOW_DAYS;
        const to = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - (windowDays - 1) * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const days = await createNutritionTotals(context.db).listDays(scope, { from, to });

        return {
          sharedWithProvider,
          context: buildNutritionCoachContext(days, { includeNumbers }),
        };
      }),
    ),
};
