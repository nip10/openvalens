/**
 * Timeline presentation shared by web and mobile, so both render the same
 * groups, labels and tones. Pure TypeScript: safe for the app bundle. Copy
 * follows docs/mobile/tone-of-voice.md (sentence case, ISO dates, 24-hour
 * times). Labels are Lingui message descriptors (#67).
 */
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { WearableProviderId } from "@openvalens/wearables";

import { AI_APP_SOURCE_LABEL } from "./ai-apps";
import { MANUAL_ENTRY_FIELDS } from "./manual-entry";
import { HIDDEN_VALUE } from "./nutrition-targets";
import { painEntrySummary, painRegionText } from "./pain";
import { formatWaterAmount } from "./plain-water";
import { formatSleepDuration } from "./sleep";
import { formatTrackerValue } from "./trackers";
import { workoutExerciseCountLabel, workoutTypeLabel } from "./workouts";

export type TimelineItemLike = {
  id: string;
  at: string;
  /** `metric` for a sample, `event` for everything else. */
  kind?: string;
  domain: string;
  title: string;
  summary: string;
  severity: string;
  sourceRefs: { type: string; label: string; provider?: string }[];
  /** Structured fields the server keeps next to its English title. */
  canonical?: Record<string, unknown>;
};

export type TimelineDayGroup<T extends TimelineItemLike> = {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  items: (T & { time: string })[];
};

const DOMAIN_LABELS: Record<string, MessageDescriptor> = {
  sleep: msg`Sleep`,
  activity: msg`Activity`,
  body: msg`Body`,
  vitals: msg`Vitals`,
  labs: msg`Labs`,
  meds_supplements: msg`Meds and supplements`,
  calendar: msg`Calendar`,
  sync: msg`Sync`,
  imaging: msg`Imaging`,
  cardiac: msg`Cardiac`,
  custom: msg`Trackers`,
  pain: msg`Pain`,
  water: msg`Water`,
};

export function domainLabel(domain: string): MessageDescriptor {
  return DOMAIN_LABELS[domain] ?? msg`Other`;
}

/** Semantic color for a severity; `null` keeps neutral chrome (design-direction.md). */
export function severityTone(severity: string): "destructive" | "warning" | null {
  if (severity === "critical") return "destructive";
  if (severity === "warning") return "warning";
  return null;
}

/** Vendor names are brand names: they stay as they are in every language. */
const WEARABLE_NAMES: Record<WearableProviderId, string> = {
  oura: "Oura",
  whoop: "WHOOP",
  polar: "Polar",
  withings: "Withings",
  google_health: "Google Health",
};

const PLATFORM_NAMES: Record<string, string> = {
  apple_health: "Apple Health",
  health_connect: "Health Connect",
  ...WEARABLE_NAMES,
};

/**
 * The readable name of where an entry came from: "Apple Health", "Health
 * Connect", a wearable vendor, or "Manual" for a reading the user typed in.
 * A source the server cannot place keeps its stored label.
 */
export function sourceLabel(item: TimelineItemLike, i18n: I18n): string | null {
  for (const ref of item.sourceRefs) {
    // #439 (M2) — an entry a connected AI app wrote: "via Claude".
    if (ref.type === "ai_app")
      return i18n._({ ...AI_APP_SOURCE_LABEL, values: { name: ref.label } });
    if (ref.provider === "manual" || ref.type === "manual")
      return i18n._(msg({ message: "Manual", context: "data source" }));
    const name = ref.provider ? PLATFORM_NAMES[ref.provider] : undefined;
    if (name) return name;
  }
  return item.sourceRefs.find((ref) => ref.label)?.label ?? null;
}

type MetricCopy = { label: MessageDescriptor; unit?: MessageDescriptor };

/**
 * Record types the phone and wearable syncs write, keyed by canonical metric
 * code. Lab markers are not here: their names stay as stored (reference text
 * stays in English until reviewed).
 */
