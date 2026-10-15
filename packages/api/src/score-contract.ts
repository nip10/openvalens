import { z } from "zod";

/**
 * Issue #95 — the two "how am I doing?" numbers: an experimental readiness
 * index and a goal-progress score. Wire contract only (pure: no DB, no
 * domain packages) so web and native import it safely.
 *
 * The two numbers are never blended. Each carries its algorithm version, the
 * inputs it used, how much of its inputs were available, and — when it is
 * withheld — why and what would help. Missing data is reported as missing,
 * never as zero or a default. Algorithm details: `docs/score-algorithm.md`.
 */

export const READINESS_ALGORITHM_VERSION = "readiness-0.1.0-experimental";
export const GOAL_PROGRESS_ALGORITHM_VERSION = "goal-progress-0.1.0";

// ─── readiness ─────────────────────────────────────────────────

/** Every input readiness knows about, including ones not supported yet. */
export const READINESS_INPUTS = [
  "sleep",
  "resting_heart_rate",
  "activity_load",
  "hrv",
  "check_in",
] as const;
export type ReadinessInput = (typeof READINESS_INPUTS)[number];

/**
 * Scoring profiles. Each has its own required inputs; scores from different
 * profiles are not equivalent, so the active profile is always returned.
 */
export const READINESS_PROFILES = ["physiology_enhanced", "manual_friendly"] as const;
export type ReadinessProfile = (typeof READINESS_PROFILES)[number];

export const READINESS_PROFILE_INPUTS: Record<
  ReadinessProfile,
  { required: readonly ReadinessInput[]; optional: readonly ReadinessInput[] }
> = {
  physiology_enhanced: { required: ["sleep", "resting_heart_rate"], optional: ["activity_load"] },
  manual_friendly: { required: ["sleep", "activity_load"], optional: [] },
};

/**
 * Per-input state:
 * - `used`                  — contributed to the score.
 * - `ready_not_used`        — usable, but not part of the active profile.
 * - `no_recent_value`       — nothing recorded in the recent window.
 * - `insufficient_baseline` — too few earlier days to know your usual.
 * - `not_supported_yet`     — OpenValens does not record this input yet.
 */
export const READINESS_INPUT_STATES = [
  "used",
  "ready_not_used",
  "no_recent_value",
  "insufficient_baseline",
  "not_supported_yet",
] as const;
export type ReadinessInputState = (typeof READINESS_INPUT_STATES)[number];

export const READINESS_UNITS = ["minutes", "bpm", "steps_per_day"] as const;
export type ReadinessUnit = (typeof READINESS_UNITS)[number];

export const readinessComponentSchema = z.object({
  input: z.enum(READINESS_INPUTS),
  state: z.enum(READINESS_INPUT_STATES),
  unit: z.enum(READINESS_UNITS).nullable(),
  /** Value in the recent window (a night, a day, or a several-day average). */
  recentValue: z.number().nullable(),
  /** Last date the recent value covers (YYYY-MM-DD). */
  recentDate: z.string().nullable(),
  /** Days with data in the recent window. */
  recentDays: z.number().int(),
  /** Median of the personal baseline window. */
  baselineValue: z.number().nullable(),
  /** Days with data in the baseline window. */
  baselineDays: z.number().int(),
  /** Days the baseline window spans. */
  baselineWindowDays: z.number().int(),
  /** Minimum days with data the baseline needs. */
  baselineMinDays: z.number().int(),
  /** (recent − baseline) / baseline. */
  relativeDifference: z.number().nullable(),
  /** 0–100 where 50 means "in line with your usual". */
  componentScore: z.number().nullable(),
});
export type ReadinessComponent = z.infer<typeof readinessComponentSchema>;

export const READINESS_WITHHELD_REASONS = ["insufficient_inputs", "adults_only"] as const;
export type ReadinessWithheldReason = (typeof READINESS_WITHHELD_REASONS)[number];

