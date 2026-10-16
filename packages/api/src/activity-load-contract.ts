import { z } from "zod";

/**
 * Issue #99 — weekly activity and activity load. Wire contract only (pure:
 * no DB, no domain packages) so web and native import it safely. The
 * calculation lives in `@openvalens/activity` (`computeWeeklyActivityLoad`);
 * formulas, constants and their sources: `docs/activity-load.md`.
 *
 * Two named numbers — active minutes (WHO) and effort points (session-RPE) —
 * are never blended into one score. Each part reports its coverage; missing
 * intensities, durations and ratings are counted as missing, never as zero.
 *
 * Downstream consumers (#95 readiness "recent load", #92 insight rules) read
 * this shape and must check `algorithmVersion` before relying on a field.
 */

export const ACTIVITY_LOAD_CONTRACT_VERSION = "activity-load-0.1.0";

/** Mirrors `@openvalens/activity` (checked by `activity-load-contract.test.ts`). */
export const WHO_GUIDELINE_CITATION =
  "Bull FC, et al. World Health Organization 2020 guidelines on physical activity and sedentary behaviour. Br J Sports Med. 2020;54:1451–1462. doi:10.1136/bjsports-2020-102955";
export const WHO_GUIDELINE_URL = "https://doi.org/10.1136/bjsports-2020-102955";
export const SESSION_RPE_CITATION =
  "Foster C, et al. A new approach to monitoring exercise training. J Strength Cond Res. 2001;15(1):109–115.";

export const ACTIVITY_INTENSITIES = ["light", "moderate", "vigorous"] as const;
export type ActivityIntensityOption = (typeof ACTIVITY_INTENSITIES)[number];

export const INTENSITY_METHODS = ["self_reported_talk_test", "none"] as const;

export const activeMinutesSchema = z.object({
  status: z.enum(["available", "no_sessions", "no_intensity"]),
  /** moderate + 2 × vigorous; null unless available. */
  activeMinutes: z.number().nullable(),
  moderateMinutes: z.number(),
  vigorousMinutes: z.number(),
  lightMinutes: z.number(),
  whoRange: z.object({ lower: z.number(), upper: z.number() }),
  whoPosition: z.enum(["below_range", "within_range", "above_range"]).nullable(),
  coverage: z.object({
    sessions: z.number().int(),
    sessionsWithIntensity: z.number().int(),
    sessionsMissingIntensity: z.number().int(),
    minutesMissingIntensity: z.number(),
    sessionsMissingDuration: z.number().int(),
    intensityMethods: z.array(z.enum(INTENSITY_METHODS)),
  }),
});
export type ActiveMinutes = z.infer<typeof activeMinutesSchema>;

export const effortDaySchema = z.object({
  date: z.string(),
  points: z.number().nullable(),
  ratedSessions: z.number().int(),
  unratedSessions: z.number().int(),
});
export type EffortDayView = z.infer<typeof effortDaySchema>;

export const effortSchema = z.object({
  status: z.enum(["available", "no_sessions", "no_ratings"]),
  /** Σ rating (0–10) × minutes; null unless available. */
  points: z.number().nullable(),
  days: z.array(effortDaySchema),
  coverage: z.object({
    sessions: z.number().int(),
    ratedSessions: z.number().int(),
    unratedSessions: z.number().int(),
    ratedMissingDuration: z.number().int(),
  }),
});
export type Effort = z.infer<typeof effortSchema>;

export const EFFORT_COMPARISON_STATUSES = [
  "available",
  "no_current_effort",
  "insufficient_history",
  "history_segmented",
] as const;
export type EffortComparisonStatusOption = (typeof EFFORT_COMPARISON_STATUSES)[number];

export const EFFORT_COMPARISON_BANDS = ["well_above", "similar", "well_below"] as const;
export type EffortComparisonBandOption = (typeof EFFORT_COMPARISON_BANDS)[number];

export const effortComparisonSchema = z.object({
  status: z.enum(EFFORT_COMPARISON_STATUSES),
  band: z.enum(EFFORT_COMPARISON_BANDS).nullable(),
  currentPoints: z.number().nullable(),
  /** Average of earlier logged weeks; the current week is never included. */
  baselineAverage: z.number().nullable(),
  relativeDifference: z.number().nullable(),
  baselineWindows: z.number().int(),
  baselineWindowsConsidered: z.number().int(),
  baselineMinWindows: z.number().int(),
  segmentedBefore: z.string().nullable(),
});
export type EffortComparison = z.infer<typeof effortComparisonSchema>;

export const weeklyActivityLoadSchema = z.object({
  algorithmVersion: z.string(),
  asOf: z.string(),
  window: z.object({ start: z.string(), end: z.string(), days: z.number().int() }),
  activeMinutes: activeMinutesSchema,
  effort: effortSchema,
  comparison: effortComparisonSchema,
  context: z.object({
    steps: z.number().nullable(),
    stepDays: z.number().int(),
    strengthVolumeKg: z.number().nullable(),
    strengthSessions: z.number().int(),
  }),
});
export type WeeklyActivityLoadView = z.infer<typeof weeklyActivityLoadSchema>;

export const ACTIVITY_LOAD_WITHHELD_REASONS = ["adults_only"] as const;
export type ActivityLoadWithheldReason = (typeof ACTIVITY_LOAD_WITHHELD_REASONS)[number];

export const activityLoadResultSchema = z.object({
  kind: z.literal("activity_load"),
  status: z.enum(["available", "withheld"]),
  withheldReason: z.enum(ACTIVITY_LOAD_WITHHELD_REASONS).nullable(),
  /** null whenever withheld. */
  load: weeklyActivityLoadSchema.nullable(),
});
export type ActivityLoadResult = z.infer<typeof activityLoadResultSchema>;

export const activityLoadInputSchema = z.strictObject({});
