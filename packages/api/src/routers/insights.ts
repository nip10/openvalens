import type { Resource } from "@openvalens/auth/access/permissions";
import type { AuthzRequestContext } from "@openvalens/auth/authz/context";
import { requirePermission, type OrgAuthContext } from "@openvalens/auth/authz/guard";
import {
  requireTrustedIdentity,
  resolveSessionIdentity,
} from "@openvalens/auth/authz/trusted-session";
import { readNutritionTargetSettings } from "@openvalens/nutrition";
import { createStructuredLogger } from "@openvalens/observability";
import { ORPCError } from "@orpc/server";

import type { Context } from "../context";
import {
  permissionedProcedure,
  protectedProcedure,
  publicProcedure,
  raiseApiError,
  validateInput,
} from "../index";
import {
  emailUnsubscribeInput,
  emailUnsubscribeOutput,
  insightFeedbackInput,
  insightFeedbackOutput,
  insightPreferencesGetInput,
  insightPreferencesSchema,
  insightPreferencesUpdateInput,
  insightsListInput,
  insightsResultSchema,
  pushDeviceOutput,
  pushDeviceRegisterInput,
  pushDeviceUnregisterInput,
} from "../insight-contract";
import {
  createInsightService,
  InsightServiceError,
  type InsightAccess,
  type InsightDeliveryContext,
} from "../insights";
import { loadNutritionObservations } from "../nutrition-observation-data";
import { isModuleEnabled } from "../presenters/modules";
import { readWellnessProfile } from "../wellness-profile";

/**
 * Issue #92 — insights.
 *
 * - `insights.list`                 — deterministic insights for the active
 *                                     workspace (`records:read`); weight and
 *                                     goal rules also need `weight:read` /
 *                                     `goals:read`, otherwise they report
 *                                     `no_access`.
 * - `insights.feedback`             — dismiss / "not useful" (own feedback).
 * - `insights.preferences.get|update` — per-workspace delivery settings;
 *                                     turning push or email on is for the
 *                                     workspace owner only.
 * - `insights.pushDevices.register|unregister` — this phone's Expo token.
 * - `insights.unsubscribe`          — public one-step email unsubscribe by
 *                                     token (no sign-in).
 *
 * Organization and user come only from the trusted session/authz context.
 * Mutations refuse impersonated sessions. Logs carry outcome counts, rule
 * ids and changed setting names — never an insight value or a token.
 */

const logger = createStructuredLogger({ level: "info" });

function requestContext(context: Context): AuthzRequestContext {
  return { req: { raw: { headers: context.honoContext.req.raw.headers } } };
}

async function can(context: Context, resource: Resource): Promise<boolean> {
  try {
    await requirePermission(requestContext(context), { resource, action: "read" });
    return true;
  } catch {
    return false;
  }
}

async function accessFor(context: Context): Promise<InsightAccess> {
  const [weight, goals] = await Promise.all([can(context, "weight"), can(context, "goals")]);
  return { weight, goals };
}

function deliveryFor(context: Context, authz: OrgAuthContext): InsightDeliveryContext {
  const identity = resolveSessionIdentity(context.session);
  return {
    canConfigureDelivery: authz.role === "owner" && identity !== null && !identity.impersonated,
    pushAvailable: Boolean(context.push),
    emailAvailable:
      context.integrations?.email?.state === "configured" &&
      Boolean(context.webOrigin) &&
      Boolean(context.insightUnsubscribeKey),
  };
}

function requireNotImpersonated(context: Context): string {
  try {
    return requireTrustedIdentity(context.session).userId;
  } catch {
    throw raiseApiError("PERMISSION_DENIED", "You do not have permission to perform this action.");
  }
}

function mapError(error: unknown): never {
  if (error instanceof InsightServiceError) {
    if (error.code === "DENIED")
      throw raiseApiError(
        "PERMISSION_DENIED",
        "You do not have permission to perform this action.",
      );
    throw raiseApiError("INVALID_INPUT", "Invalid input", { reason: error.reason });
  }
  if (error instanceof ORPCError) throw error;
  throw raiseApiError("INTERNAL", "Something went wrong.");
}