export const readinessResultSchema = z.object({
  kind: z.literal("readiness"),
  experimental: z.literal(true),
  algorithmVersion: z.string(),
  asOf: z.string(),
  status: z.enum(["available", "withheld"]),
  /** 0–100, null whenever withheld. Never a default. */
  score: z.number().nullable(),
  profile: z.enum(READINESS_PROFILES).nullable(),
  withheldReason: z.enum(READINESS_WITHHELD_REASONS).nullable(),
  components: z.array(readinessComponentSchema),
  coverage: z.object({
    /** Inputs the active profile could use (required + optional). */
    profileInputs: z.array(z.enum(READINESS_INPUTS)),
    usedInputs: z.array(z.enum(READINESS_INPUTS)),
  }),
  /** Inputs that would let a score appear, or add coverage to it. */
  wouldHelp: z.array(z.enum(READINESS_INPUTS)),
});
export type ReadinessResult = z.infer<typeof readinessResultSchema>;

// ─── goal progress ─────────────────────────────────────────────

/**
 * Per-goal state:
 * - `scored`               — counted in the total.
 * - `paused`               — paused by you; excluded, not a failure.
 * - `not_applicable`       — cancelled; excluded.
 * - `needs_target`         — no numeric target.
 * - `needs_current_value`  — no numeric current value.
 * - `needs_direction`      — not known whether up or down is progress.
 * - `needs_baseline`       — a decrease goal with no starting point yet.
 */
export const GOAL_RESULT_STATES = [
  "scored",
  "paused",
  "not_applicable",
  "needs_target",
  "needs_current_value",
  "needs_direction",
  "needs_baseline",
] as const;
export type GoalResultState = (typeof GOAL_RESULT_STATES)[number];

/** Weight each priority contributes. Unset priority counts as `normal`. */
export const GOAL_PRIORITY_WEIGHTS = { low: 1, normal: 2, high: 3 } as const;

export const goalResultSchema = z.object({
  goalId: z.number().int(),
  title: z.string(),
  category: z.string(),
  goalStatus: z.string(),
  state: z.enum(GOAL_RESULT_STATES),
  direction: z.enum(["increase", "decrease"]).nullable(),
  directionSource: z.enum(["set", "inferred"]).nullable(),
  baselineValue: z.number().nullable(),
  baselineSource: z.enum(["set", "first_check_in", "assumed_zero"]).nullable(),
  currentValue: z.number().nullable(),
  targetValue: z.number().nullable(),
  /** 0–1, capped at 1 once the target is reached. */
  progress: z.number().nullable(),
  reachedTarget: z.boolean(),
  priority: z.enum(["low", "normal", "high"]),
  prioritySource: z.enum(["set", "default"]),
  /** Share of the total this goal carries (0–1), null when not scored. */
  contribution: z.number().nullable(),
  trend: z.enum(["toward_target", "away_from_target", "unchanged"]).nullable(),
  /** True when the latest check-in moved away from the target. */
  flagged: z.boolean(),
});
export type GoalResult = z.infer<typeof goalResultSchema>;

export const GOAL_PROGRESS_WITHHELD_REASONS = [
  "no_goals",
  "no_measurable_goals",
  "adults_only",
] as const;
export type GoalProgressWithheldReason = (typeof GOAL_PROGRESS_WITHHELD_REASONS)[number];

export const goalProgressResultSchema = z.object({
  kind: z.literal("goal_progress"),
  algorithmVersion: z.string(),
  status: z.enum(["available", "withheld"]),
  /** 0–100 weighted by your priorities; null whenever withheld. */
  score: z.number().nullable(),
  withheldReason: z.enum(GOAL_PROGRESS_WITHHELD_REASONS).nullable(),
  goals: z.array(goalResultSchema),
  coverage: z.object({
    scored: z.number().int(),
    total: z.number().int(),
    flagged: z.number().int(),
  }),
});
export type GoalProgressResult = z.infer<typeof goalProgressResultSchema>;

export const scoreInputSchema = z.strictObject({});
