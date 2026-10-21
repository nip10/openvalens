import { z } from "zod";

export const approvedAnalyticsEventSchema = z.enum([
  "preferences_opened",
  "appearance_control_used",
  "preferences_load_failed",
]);

export type ApprovedAnalyticsEvent = z.infer<typeof approvedAnalyticsEventSchema>;

export const analyticsPreferenceSchema = z.strictObject({
  enabled: z.boolean(),
  available: z.boolean(),
});

export const analyticsCaptureResultSchema = z.strictObject({ accepted: z.boolean() });

/** Narrow server-injected analytics capability; it accepts no request context. */
export type AnalyticsService = {
  getPreference(userId: string): Promise<{ enabled: boolean; available: boolean }>;
  setPreference(userId: string, enabled: boolean): Promise<{ enabled: boolean; available: boolean }>;
  capture(userId: string, event: ApprovedAnalyticsEvent): Promise<boolean>;
};
