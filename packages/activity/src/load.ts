/**
 * Issue #99 — weekly activity and activity load. Pure and deterministic (no
 * DB, no clock): the caller passes the sessions and the `asOf` date.
 *
 * Two separate, named numbers — never blended into one "strain" score:
 *
 * - **Active minutes** — moderate minutes + 2 × vigorous minutes over the
 *   last 7 days, shown against the WHO 2020 adult range of 150–300 minutes a
 *   week (Bull et al., 2020, doi:10.1136/bjsports-2020-102955).
 * - **Effort points** — session-RPE (Foster et al., 2001): the 0–10 effort
 *   rating × session minutes, summed per day and over the last 7 days.
 *
 * A comparison of effort points with the person's own previous four weeks is
 * descriptive only (no ratio zones, no injury or overtraining framing) and is
 * withheld until enough weeks were logged. Steps and strength volume are
 * returned as separate context and never converted into points.
 *
 * Missing data stays missing: a session without an intensity, a duration or
 * a rating is counted in the coverage, never treated as zero. Every constant
 * here is documented in `docs/activity-load.md`; changing one bumps
 * `ACTIVITY_LOAD_ALGORITHM_VERSION`.
 */

export const ACTIVITY_LOAD_ALGORITHM_VERSION = "activity-load-0.1.0";

/** Days in one window ("this week" is the last 7 days including today). */
export const ACTIVITY_WINDOW_DAYS = 7;
/** Previous 7-day windows the effort comparison looks back over. */
export const EFFORT_BASELINE_WINDOWS = 4;
/** Logged windows the baseline needs before a comparison is shown (product choice). */
export const EFFORT_BASELINE_MIN_WINDOWS = 3;
/** Ratio to the baseline average at or above which effort is "well above" (product choice). */
export const EFFORT_WELL_ABOVE_RATIO = 1.5;
/** Ratio to the baseline average at or below which effort is "well below" (product choice). */
export const EFFORT_WELL_BELOW_RATIO = 1 / 1.5;

/** WHO 2020 adult guideline range, moderate-equivalent minutes per week. */
export const WHO_ACTIVE_MINUTES_RANGE = { lower: 150, upper: 300 } as const;
/** WHO 2020: vigorous minutes count double toward the moderate-equivalent total. */
export const WHO_VIGOROUS_MULTIPLIER = 2;
export const WHO_GUIDELINE_CITATION =
  "Bull FC, et al. World Health Organization 2020 guidelines on physical activity and sedentary behaviour. Br J Sports Med. 2020;54:1451–1462. doi:10.1136/bjsports-2020-102955";

export type ActivityIntensity = "light" | "moderate" | "vigorous";

/** How the session's intensity was classified (named in-app). */
export type IntensityMethod = "self_reported_talk_test" | "none";

/**
 * One activity session. Manual sessions come from `workout`; device sessions
 * from wearable `health_event` workouts (which carry no intensity yet).
 */
export type ActivitySession = {
  /** Stable reference, e.g. `workout:12` or `health_event:40`. */
  ref: string;
  /** Calendar date (YYYY-MM-DD). */
  date: string;
  /** `manual`, or `device:<data source id>` — a change segments the effort history. */
  source: string;
  durationMinutes: number | null;
  intensity: ActivityIntensity | null;
  intensityMethod: IntensityMethod;
  /** 0–10 CR-10 session rating; null when not rated. */
  effortRating: number | null;
  /** Σ reps × kg over weighted sets; null when the session has none. */
  strengthVolumeKg: number | null;
};

export type DailyStepsValue = { date: string; steps: number | null };

// ─── result types ──────────────────────────────────────────────

export type ActiveMinutesStatus = "available" | "no_sessions" | "no_intensity";
export type WhoRangePosition = "below_range" | "within_range" | "above_range";

export type ActiveMinutesResult = {
  status: ActiveMinutesStatus;
  /** moderate + 2 × vigorous; null unless available. */
  activeMinutes: number | null;
  moderateMinutes: number;
  vigorousMinutes: number;
  /** Recorded but not counted toward the WHO range. */
  lightMinutes: number;
  whoRange: { lower: number; upper: number };
  whoPosition: WhoRangePosition | null;
  coverage: {
    sessions: number;
    sessionsWithIntensity: number;
    sessionsMissingIntensity: number;
    /** Minutes of sessions with a duration but no intensity (not counted). */
    minutesMissingIntensity: number;
    sessionsMissingDuration: number;
    intensityMethods: IntensityMethod[];
  };
};

export type EffortStatus = "available" | "no_sessions" | "no_ratings";

export type EffortDay = {
  date: string;
  /** null when the day has no rated session with a duration. */
  points: number | null;
  ratedSessions: number;
  unratedSessions: number;
};

export type EffortResult = {
  status: EffortStatus;
  /** Σ rating × minutes over rated sessions; null unless available. */
  points: number | null;
  days: EffortDay[];
  coverage: {
    sessions: number;
    ratedSessions: number;
    unratedSessions: number;
    /** Rated, but no duration — cannot contribute points. */
    ratedMissingDuration: number;
  };
};

