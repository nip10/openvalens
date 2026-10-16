import {
  SESSION_RPE_CITATION,
  WHO_GUIDELINE_CITATION,
  WHO_GUIDELINE_URL,
  type ActivityIntensityOption,
  type ActivityLoadResult,
  type ActivityLoadWithheldReason,
  type EffortComparison,
  type EffortComparisonBandOption,
  type WeeklyActivityLoadView,
} from "../activity-load-contract";

/**
 * Issue #99 — copy and view models for weekly activity (WHO active minutes)
 * and activity load (session effort points), shared by web and native so both
 * show the same numbers, formulas, units, coverage and unavailable states.
 * Pure (type-only imports plus constants from the app-safe contract).
 *
 * Copy rules (CONTRIBUTING.md → health data rules, and the #99 wording table):
 * describe what was recorded and calculated; no outcome or longevity claims,
 * no injury/overtraining/recovery framing, no proprietary strain or PAI
 * scales. Checked by `activity-load.test.ts`.
 */

export const ACTIVITY_LOAD_COPY = {
  title: "Weekly activity",
  intro:
    "Two separate numbers for the last 7 days, each with its formula. They are not combined into one score.",
  activeMinutesTitle: "Active minutes",
  activeMinutesUnit: "min",
  activeMinutesFormula:
    "Moderate minutes + 2 × vigorous minutes from your sessions in the last 7 days. Light sessions are recorded but not counted.",
  whoGuideline:
    "WHO guideline for adults: 150–300 minutes of moderate activity a week, or 75–150 minutes of vigorous activity, or a mix of both (vigorous minutes count double).",
  whoEvidence:
    "The range comes from large observational studies, where more weekly activity was associated with lower mortality. It is a population guideline, not a personal target or an assessment of you.",
  whoCitation: WHO_GUIDELINE_CITATION,
  whoUrl: WHO_GUIDELINE_URL,
  intensityMethod:
    "Intensity is the level you recorded for each session (talk test). Wearable workouts have no intensity in OpenValens yet, so their minutes are listed but not counted.",
  effortTitle: "Effort points",
  effortUnit: "points",
  effortFormula:
    "Each session's effort rating (0–10) × its minutes, added up over the last 7 days (session-RPE).",
  effortCitation: SESSION_RPE_CITATION,
  effortMissing: "Sessions without a rating are left out, not estimated.",
  comparisonTitle: "Compared with your recent weeks",
  comparisonLimits:
    "This describes your own logs only. It is not a judgement about your body or how to train.",
  contextTitle: "Also recorded",
  contextNote: "Shown for context only. Steps and strength volume are never converted into points.",
  heartRateNote: "Heart-rate based load is not calculated in this version.",
  noStorage: "Calculated fresh from your records each time; nothing is stored.",
  docsPath: "docs/activity-load.md",
} as const;

export const ACTIVITY_LOAD_WITHHELD_EXPLANATIONS: Record<ActivityLoadWithheldReason, string> = {
  adults_only: "Weekly activity is for adults 18 and over, based on your profile answer.",
};

// ─── session capture (forms) ───────────────────────────────────

export const INTENSITY_LABELS: Record<ActivityIntensityOption, string> = {
  light: "Light",
  moderate: "Moderate",
  vigorous: "Vigorous",
};

/** Talk-test descriptions shown next to each intensity choice. */
export const INTENSITY_DESCRIPTIONS: Record<ActivityIntensityOption, string> = {
  light: "You can talk and sing",
  moderate: "You can talk, but not sing",
  vigorous: "You can only say a few words without pausing for breath",
};

/** CR-10 anchors used for session-RPE (Foster et al., 2001); unanchored steps show the number only. */
const EFFORT_ANCHORS: Record<number, string> = {
  0: "Rest",
  1: "Very, very easy",
  2: "Easy",
  3: "Moderate",
  4: "Somewhat hard",
  5: "Hard",
  7: "Very hard",
  10: "Maximal",
};

export const EFFORT_RATING_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export const EFFORT_QUESTION = "How hard was the whole session? (0–10)";

/** "7 · Very hard" / "6". */
export function effortRatingLabel(rating: number): string {
  const anchor = EFFORT_ANCHORS[rating];
  return anchor ? `${rating} · ${anchor}` : `${rating}`;
}

export type SessionEffortLike = {
  date: string;
  duration: number | null;
  intensity: ActivityIntensityOption | null;
  effortRating: number | null;
};

/** "Moderate · effort 7/10 · 315 points" / "No intensity · effort not rated". */
export function sessionEffortText(session: SessionEffortLike): string {
  const intensity = session.intensity ? INTENSITY_LABELS[session.intensity] : "No intensity";
  if (session.effortRating === null) return `${intensity} · effort not rated`;
  const points =
    session.duration !== null && session.duration > 0
      ? ` · ${thousands(session.effortRating * session.duration)} points`
      : " · no duration, no points";
  return `${intensity} · effort ${session.effortRating}/10${points}`;
}

