import { z } from "zod";

import {
  analyticsCaptureResultSchema,
  analyticsPreferenceSchema,
  approvedAnalyticsEventSchema,
} from "../contracts/analytics";
import { protectedProcedure, raiseApiError, validateInput } from "../index";
import { requireProfileOwner } from "../wellness-profile";

const emptyInput = z.strictObject({});
const setPreferenceInput = z.strictObject({ enabled: z.boolean() });
const captureInput = z.strictObject({ event: approvedAnalyticsEventSchema });

export const analyticsRouter = {
  getPreference: protectedProcedure
    .use(validateInput(emptyInput))
    .input(emptyInput)
    .output(analyticsPreferenceSchema)
    .handler(async ({ context }) => {
      const userId = requireProfileOwner(context.session);
      try {
        return context.analytics
          ? await context.analytics.getPreference(userId)
          : { enabled: false, available: false };
      } catch {
        throw raiseApiError("INTERNAL", "Unable to load analytics preference. Try again.");
      }
    }),

  setPreference: protectedProcedure
    .use(validateInput(setPreferenceInput))
    .input(setPreferenceInput)
    .output(analyticsPreferenceSchema)
    .handler(async ({ context, input }) => {
      const userId = requireProfileOwner(context.session);
      if (!context.analytics) {
        throw raiseApiError("INTERNAL", "Unable to save analytics preference. Try again.");
      }
      try {
        return await context.analytics.setPreference(userId, input.enabled);
      } catch (error) {
        if (error instanceof Error && error.name === "AnalyticsUnavailableError") {
          throw raiseApiError("SOURCE_UNAVAILABLE", "Analytics is currently unavailable.");
        }
        throw raiseApiError("INTERNAL", "Unable to save analytics preference. Try again.");
      }
    }),

  capture: protectedProcedure
    .use(validateInput(captureInput))
    .input(captureInput)
    .output(analyticsCaptureResultSchema)
    .handler(async ({ context, input }) => {
      const userId = requireProfileOwner(context.session);
      try {
        const accepted = context.analytics
          ? await context.analytics.capture(userId, input.event)
          : false;
        return { accepted };
      } catch {
        return { accepted: false };
      }
    }),
};