export type EffortComparisonStatus =
  | "available"
  | "no_current_effort"
  | "insufficient_history"
  | "history_segmented";
export type EffortComparisonBand = "well_above" | "similar" | "well_below";

export type EffortComparisonResult = {
  status: EffortComparisonStatus;
  band: EffortComparisonBand | null;
  currentPoints: number | null;
  /** Average of the logged baseline windows; never includes the current window. */
  baselineAverage: number | null;
  /** (current − baseline) / baseline. */
  relativeDifference: number | null;
  /** Logged windows in the baseline (after any segment break). */
  baselineWindows: number;
  /** Windows looked back over. */
  baselineWindowsConsidered: number;
  baselineMinWindows: number;
  /** End date of the newest earlier window whose sources differ (history before it is ignored). */
  segmentedBefore: string | null;
};

export type ActivityContext = {
  /** Total steps over days with step data; null when none. */
  steps: number | null;
  stepDays: number;
  /** Σ reps × kg over the window; null when no weighted sets. */
  strengthVolumeKg: number | null;
  strengthSessions: number;
};

export type WeeklyActivityLoad = {
  algorithmVersion: string;
  asOf: string;
  window: { start: string; end: string; days: number };
  activeMinutes: ActiveMinutesResult;
  effort: EffortResult;
  comparison: EffortComparisonResult;
  context: ActivityContext;
};

// ─── helpers ───────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive date range of window `index` (0 = the 7 days ending `asOf`). */
export function activityWindow(asOf: string, index: number): { start: string; end: string } {
  const end = shiftDate(asOf, -index * ACTIVITY_WINDOW_DAYS);
  return { start: shiftDate(end, -(ACTIVITY_WINDOW_DAYS - 1)), end };
}

function inWindow(date: string, window: { start: string; end: string }): boolean {
  return date >= window.start && date <= window.end;
}