const METRIC_COPY: Record<string, MetricCopy> = {
  heart_rate: MANUAL_ENTRY_FIELDS.heart_rate,
  resting_heart_rate: MANUAL_ENTRY_FIELDS.resting_heart_rate,
  steps: MANUAL_ENTRY_FIELDS.steps,
  active_calories: MANUAL_ENTRY_FIELDS.active_calories,
  distance: MANUAL_ENTRY_FIELDS.distance,
  weight: MANUAL_ENTRY_FIELDS.weight,
  height: { label: msg`Height`, unit: msg({ message: "cm", comment: "Unit symbol; keep as is." }) },
  body_fat: {
    label: msg`Body fat`,
    unit: msg({ message: "%", comment: "Unit symbol; keep as is." }),
  },
  sleep_duration: {
    label: msg`Sleep duration`,
    unit: msg({ message: "min", comment: "Unit symbol for minutes; keep as is." }),
  },
  hrv_rmssd: {
    label: msg`Heart rate variability`,
    unit: msg({ message: "ms", comment: "Unit symbol; keep as is." }),
  },
  provider_score: { label: msg`Device score` },
  oxygen_saturation: {
    label: msg`Blood oxygen`,
    unit: msg({ message: "%", comment: "Unit symbol; keep as is." }),
  },
  respiratory_rate: {
    label: msg`Respiration`,
    unit: msg({ message: "breaths/min", comment: "Unit for respiratory rate." }),
  },
};

/** Units the taxonomy stores that read badly on their own. */
const SILENT_UNITS = new Set(["count", "score", "varies"]);

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function metricCopy(item: TimelineItemLike): MetricCopy | undefined {
  const code = item.kind === "metric" ? text(item.canonical?.metricCode) : null;
  return code ? METRIC_COPY[code] : undefined;
}

/** A custom tracker entry (#441), with what its value needs to read naturally. */
function trackerEntry(item: TimelineItemLike) {
  const canonical = item.canonical;
  if (canonical?.table !== "custom_tracker_entry") return null;
  const type = canonical.trackerType;
  const value = canonical.value;
  if (
    typeof value !== "number" ||
    (type !== "number" && type !== "scale" && type !== "yes_no" && type !== "duration")
  )
    return null;
  return {
    type,
    value,
    unit: text(canonical.unit),
    decimals: typeof canonical.decimals === "number" ? canonical.decimals : 0,
  } as const;
}

/** A pain entry (#442): its region, rating, type and note. */
function painEntry(item: TimelineItemLike) {
  const canonical = item.canonical;
  if (canonical?.table !== "pain_entry") return null;
  const region = text(canonical.region);
  const rating = canonical.rating;
  if (!region || typeof rating !== "number") return null;
  return { region, rating, type: text(canonical.type), note: text(canonical.note) };
}

/**
 * A plain-water entry (#493). `quantityMl` is null in hide-numbers mode: the
 * server drops the amount, and the summary reads "Hidden".
 */
function waterEntry(item: TimelineItemLike) {
  const canonical = item.canonical;
  if (canonical?.table !== "plain_water_entry") return null;
  const quantityMl = canonical.quantityMl;
  if (canonical.hidden !== false || typeof quantityMl !== "number" || !Number.isFinite(quantityMl))
    return { hidden: true, quantityMl: null } as const;
  return { hidden: false, quantityMl } as const;
}

/** A supplement intake (#493): the supplement's name as the member saved it, and the dose. */
function supplementIntake(item: TimelineItemLike) {
  const canonical = item.canonical;
  if (canonical?.table !== "supplement_intake") return null;
  return {
    name: text(canonical.supplementName),
    dose: text(canonical.dose),
    note: text(canonical.note),
  };
}

/** A logged workout session (#493): its type, length and exercises. */
function workoutSession(item: TimelineItemLike) {
  const canonical = item.canonical;
  if (canonical?.table !== "workout") return null;
  const minutes = canonical.durationMinutes;
  const exercises = canonical.exerciseCount;
  return {
    type: text(canonical.workoutType) ?? "other",
    minutes: typeof minutes === "number" && minutes > 0 ? Math.round(minutes) : null,
    exercises: typeof exercises === "number" && exercises > 0 ? exercises : null,
  };
}

function eventType(item: TimelineItemLike): string | null {
  return item.kind === "event" ? text(item.canonical?.type) : null;
}

