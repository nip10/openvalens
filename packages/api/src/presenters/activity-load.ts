import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";

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
 *
 * All copy is rendered through Lingui (#67): constants are message
 * descriptors, and helpers that build a label take the caller's `i18n`.
 */

/**
 * Weekly view copy as Lingui message descriptors (#67). Citations, the WHO
 * link and the docs path are references and stay as they are.
 */
export const ACTIVITY_LOAD_COPY = {
  title: msg`Weekly activity`,
  intro: msg`Two separate numbers for the last 7 days, each with its formula. They are not combined into one score.`,
  activeMinutesTitle: msg`Active minutes`,
  activeMinutesUnit: "min",
  activeMinutesFormula: msg`Moderate minutes + 2 × vigorous minutes from your sessions in the last 7 days. Light sessions are recorded but not counted.`,
  whoGuideline: msg`WHO guideline for adults: 150–300 minutes of moderate activity a week, or 75–150 minutes of vigorous activity, or a mix of both (vigorous minutes count double).`,
  whoEvidence: msg`The range comes from large observational studies, where more weekly activity was associated with lower mortality. It is a population guideline, not a personal target or an assessment of you.`,
  whoCitation: WHO_GUIDELINE_CITATION,
  whoUrl: WHO_GUIDELINE_URL,
  intensityMethod: msg`Intensity is the level you recorded for each session (talk test). Wearable workouts have no intensity in OpenValens yet, so their minutes are listed but not counted.`,
  effortTitle: msg`Effort points`,
  effortUnit: msg({ message: "points", context: "unit", comment: "safety" }),
  effortFormula: msg`Each session's effort rating (0–10) × its minutes, added up over the last 7 days (session-RPE).`,
  effortCitation: SESSION_RPE_CITATION,
  effortMissing: msg`Sessions without a rating are left out, not estimated.`,
  comparisonTitle: msg`Compared with your recent weeks`,
  comparisonLimits: msg`This describes your own logs only. It is not a judgement about your body or how to train.`,
  contextTitle: msg`Also recorded`,
  contextNote: msg`Shown for context only. Steps and strength volume are never converted into points.`,
  heartRateNote: msg`Heart-rate based load is not calculated in this version.`,
  noStorage: msg`Calculated fresh from your records each time; nothing is stored.`,
  docsPath: "docs/activity-load.md",
} as const;

export const ACTIVITY_LOAD_WITHHELD_EXPLANATIONS: Record<
  ActivityLoadWithheldReason,
  MessageDescriptor
> = {
  adults_only: msg`Weekly activity is for adults 18 and over, based on your profile answer.`,
};

// ─── session capture (forms) ───────────────────────────────────

export const INTENSITY_LABELS: Record<ActivityIntensityOption, MessageDescriptor> = {
  light: msg({ message: "Light", context: "intensity" }),
  moderate: msg({ message: "Moderate", context: "intensity" }),
  vigorous: msg({ message: "Vigorous", context: "intensity" }),
};

/** Talk-test descriptions shown next to each intensity choice. */
export const INTENSITY_DESCRIPTIONS: Record<ActivityIntensityOption, MessageDescriptor> = {
  light: msg`You can talk and sing`,
  moderate: msg`You can talk, but not sing`,
  vigorous: msg`You can only say a few words without pausing for breath`,
};

/**
 * CR-10 anchors used for session-RPE (Foster et al., 2001), as whole labels
 * with the number; unanchored steps show the number only.
 */
const EFFORT_ANCHOR_LABELS: Record<number, MessageDescriptor> = {
  0: msg`0 · Rest`,
  1: msg`1 · Very, very easy`,
  2: msg`2 · Easy`,
  3: msg`3 · Moderate`,
  4: msg`4 · Somewhat hard`,
  5: msg`5 · Hard`,
  7: msg`7 · Very hard`,
  10: msg`10 · Maximal`,
};

export const EFFORT_RATING_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export const EFFORT_QUESTION = msg`How hard was the whole session? (0–10)`;

/** "7 · Very hard" / "6". */
export function effortRatingLabel(rating: number, i18n: I18n): string {
  const anchor = EFFORT_ANCHOR_LABELS[rating];
  return anchor ? i18n._(anchor) : `${rating}`;
}

export type SessionEffortLike = {
  date: string;
  duration: number | null;
  intensity: ActivityIntensityOption | null;
  effortRating: number | null;
};

const NO_INTENSITY = msg`No intensity`;

/** "Moderate · effort 7/10 · 315 points" / "No intensity · effort not rated". */
export function sessionEffortText(session: SessionEffortLike, i18n: I18n): string {
  const intensity = i18n._(session.intensity ? INTENSITY_LABELS[session.intensity] : NO_INTENSITY);
  const rating = session.effortRating;
  if (rating === null) return i18n._(msg`${intensity} · effort not rated`);
  if (session.duration === null || session.duration <= 0) {
    return i18n._(msg`${intensity} · effort ${rating}/10 · no duration, no points`);
  }
  const count = rating * session.duration;
  const points = thousands(count);
  return i18n._(
    msg`${intensity} · effort ${rating}/10 · ${plural(count, { one: `${points} point`, other: `${points} points` })}`,
  );
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

const WHO_POSITION_TEXT: Record<
  NonNullable<WeeklyActivityLoadView["activeMinutes"]["whoPosition"]>,
  MessageDescriptor
> = {
  below_range: msg`Below the WHO range of 150–300 minutes a week.`,
  within_range: msg`Within the WHO range of 150–300 minutes a week.`,
  above_range: msg`Above the top of the WHO range (300 minutes a week).`,
};

const NO_SESSIONS = msg`No sessions recorded in the last 7 days, so there is no number (not zero).`;

function activeMinutesView(load: WeeklyActivityLoadView, i18n: I18n): ActivityNumberView {
  const part = load.activeMinutes;
  const available = part.status === "available" && part.activeMinutes !== null;
  const statusText = i18n._(
    available
      ? WHO_POSITION_TEXT[part.whoPosition!]
      : part.status === "no_sessions"
        ? NO_SESSIONS
        : msg`None of the last 7 days' sessions has an intensity and a duration, so there is no number.`,
  );
  const coverage: string[] = [];
  const c = part.coverage;
  if (c.sessions > 0) {
    const withIntensity = c.sessionsWithIntensity;
    coverage.push(
      i18n._(
        msg`${withIntensity} of ${plural(c.sessions, { one: "# session has", other: "# sessions have" })} an intensity.`,
      ),
    );
  }
  if (c.minutesMissingIntensity > 0) {
    const minutes = thousands(c.minutesMissingIntensity);
    coverage.push(i18n._(msg`${minutes} min without an intensity are not counted.`));
  }
  if (c.sessionsMissingDuration > 0)
    coverage.push(
      i18n._(
        msg`${plural(c.sessionsMissingDuration, { one: "# session without a duration.", other: "# sessions without a duration." })}`,
      ),
    );
  const value = available ? thousands(part.activeMinutes!) : "—";
  const moderate = thousands(part.moderateMinutes);
  const vigorous = thousands(part.vigorousMinutes);
  const light = thousands(part.lightMinutes);
  const citation = ACTIVITY_LOAD_COPY.whoCitation;
  return {
    key: "active_minutes",
    title: i18n._(ACTIVITY_LOAD_COPY.activeMinutesTitle),
    available,
    valueText: value,
    unitText: ACTIVITY_LOAD_COPY.activeMinutesUnit,
    statusText,
    breakdown: [
      i18n._(msg`Moderate: ${moderate} min`),
      i18n._(msg`Vigorous: ${vigorous} min (counts double)`),
      i18n._(msg`Light: ${light} min (not counted)`),
    ],
    coverage,
    formula: i18n._(ACTIVITY_LOAD_COPY.activeMinutesFormula),
    sources: [
      i18n._(ACTIVITY_LOAD_COPY.whoGuideline),
      i18n._(ACTIVITY_LOAD_COPY.whoEvidence),
      i18n._(ACTIVITY_LOAD_COPY.intensityMethod),
      i18n._(msg`Source: ${citation}`),
    ],
    accessibilityLabel: available
      ? i18n._(msg`Active minutes, last 7 days: ${value} minutes. ${statusText}`)
      : i18n._(msg`Active minutes not available. ${statusText}`),
  };
}

function effortView(load: WeeklyActivityLoadView, i18n: I18n): ActivityNumberView {
  const part = load.effort;
  const available = part.status === "available" && part.points !== null;
  const c = part.coverage;
  const ratedWithDuration = c.ratedSessions - c.ratedMissingDuration;
  const statusText = i18n._(
    available
      ? msg`${plural(ratedWithDuration, { one: "From # rated session.", other: "From # rated sessions." })}`
      : part.status === "no_sessions"
        ? NO_SESSIONS
        : msg`No session in the last 7 days has an effort rating and a duration, so there is no number.`,
  );
  const coverage: string[] = [];
  if (c.sessions > 0) {
    const rated = c.ratedSessions;
    coverage.push(
      i18n._(
        msg`${rated} of ${plural(c.sessions, { one: "# session", other: "# sessions" })} rated.`,
      ),
    );
  }
  if (c.unratedSessions > 0) coverage.push(i18n._(ACTIVITY_LOAD_COPY.effortMissing));
  if (c.ratedMissingDuration > 0)
    coverage.push(
      i18n._(
        msg`${plural(c.ratedMissingDuration, { one: "# rated session without a duration.", other: "# rated sessions without a duration." })}`,
      ),
    );
  const value = available ? thousands(part.points!) : "—";
  const citation = ACTIVITY_LOAD_COPY.effortCitation;
  return {
    key: "effort_points",
    title: i18n._(ACTIVITY_LOAD_COPY.effortTitle),
    available,
    valueText: value,
    unitText: i18n._(ACTIVITY_LOAD_COPY.effortUnit),
    statusText,
    breakdown: [],
    coverage,
    formula: i18n._(ACTIVITY_LOAD_COPY.effortFormula),
    sources: [i18n._(msg`Source: ${citation}`)],
    accessibilityLabel: available
      ? i18n._(msg`Effort points, last 7 days: ${value} points. ${statusText}`)
      : i18n._(msg`Effort points not available. ${statusText}`),
  };
}

const BAND_TEXT: Record<EffortComparisonBandOption, MessageDescriptor> = {
  well_above: msg`This week's effort points are well above your average for the previous weeks.`,
  similar: msg`This week's effort points are similar to your average for the previous weeks.`,
  well_below: msg`This week's effort points are well below your average for the previous weeks.`,
};

function comparisonView(comparison: EffortComparison, i18n: I18n): ComparisonView {
  let text: string;
  let detail: string | null = null;
  const windows = comparison.baselineWindows;
  const considered = comparison.baselineWindowsConsidered;
  const minimum = comparison.baselineMinWindows;
  if (comparison.status === "available") {
    text = i18n._(BAND_TEXT[comparison.band!]);
    const current = thousands(comparison.currentPoints!);
    const average = thousands(comparison.baselineAverage!);
    detail = i18n._(
      msg`This week: ${current} points. Average of ${plural(windows, { one: "# previous week", other: "# previous weeks" })} with rated sessions: ${average} points (this week not included). ${windows} of ${considered} earlier weeks logged.`,
    );
  } else if (comparison.status === "no_current_effort") {
    text = i18n._(msg`No rated sessions this week, so there is nothing to compare.`);
  } else if (comparison.status === "history_segmented") {
    text = i18n._(
      msg`Where your effort ratings come from changed (for example a new device), so earlier weeks are not compared. Shown once ${minimum} earlier weeks with the same source exist (found ${windows}).`,
    );
  } else {
    text = i18n._(
      msg`Shown once at least ${minimum} of the previous ${considered} weeks have rated sessions (found ${windows}).`,
    );
  }
  const title = i18n._(ACTIVITY_LOAD_COPY.comparisonTitle);
  return {
    title,
    available: comparison.status === "available",
    text,
    detail,
    limits: i18n._(ACTIVITY_LOAD_COPY.comparisonLimits),
    accessibilityLabel: `${i18n._(msg`${title}: ${text}`)}${detail ? ` ${detail}` : ""}`,
  };
}

function contextLines(load: WeeklyActivityLoadView, i18n: I18n): string[] {
  const c = load.context;
  const steps = c.steps === null ? null : thousands(c.steps);
  const volume = c.strengthVolumeKg === null ? null : thousands(c.strengthVolumeKg);
  return [
    steps === null
      ? i18n._(msg`Steps: none recorded in the last 7 days.`)
      : i18n._(
          msg`Steps: ${steps} over ${plural(c.stepDays, { one: "# day", other: "# days" })} with step data.`,
        ),
    volume === null
      ? i18n._(msg`Strength volume: no weighted sets recorded.`)
      : i18n._(
          msg`Strength volume: ${volume} kg (reps × weight) across ${plural(c.strengthSessions, { one: "# session", other: "# sessions" })}.`,
        ),
  ];
}

function effortDayView(
  day: WeeklyActivityLoadView["effort"]["days"][number],
  i18n: I18n,
): EffortDayRowView {
  const label = formatDay(day.date);
  const unrated = day.unratedSessions;
  if (day.points === null)
    return {
      date: day.date,
      label,
      valueText: unrated > 0 ? i18n._(msg`not rated`) : "—",
      accessibilityLabel:
        unrated > 0
          ? i18n._(msg`${label}: sessions not rated.`)
          : i18n._(msg`${label}: no rated sessions.`),
    };
  const points = thousands(day.points);
  if (unrated > 0)
    return {
      date: day.date,
      label,
      valueText: i18n._(
        msg`${points} points (+${plural(unrated, { one: "# unrated session", other: "# unrated sessions" })})`,
      ),
      accessibilityLabel: i18n._(
        msg`${label}: ${points} effort points (+${plural(unrated, { one: "# unrated session", other: "# unrated sessions" })}).`,
      ),
    };
  return {
    date: day.date,
    label,
    valueText: i18n._(msg`${points} points`),
    accessibilityLabel: i18n._(msg`${label}: ${points} effort points.`),
  };
}

/** Text is rendered through `i18n` (#67), so the view follows the active language. */
export function activityLoadView(result: ActivityLoadResult, i18n: I18n): ActivityLoadView {
  const base = {
    title: i18n._(ACTIVITY_LOAD_COPY.title),
    intro: i18n._(ACTIVITY_LOAD_COPY.intro),
    notes: [i18n._(ACTIVITY_LOAD_COPY.heartRateNote), i18n._(ACTIVITY_LOAD_COPY.noStorage)],
  };
  const load = result.load;
  if (result.status !== "available" || load === null) {
    return {
      ...base,
      available: false,
      withheldExplanation: result.withheldReason
        ? i18n._(ACTIVITY_LOAD_WITHHELD_EXPLANATIONS[result.withheldReason])
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
  const start = formatDay(load.window.start);
  const end = formatDay(load.window.end);
  const version = load.algorithmVersion;
  const asOf = load.asOf;
  const docsPath = ACTIVITY_LOAD_COPY.docsPath;
  return {
    ...base,
    available: true,
    withheldExplanation: null,
    windowText: i18n._(msg`Last 7 days: ${start} – ${end}`),
    activeMinutes: activeMinutesView(load, i18n),
    effort: effortView(load, i18n),
    effortDays: load.effort.days.map((day) => effortDayView(day, i18n)),
    comparison: comparisonView(load.comparison, i18n),
    context: [...contextLines(load, i18n), i18n._(ACTIVITY_LOAD_COPY.contextNote)],
    versionText: i18n._(msg`Method ${version}, as of ${asOf}. Details: ${docsPath}.`),
  };
}