function validMinutes(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function validRating(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 10;
}

/** Rating × minutes for one session; null when either is missing. */
export function sessionEffortPoints(
  session: Pick<ActivitySession, "durationMinutes" | "effortRating">,
): number | null {
  if (!validRating(session.effortRating) || !validMinutes(session.durationMinutes)) return null;
  return session.effortRating * session.durationMinutes;
}

function effortSources(sessions: readonly ActivitySession[]): string {
  const sources = new Set<string>();
  for (const session of sessions)
    if (sessionEffortPoints(session) !== null) sources.add(session.source);
  return [...sources].sort().join("|");
}

function windowEffort(sessions: readonly ActivitySession[]): number | null {
  let total: number | null = null;
  for (const session of sessions) {
    const points = sessionEffortPoints(session);
    if (points !== null) total = (total ?? 0) + points;
  }
  return total;
}

// ─── the three parts ───────────────────────────────────────────

export function computeActiveMinutes(sessions: readonly ActivitySession[]): ActiveMinutesResult {
  let moderate = 0;
  let vigorous = 0;
  let light = 0;
  let withIntensity = 0;
  let minutesMissingIntensity = 0;
  let missingDuration = 0;
  const methods = new Set<IntensityMethod>();
  for (const session of sessions) {
    const hasMinutes = validMinutes(session.durationMinutes);
    if (!hasMinutes) missingDuration += 1;
    if (session.intensity === null) {
      if (hasMinutes) minutesMissingIntensity += session.durationMinutes!;
      continue;
    }
    withIntensity += 1;
    methods.add(session.intensityMethod);
    if (!hasMinutes) continue;
    if (session.intensity === "moderate") moderate += session.durationMinutes!;
    else if (session.intensity === "vigorous") vigorous += session.durationMinutes!;
    else light += session.durationMinutes!;
  }
  const status: ActiveMinutesStatus =
    sessions.length === 0
      ? "no_sessions"
      : withIntensity === 0 || moderate + vigorous + light === 0
        ? "no_intensity"
        : "available";
  const active = status === "available" ? moderate + WHO_VIGOROUS_MULTIPLIER * vigorous : null;
  return {
    status,
    activeMinutes: active,
    moderateMinutes: moderate,
    vigorousMinutes: vigorous,
    lightMinutes: light,
    whoRange: { ...WHO_ACTIVE_MINUTES_RANGE },
    whoPosition:
      active === null
        ? null
        : active < WHO_ACTIVE_MINUTES_RANGE.lower
          ? "below_range"
          : active > WHO_ACTIVE_MINUTES_RANGE.upper
            ? "above_range"
            : "within_range",
    coverage: {
      sessions: sessions.length,
      sessionsWithIntensity: withIntensity,
      sessionsMissingIntensity: sessions.length - withIntensity,
      minutesMissingIntensity,
      sessionsMissingDuration: missingDuration,
      intensityMethods: [...methods].sort(),
    },
  };
}

export function computeEffort(
  sessions: readonly ActivitySession[],
  window: { start: string; end: string },
): EffortResult {
  const days: EffortDay[] = [];
  for (let i = 0; i < ACTIVITY_WINDOW_DAYS; i += 1) {
    const date = shiftDate(window.start, i);
    const daySessions = sessions.filter((session) => session.date === date);
    days.push({
      date,
      points: windowEffort(daySessions),
      ratedSessions: daySessions.filter((s) => validRating(s.effortRating)).length,
      unratedSessions: daySessions.filter((s) => !validRating(s.effortRating)).length,
    });
  }
  const rated = sessions.filter((s) => validRating(s.effortRating));
  const points = windowEffort(sessions);
  return {
    status: sessions.length === 0 ? "no_sessions" : points === null ? "no_ratings" : "available",
    points,
    days,
    coverage: {
      sessions: sessions.length,
      ratedSessions: rated.length,
      unratedSessions: sessions.length - rated.length,
      ratedMissingDuration: rated.filter((s) => !validMinutes(s.durationMinutes)).length,
    },
  };
}

/**
 * Current window's effort points vs the average of the earlier logged
 * windows. The current window is never part of the baseline. Walking back
 * from the most recent earlier window, history stops at the first logged
 * window whose rating sources differ from the current window's (a device or
 * method change), so different methods are not compared.
 */
export function compareEffort(
  sessions: readonly ActivitySession[],
  asOf: string,
): EffortComparisonResult {
  const current = sessions.filter((s) => inWindow(s.date, activityWindow(asOf, 0)));
  const currentPoints = windowEffort(current);
  const empty = {
    band: null,
    baselineAverage: null,
    relativeDifference: null,
    baselineWindowsConsidered: EFFORT_BASELINE_WINDOWS,
    baselineMinWindows: EFFORT_BASELINE_MIN_WINDOWS,
  };
  if (currentPoints === null) {
    return {
      ...empty,
      status: "no_current_effort",
      currentPoints: null,
      baselineWindows: 0,
      segmentedBefore: null,
    };
  }
  const currentSources = effortSources(current);
  const baseline: number[] = [];
  let segmentedBefore: string | null = null;
  for (let index = 1; index <= EFFORT_BASELINE_WINDOWS; index += 1) {
    const window = activityWindow(asOf, index);
    const windowSessions = sessions.filter((s) => inWindow(s.date, window));
    const points = windowEffort(windowSessions);
    if (points === null) continue; // not logged: missing, not zero
    if (effortSources(windowSessions) !== currentSources) {
      segmentedBefore = window.end;
      break;
    }
    baseline.push(points);
  }
  if (baseline.length < EFFORT_BASELINE_MIN_WINDOWS) {
    return {
      ...empty,
      status: segmentedBefore === null ? "insufficient_history" : "history_segmented",
      currentPoints,
      baselineWindows: baseline.length,
      segmentedBefore,
    };
  }
  const average = baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
  // A baseline of only 0-rated sessions averages 0: any effort is then "well above".
  const ratio = average > 0 ? currentPoints / average : null;
  return {
    status: "available",
    band:
      ratio === null
        ? currentPoints > 0
          ? "well_above"
          : "similar"
        : ratio >= EFFORT_WELL_ABOVE_RATIO
          ? "well_above"
          : ratio <= EFFORT_WELL_BELOW_RATIO
            ? "well_below"
            : "similar",
    currentPoints,
    baselineAverage: average,
    relativeDifference: ratio === null ? null : ratio - 1,
    baselineWindows: baseline.length,
    baselineWindowsConsidered: EFFORT_BASELINE_WINDOWS,
    baselineMinWindows: EFFORT_BASELINE_MIN_WINDOWS,
    segmentedBefore,
  };
}

/**
 * The whole weekly view. `sessions` may span more than the five windows the
 * calculation reads; `steps` covers at least the current window.
 */
export function computeWeeklyActivityLoad(input: {
  asOf: string;
  sessions: readonly ActivitySession[];
  steps: readonly DailyStepsValue[];
}): WeeklyActivityLoad {
  const window = activityWindow(input.asOf, 0);
  const current = input.sessions.filter((s) => inWindow(s.date, window));
  const stepDays = input.steps.filter(
    (day) => inWindow(day.date, window) && day.steps !== null && day.steps > 0,
  );
  const strength = current.filter((s) => s.strengthVolumeKg !== null && s.strengthVolumeKg > 0);
  return {
    algorithmVersion: ACTIVITY_LOAD_ALGORITHM_VERSION,
    asOf: input.asOf,
    window: { ...window, days: ACTIVITY_WINDOW_DAYS },
    activeMinutes: computeActiveMinutes(current),
    effort: computeEffort(current, window),
    comparison: compareEffort(input.sessions, input.asOf),
    context: {
      steps: stepDays.length ? stepDays.reduce((sum, day) => sum + day.steps!, 0) : null,
      stepDays: stepDays.length,
      strengthVolumeKg: strength.length
        ? strength.reduce((sum, s) => sum + s.strengthVolumeKg!, 0)
        : null,
      strengthSessions: strength.length,
    },
  };
}

/** Days of history the comparison needs (current window + baseline windows). */
export const ACTIVITY_LOAD_HISTORY_DAYS = ACTIVITY_WINDOW_DAYS * (EFFORT_BASELINE_WINDOWS + 1);
