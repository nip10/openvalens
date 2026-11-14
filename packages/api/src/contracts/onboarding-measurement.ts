import { z } from "zod";

/**
 * Issue #444 — onboarding totals for the instance admin (self-host and
 * OpenValens Cloud). Computed on demand from timestamps already in the
 * database: no tracking, no events, nothing leaves the instance.
 *
 * **Cohort.** Accounts created in the last `windowDays` days (`user.created_at`),
 * leaving out the placeholder account the baseline migration creates.
 *
 * **Entry.** Something the person typed in (or saved through a connected AI
 * app), timed by when it was saved (`created_at`), not by the time it is
 * about: a sleep logged for last night counts at the moment it was saved.
 * Device and wearable data is never an entry. The domains:
 * metrics saved without a data source (weight, blood pressure, heart rate, …),
 * plain water, food diary entries, supplement intakes, manual sleep, workouts,
 * pain, manual cycle periods and private body measurements. Only rows still
 * on record count: a deleted entry no longer counts.
 *
 * **Figures.** Each has its own denominator, the accounts old enough for the
 * question to have an answer: the 10-minute figure counts accounts created at
 * least 10 minutes ago, the 1-day figure at least a day ago, and the 7-day
 * and days 2–7 figures at least 7 days ago. "Days 2–7" is any entry saved
 * from 24 hours to 7 days after sign-up.
 *
 * **Small groups.** A figure whose denominator is below
 * {@link ONBOARDING_MIN_GROUP_SIZE} accounts is suppressed: its count and
 * share are `null`, so a handful of people cannot be told apart. The output
 * never carries an id, a name, an email or a per-person row.
 */

/** The smallest group a count or share is shown for. */
export const ONBOARDING_MIN_GROUP_SIZE = 5;

export const ONBOARDING_WINDOW_DAYS = [30, 90, 365] as const;
export type OnboardingWindowDays = (typeof ONBOARDING_WINDOW_DAYS)[number];

export const ONBOARDING_FIGURE_IDS = [
  "first_entry_10m",
  "first_entry_1d",
  "first_entry_7d",
  "active_days_2_7",
] as const;
export type OnboardingFigureId = (typeof ONBOARDING_FIGURE_IDS)[number];

export const onboardingTotalsInput = z.object({
  windowDays: z
    .union([z.literal(30), z.literal(90), z.literal(365)])
    .optional()
    .default(30),
});

const figureSchema = z.object({
  id: z.enum(ONBOARDING_FIGURE_IDS),
  /** Accounts in the cohort old enough for this figure. */
  eligible: z.number().int().nonnegative(),
  /** How many of them reached it; `null` when suppressed. */
  reached: z.number().int().nonnegative().nullable(),
  /** `reached / eligible`, 0 to 1; `null` when suppressed. */
  share: z.number().min(0).max(1).nullable(),
  suppressed: z.boolean(),
});
export type OnboardingFigure = z.infer<typeof figureSchema>;

export const onboardingTotalsOutput = z.object({
  windowDays: z.number().int(),
  /** ISO instants bounding the cohort: created after `from`, up to `to`. */
  from: z.string(),
  to: z.string(),
  minimumGroupSize: z.number().int(),
  signUps: z.number().int().nonnegative(),
  figures: z.array(figureSchema),
});
export type OnboardingTotals = z.infer<typeof onboardingTotalsOutput>;

/** The raw counts the query returns: eligible and reached for each figure. */
export type OnboardingCounts = {
  signUps: number;
} & Record<OnboardingFigureId, { eligible: number; reached: number }>;

/** Applies the small-group rule and turns counts into shares. Pure. */
export function presentOnboardingTotals(
  counts: OnboardingCounts,
  window: { windowDays: number; from: Date; to: Date },
  minimumGroupSize = ONBOARDING_MIN_GROUP_SIZE,
): OnboardingTotals {
  return {
    windowDays: window.windowDays,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    minimumGroupSize,
    signUps: counts.signUps,
    figures: ONBOARDING_FIGURE_IDS.map((id) => {
      const { eligible, reached } = counts[id];
      if (eligible < minimumGroupSize) {
        return { id, eligible, reached: null, share: null, suppressed: true };
      }
      return {
        id,
        eligible,
        reached,
        share: Math.round((reached / eligible) * 1000) / 1000,
        suppressed: false,
      };
    }),
  };
}