/**
 * The rating can be added later the same day. The server accepts a window
 * wide enough for any time zone; the apps offer it on the session's own day.
 */
export function canRateEffortToday(sessionDate: string, today: string): boolean {
  return sessionDate === today;
}

// ─── weekly view ───────────────────────────────────────────────

function thousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Mon 12 Oct" for a YYYY-MM-DD calendar date (no time zone shift). */
export function formatDay(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime())) return date;
  return `${DAY_NAMES[value.getUTCDay()]} ${value.getUTCDate()} ${MONTH_NAMES[value.getUTCMonth()]}`;
}

export type ActivityNumberView = {
  key: "active_minutes" | "effort_points";
  title: string;
  available: boolean;
  valueText: string;
  unitText: string;
  /** Plain-language status line (range position, or why there is no number). */
  statusText: string;
  breakdown: string[];
  coverage: string[];
  formula: string;
  sources: string[];
  accessibilityLabel: string;
};

export type EffortDayRowView = {
  date: string;
  label: string;
  valueText: string;
  accessibilityLabel: string;
};

export type ComparisonView = {
  title: string;
  available: boolean;
  text: string;
  detail: string | null;
  limits: string;
  accessibilityLabel: string;
};

export type ActivityLoadView = {
  title: string;
  intro: string;
  available: boolean;
  withheldExplanation: string | null;
  windowText: string;
  activeMinutes: ActivityNumberView | null;
  effort: ActivityNumberView | null;
  effortDays: EffortDayRowView[];
  comparison: ComparisonView | null;
  context: string[];
  notes: string[];
  versionText: string;
};

const WHO_POSITION_TEXT = {
  below_range: "Below the WHO range of 150–300 minutes a week.",
  within_range: "Within the WHO range of 150–300 minutes a week.",
  above_range: "Above the top of the WHO range (300 minutes a week).",
} as const;

function activeMinutesView(load: WeeklyActivityLoadView): ActivityNumberView {
  const part = load.activeMinutes;
  const available = part.status === "available" && part.activeMinutes !== null;
  const statusText = available
    ? WHO_POSITION_TEXT[part.whoPosition!]
    : part.status === "no_sessions"
      ? "No sessions recorded in the last 7 days, so there is no number (not zero)."
      : "None of the last 7 days' sessions has an intensity and a duration, so there is no number.";
  const coverage: string[] = [];
  const c = part.coverage;
  if (c.sessions > 0)
    coverage.push(
      `${c.sessionsWithIntensity} of ${plural(c.sessions, "session")} ${c.sessions === 1 ? "has" : "have"} an intensity.`,
    );
  if (c.minutesMissingIntensity > 0)
    coverage.push(
      `${thousands(c.minutesMissingIntensity)} min without an intensity are not counted.`,
    );
  if (c.sessionsMissingDuration > 0)
    coverage.push(`${plural(c.sessionsMissingDuration, "session")} without a duration.`);
  const value = available ? thousands(part.activeMinutes!) : "—";
  return {
    key: "active_minutes",
    title: ACTIVITY_LOAD_COPY.activeMinutesTitle,
    available,
    valueText: value,
    unitText: ACTIVITY_LOAD_COPY.activeMinutesUnit,
    statusText,
    breakdown: [
      `Moderate: ${thousands(part.moderateMinutes)} min`,
      `Vigorous: ${thousands(part.vigorousMinutes)} min (counts double)`,
      `Light: ${thousands(part.lightMinutes)} min (not counted)`,
    ],
    coverage,
    formula: ACTIVITY_LOAD_COPY.activeMinutesFormula,
    sources: [
      ACTIVITY_LOAD_COPY.whoGuideline,
      ACTIVITY_LOAD_COPY.whoEvidence,
      ACTIVITY_LOAD_COPY.intensityMethod,
      `Source: ${ACTIVITY_LOAD_COPY.whoCitation}`,
    ],
    accessibilityLabel: available
      ? `Active minutes, last 7 days: ${value} minutes. ${statusText}`
      : `Active minutes not available. ${statusText}`,
  };
}

function effortView(load: WeeklyActivityLoadView): ActivityNumberView {
  const part = load.effort;
  const available = part.status === "available" && part.points !== null;
  const c = part.coverage;
  const statusText = available
    ? `From ${plural(c.ratedSessions - c.ratedMissingDuration, "rated session")}.`
    : part.status === "no_sessions"
      ? "No sessions recorded in the last 7 days, so there is no number (not zero)."
      : "No session in the last 7 days has an effort rating and a duration, so there is no number.";
  const coverage: string[] = [];
  if (c.sessions > 0)
    coverage.push(`${c.ratedSessions} of ${plural(c.sessions, "session")} rated.`);
  if (c.unratedSessions > 0) coverage.push(ACTIVITY_LOAD_COPY.effortMissing);
  if (c.ratedMissingDuration > 0)
    coverage.push(`${plural(c.ratedMissingDuration, "rated session")} without a duration.`);
  const value = available ? thousands(part.points!) : "—";
  return {
    key: "effort_points",
    title: ACTIVITY_LOAD_COPY.effortTitle,
    available,
    valueText: value,
    unitText: ACTIVITY_LOAD_COPY.effortUnit,
    statusText,
    breakdown: [],
    coverage,
    formula: ACTIVITY_LOAD_COPY.effortFormula,
    sources: [`Source: ${ACTIVITY_LOAD_COPY.effortCitation}`],
    accessibilityLabel: available
      ? `Effort points, last 7 days: ${value} points. ${statusText}`
      : `Effort points not available. ${statusText}`,
  };
}

