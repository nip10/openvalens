/**
 * Cockpit — public type surface (Issue #16).
 *
 * The cockpit is a deterministic aggregator: it derives a "today" /
 * "weekly" readiness state from sanitized domain slices (latest blood
 * panel, latest workout, sleep coach context, weight trend, goal
 * progress, recent insights). It does NOT call other domains'
 * repositories directly — the cockpit package consumes sanitized inputs
 * the caller owns (mirroring the anchor `getTodayCockpitModel` shape).
 *
 * No PHI is included in the type surface. Weight values, sleep
 * durations, and clinical marker readings stay in the originating
 * domains; the cockpit only sees status enums, blocker ids, and counts.
 */

export type Readiness = "train" | "partial" | "hold";

export type Confidence = "low" | "medium" | "high";

export type FreshnessStatus = "fresh" | "aging" | "stale" | "missing";

export const COCKPIT_CANONICAL_BLOCKERS = {
  bloodDataStale: "blood_data_stale",
  workoutDataStale: "workout_data_stale",
  sleepDebt: "sleep_debt",
  sleepDataLowConfidence: "sleep_data_low_confidence",
} as const;

export type CanonicalCockpitBlockerId =
  (typeof COCKPIT_CANONICAL_BLOCKERS)[keyof typeof COCKPIT_CANONICAL_BLOCKERS];

export const COCKPIT_REASON_IDS = {
  activeBlockersPresent: "active_blockers_present",
  bloodDataStale: "blood_data_stale",
  workoutDataStale: "workout_data_stale",
  sleepDebt: "sleep_debt",
  sleepDataLowConfidence: "sleep_data_low_confidence",
} as const;

export type CockpitReasonId = (typeof COCKPIT_REASON_IDS)[keyof typeof COCKPIT_REASON_IDS];

/**
 * Anchovy-compatible blocker bag. Free-form keys (e.g. `injury`,
 * `illness`) are sorted lexicographically before they enter the
 * `blockers` array, so the engine's output is deterministic regardless
 * of caller-side insertion order.
 */
export type CockpitBlockerFlags = Record<string, boolean>;

export type CockpitSleepInput = {
  status: string;
  confidence: "low" | "medium" | "high";
  lastNightMinutes: number | null;
  sevenDayAverageMinutes: number | null;
  averageSleepDebtMinutes: number | null;
};

/**
 * Engine input. The cockpit itself is pure — callers compose
 * sanitized domain slices from the relevant packages
 * (`@openvalens/body` for weight, `@openvalens/clinical` for blood,
 * `@openvalens/sleep` for sleep coach context, `@openvalens/plans`
 * for workouts / goals, `@openvalens/coach` for insights) and hand
 * the resulting shape to the engine.
 */
export type CockpitEngineInput = {
  nowIso: string;
  lastBloodPanelIso: string | null;
  lastWorkoutIso: string | null;
  blockerFlags: CockpitBlockerFlags;
  sleep?: CockpitSleepInput;
};

export type FreshnessSnapshot = {
  status: FreshnessStatus;
  ageDays: number | null;
};

export type CockpitRationale = {
  freshness: {
    blood: FreshnessSnapshot;
    workout: FreshnessSnapshot;
  };
  sleep?: CockpitSleepInput;
  scores: {
    readiness: number;
    confidence: number;
  };
  reasons: CockpitReasonId[];
};

export type CockpitState = {
  readiness: Readiness;
  blockers: string[];
  confidence: Confidence;
  rationale: CockpitRationale;
};

/**
 * Sanitized weekly slice the report generator consumes. Mirrors the
 * anchor `WeeklySections` shape minus the per-section labels — the
 * cockpit package owns the labeling so the markdown draft stays
 * version-controlled here.
 */
export type WeeklySlices = {
  weightProgress: WeightSlice | null;
  goalsProgression: GoalsSlice | null;
  adherence: AdherenceSlice | null;
  sleepRecovery: SleepRecoverySlice | null;
  upcomingEvents: UpcomingEventsSlice | null;
  otherRelevant: string | null;
};

export type WeightSlice = {
  /** First weight reading of the window. */
  startKg: number;
  /** Last weight reading of the window. */
  endKg: number;
  /** Signed delta (end - start) in kg. */
  deltaKg: number;
  /** Number of contributing weight rows (>= 1). */
  sampleCount: number;
};

export type GoalsSlice = {
  activeGoalsCount: number;
  latestCheckinDate: string | null;
  latestCheckinSnippet: string | null;
};

export type AdherenceSlice = {
  adherence: number | null;
  energy: number | null;
  sleep: number | null;
  notesSnippet: string | null;
};

export type SleepRecoverySlice = {
  sevenDayAverageMinutes: number | null;
  averageSleepDebtMinutes: number | null;
  status: string | null;
  confidence: string | null;
};

export type UpcomingEventsSlice = {
  /** Top-N (capped) upcoming event lines. */
  items: Array<{
    title: string;
    startDate: string;
    frequency: string;
  }>;
};

export type WeeklyReport = {
  weekRange: { start: string; end: string };
  generatedAt: string;
  sections: {
    weightProgress: string;
    goalsProgression: string;
    adherence: string;
    sleepRecovery: string;
    upcomingEvents: string;
    otherRelevant: string;
  };
  meta: {
    hasPartialData: boolean;
    fallbackSections: Array<keyof WeeklySlices>;
  };
  messageDraft: string;
};

/**
 * Deterministic ISO-week window starting on Monday (UTC). Mirrors the
 * anchor `buildWeekWindow` — pure, no clock reads.
 */
export type WeekWindow = { start: string; end: string };

/**
 * A "rule" — small predicate that contributes to the cockpit state.
 * Returns a blocker id when the rule fires, otherwise `null`. Mirrors
 * the anchor `rules.ts` pattern; rules are pure functions of the
 * engine input.
 */
export type CockpitRule = (input: CockpitEngineInput) => string | null;

/**
 * Resource-action shape the API router uses for RBAC + audit.
 */
export type CockpitReviewLogInput = {
  reviewId: number;
  weekStart: string;
};