/** The record type in the reader's language; unknown types keep the server title. */
export function timelineTitle(item: TimelineItemLike, i18n: I18n): string {
  const copy = metricCopy(item);
  if (copy) return i18n._(copy.label);
  const pain = painEntry(item);
  if (pain) {
    const region = painRegionText(pain.region, i18n);
    return i18n._(msg`Pain: ${region}`);
  }
  if (waterEntry(item)) return i18n._(msg`Plain water`);
  const intake = supplementIntake(item);
  if (intake) return intake.name ?? i18n._(msg`Supplement`);
  const session = workoutSession(item);
  if (session) return i18n._(workoutTypeLabel(session.type));
  const type = eventType(item);
  if (type === "sleep_session") return i18n._(msg`Sleep`);
  if (type === "workout") return text(item.canonical?.title) ?? i18n._(msg`Workout`);
  return item.title;
}

/**
 * The detail line. A metric reads as its value and unit (the title already
 * names it); a sleep session as its length. Anything else keeps the server's
 * summary.
 */
export function timelineSummary(item: TimelineItemLike, i18n: I18n): string {
  const tracker = trackerEntry(item);
  if (tracker) {
    const value = formatTrackerValue(i18n, tracker, tracker.value);
    const note = text(item.canonical?.note);
    return note ? `${value} · ${note}` : value;
  }
  const pain = painEntry(item);
  if (pain) {
    const value = painEntrySummary(pain, i18n);
    return pain.note ? `${value} · ${pain.note}` : value;
  }
  const water = waterEntry(item);
  if (water)
    return water.hidden
      ? i18n._(HIDDEN_VALUE)
      : formatWaterAmount(water.quantityMl, "ml", false, i18n);
  const intake = supplementIntake(item);
  if (intake) {
    const dose = intake.dose ?? i18n._(msg({ message: "Taken", context: "supplement" }));
    return intake.note ? `${dose} · ${intake.note}` : dose;
  }
  const session = workoutSession(item);
  if (session) {
    const minutes = session.minutes;
    const parts = [
      minutes
        ? i18n._(msg({ message: `${minutes} min`, comment: "A workout's length in minutes." }))
        : null,
      session.exercises ? i18n._(workoutExerciseCountLabel(session.exercises)) : null,
    ].filter((part): part is string => part !== null);
    return parts.length ? parts.join(", ") : i18n._(msg`Workout logged`);
  }
  if (item.kind === "metric" && item.canonical) {
    const value = item.canonical.value;
    if (typeof value === "number" && Number.isFinite(value)) {
      const number = new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 1 }).format(value);
      const copy = metricCopy(item);
      const stored = text(item.canonical.unit);
      const unit = copy
        ? copy.unit && i18n._(copy.unit)
        : stored && !SILENT_UNITS.has(stored)
          ? stored
          : null;
      return unit ? `${number} ${unit}` : number;
    }
    const written = text(value);
    if (written) return written;
  }
  if (eventType(item) === "sleep_session") {
    const minutes = item.canonical?.durationMinutes;
    if (typeof minutes === "number" && minutes > 0) return formatSleepDuration(minutes);
    return i18n._(msg`Sleep session`);
  }
  return item.summary;
}

function localParts(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/**
 * A record with a calendar day but no time of day (a logged workout session,
 * #493) stays on its own day in every time zone, and shows no time.
 */
function dateOnlyDay(item: TimelineItemLike): string | null {
  const day = item.canonical?.localDate;
  return item.canonical?.dateOnly === true &&
    typeof day === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? day
    : null;
}

/** Groups newest-first items into local days, preserving the server's order. */
export function groupTimelineByDay<T extends TimelineItemLike>(
  items: readonly T[],
  timeZone: string,
): TimelineDayGroup<T>[] {
  const groups: TimelineDayGroup<T>[] = [];
  for (const item of items) {
    const dateOnly = dateOnlyDay(item);
    const { day, time } = dateOnly ? { day: dateOnly, time: "" } : localParts(item.at, timeZone);
    // A date-only record can sort just outside its day near the date line.
    const last = groups.at(-1)?.day === day ? groups.at(-1) : groups.find((g) => g.day === day);
    if (last) last.items.push({ ...item, time });
    else groups.push({ day, items: [{ ...item, time }] });
  }
  return groups;
}