const BAND_TEXT: Record<EffortComparisonBandOption, string> = {
  well_above: "This week's effort points are well above your average for the previous weeks.",
  similar: "This week's effort points are similar to your average for the previous weeks.",
  well_below: "This week's effort points are well below your average for the previous weeks.",
};

function comparisonView(comparison: EffortComparison): ComparisonView {
  let text: string;
  let detail: string | null = null;
  if (comparison.status === "available") {
    text = BAND_TEXT[comparison.band!];
    detail = `This week: ${thousands(comparison.currentPoints!)} points. Average of ${plural(comparison.baselineWindows, "previous week")} with rated sessions: ${thousands(comparison.baselineAverage!)} points (this week not included). ${comparison.baselineWindows} of ${comparison.baselineWindowsConsidered} earlier weeks logged.`;
  } else if (comparison.status === "no_current_effort") {
    text = "No rated sessions this week, so there is nothing to compare.";
  } else if (comparison.status === "history_segmented") {
    text = `Where your effort ratings come from changed (for example a new device), so earlier weeks are not compared. Shown once ${comparison.baselineMinWindows} earlier weeks with the same source exist (found ${comparison.baselineWindows}).`;
  } else {
    text = `Shown once at least ${comparison.baselineMinWindows} of the previous ${comparison.baselineWindowsConsidered} weeks have rated sessions (found ${comparison.baselineWindows}).`;
  }
  return {
    title: ACTIVITY_LOAD_COPY.comparisonTitle,
    available: comparison.status === "available",
    text,
    detail,
    limits: ACTIVITY_LOAD_COPY.comparisonLimits,
    accessibilityLabel: `${ACTIVITY_LOAD_COPY.comparisonTitle}: ${text}${detail ? ` ${detail}` : ""}`,
  };
}

function contextLines(load: WeeklyActivityLoadView): string[] {
  const c = load.context;
  return [
    c.steps === null
      ? "Steps: none recorded in the last 7 days."
      : `Steps: ${thousands(c.steps)} over ${plural(c.stepDays, "day")} with step data.`,
    c.strengthVolumeKg === null
      ? "Strength volume: no weighted sets recorded."
      : `Strength volume: ${thousands(c.strengthVolumeKg)} kg (reps × weight) across ${plural(c.strengthSessions, "session")}.`,
  ];
}

export function activityLoadView(result: ActivityLoadResult): ActivityLoadView {
  const base = {
    title: ACTIVITY_LOAD_COPY.title,
    intro: ACTIVITY_LOAD_COPY.intro,
    notes: [ACTIVITY_LOAD_COPY.heartRateNote, ACTIVITY_LOAD_COPY.noStorage],
  };
  const load = result.load;
  if (result.status !== "available" || load === null) {
    return {
      ...base,
      available: false,
      withheldExplanation: result.withheldReason
        ? ACTIVITY_LOAD_WITHHELD_EXPLANATIONS[result.withheldReason]
        : null,
      windowText: "",
      activeMinutes: null,
      effort: null,
      effortDays: [],
      comparison: null,
      context: [],
      versionText: "",
    };
  }
  return {
    ...base,
    available: true,
    withheldExplanation: null,
    windowText: `Last 7 days: ${formatDay(load.window.start)} – ${formatDay(load.window.end)}`,
    activeMinutes: activeMinutesView(load),
    effort: effortView(load),
    effortDays: load.effort.days.map((day) => {
      const label = formatDay(day.date);
      const valueText =
        day.points !== null
          ? `${thousands(day.points)} points`
          : day.unratedSessions > 0
            ? "not rated"
            : "—";
      const unrated =
        day.points !== null && day.unratedSessions > 0
          ? ` (+${plural(day.unratedSessions, "unrated session")})`
          : "";
      return {
        date: day.date,
        label,
        valueText: `${valueText}${unrated}`,
        accessibilityLabel: `${label}: ${day.points !== null ? `${thousands(day.points)} effort points` : day.unratedSessions > 0 ? "sessions not rated" : "no rated sessions"}${unrated}.`,
      };
    }),
    comparison: comparisonView(load.comparison),
    context: [...contextLines(load), ACTIVITY_LOAD_COPY.contextNote],
    versionText: `Method ${load.algorithmVersion}, as of ${load.asOf}. Details: ${ACTIVITY_LOAD_COPY.docsPath}.`,
  };
}