export const insightsRouter = {
  list: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(insightsListInput))
    .input(insightsListInput)
    .output(insightsResultSchema)
    .handler(async ({ context }) => {
      try {
        const scope = {
          organizationId: context.authz.activeOrganizationId,
          userId: context.authz.user.id,
        };
        const service = createInsightService({ db: context.db });
        const delivery = deliveryFor(context, context.authz);
        const result = await service.list(scope, await accessFor(context), delivery);
        // This preference is persisted with the existing per-member insights
        // settings. The route itself has no identity inputs; scope comes from
        // the trusted authz context. Withheld adults-only profiles load nothing.
        if (result.status === "available") {
          const preferences = await service.getPreferences(scope, delivery);
          // Onboarding stage 1: observations need the food module, plus the
          // module of the records they describe.
          const profile = await readWellnessProfile(context.db, scope.userId);
          if (preferences.channels.observation.in_app && isModuleEnabled(profile, "food")) {
            const to = new Date(`${result.asOf}T00:00:00.000Z`);
            const from = new Date(to);
            from.setUTCDate(from.getUTCDate() - 27);
            const workoutPermission = await can(context, "workout");
            // The member's persisted hide-numbers setting (#80) governs whether
            // observation counts are returned; a missing row reads as default.
            const nutritionSettings = await readNutritionTargetSettings(context.db, scope);
            result.observations = await loadNutritionObservations(
              context.db,
              scope,
              { from: from.toISOString().slice(0, 10), to: result.asOf },
              {
                optedIn: true,
                nutrition: true,
                // The procedure's records:read guard is the sleep/diary read gate.
                sleep: isModuleEnabled(profile, "sleep"),
                activity: workoutPermission && isModuleEnabled(profile, "activity"),
                hideNumbers: nutritionSettings.hideNumbers,
              },
            );
          }
        }
        logger.info("insights.list.computed", {
          correlationId: context.correlationId,
          status: result.status,
          shown: result.insights.length,
          hidden: result.hiddenCount,
          suppressed: result.budget.suppressedChanges,
          ruleIds: result.insights.map((insight) => insight.ruleId),
        });
        return result;
      } catch (error) {
        mapError(error);
      }
    }),

  feedback: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(insightFeedbackInput))
    .input(insightFeedbackInput)
    .output(insightFeedbackOutput)
    .handler(async ({ context, input }) => {
      const userId = requireNotImpersonated(context);
      try {
        const { mutedUntil } = await createInsightService({ db: context.db }).feedback(
          { organizationId: context.authz.activeOrganizationId, userId },
          input.insightId,
          input.action,
        );
        logger.info("insights.feedback.recorded", {
          correlationId: context.correlationId,
          action: input.action,
          ruleId: input.insightId.split(":")[0],
        });
        return {
          insightId: input.insightId,
          action: input.action,
          mutedUntil: mutedUntil?.toISOString() ?? null,
        };
      } catch (error) {
        mapError(error);
      }
    }),

  preferences: {
    get: permissionedProcedure({ resource: "records", action: "read" })
      .use(validateInput(insightPreferencesGetInput))
      .input(insightPreferencesGetInput)
      .output(insightPreferencesSchema)
      .handler(async ({ context }) => {
        try {
          return await createInsightService({ db: context.db }).getPreferences(
            { organizationId: context.authz.activeOrganizationId, userId: context.authz.user.id },
            deliveryFor(context, context.authz),
          );
        } catch (error) {
          mapError(error);
        }
      }),

    update: permissionedProcedure({ resource: "records", action: "read" })
      .use(validateInput(insightPreferencesUpdateInput))
      .input(insightPreferencesUpdateInput)
      .output(insightPreferencesSchema)
      .handler(async ({ context, input }) => {
        const userId = requireNotImpersonated(context);
        try {
          const { preferences, changed } = await createInsightService({
            db: context.db,
          }).updatePreferences(
            { organizationId: context.authz.activeOrganizationId, userId },
            deliveryFor(context, context.authz),
            input,
          );
          logger.info("insights.preferences.updated", {
            correlationId: context.correlationId,
            changed,
            pushEnabled: preferences.push.enabled,
            emailEnabled: preferences.email.enabled,
          });
          return preferences;
        } catch (error) {
          mapError(error);
        }
      }),
  },

  pushDevices: {
    register: protectedProcedure
      .use(validateInput(pushDeviceRegisterInput))
      .input(pushDeviceRegisterInput)
      .output(pushDeviceOutput)
      .handler(async ({ context, input }) => {
        const userId = requireNotImpersonated(context);
        try {
          const registeredDevices = await createInsightService({
            db: context.db,
          }).registerPushDevice(userId, input.token, input.platform);
          logger.info("insights.push_device.registered", {
            correlationId: context.correlationId,
            platform: input.platform,
            registeredDevices,
          });
          return { registeredDevices };
        } catch (error) {
          mapError(error);
        }
      }),

    unregister: protectedProcedure
      .use(validateInput(pushDeviceUnregisterInput))
      .input(pushDeviceUnregisterInput)
      .output(pushDeviceOutput)
      .handler(async ({ context, input }) => {
        const userId = requireNotImpersonated(context);
        try {
          const registeredDevices = await createInsightService({
            db: context.db,
          }).unregisterPushDevice(userId, input.token);
          return { registeredDevices };
        } catch (error) {
          mapError(error);
        }
      }),
  },

  unsubscribe: publicProcedure
    .use(validateInput(emailUnsubscribeInput))
    .input(emailUnsubscribeInput)
    .output(emailUnsubscribeOutput)
    .handler(async ({ context, input }) => {
      try {
        const status = await createInsightService({ db: context.db }).unsubscribeEmail(input.token);
        logger.info("insights.email.unsubscribe", { correlationId: context.correlationId, status });
        return { status };
      } catch (error) {
        mapError(error);
      }
    }),
};
