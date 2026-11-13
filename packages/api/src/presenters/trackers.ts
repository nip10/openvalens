/**
 * Custom trackers (#441): copy, value formatting, quick-log parsing and the
 * log kind each tracker adds to the shared list (#440). Pure TypeScript —
 * safe for the app bundles.
 *
 * Mood, energy and stress are self-ratings the member records: the copy never
 * calls them a score, never uses screening language and never compares them
 * with a clinical scale.
 */
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { parseDecimal } from "@openvalens/i18n/numbers";
import {
  durationParts,
  parseDuration,
  roundForDisplay,
  TRACKER_LIMITS,
  type TrackerAggregation,
  type TrackerIcon,
  type TrackerTargetPeriod,
  type TrackerTemplateId,
  type TrackerType,
} from "@openvalens/trackers/model";

import type { LogKind, LogKindField } from "./log-kinds";

export type TrackerTemplateCopy = {
  name: MessageDescriptor;
  description: MessageDescriptor;
  /** For 1-5 self-ratings: what the two ends mean. */
  scaleLow?: MessageDescriptor;
  scaleHigh?: MessageDescriptor;
};

export const TRACKER_TEMPLATE_COPY: Record<TrackerTemplateId, TrackerTemplateCopy> = {
  mood: {
    name: msg`Mood`,
    description: msg`Rate your mood yourself, from 1 to 5.`,
    scaleLow: msg`Low`,
    scaleHigh: msg`Good`,
  },
  energy: {
    name: msg`Energy`,
    description: msg`Rate your energy yourself, from 1 to 5.`,
    scaleLow: msg`Low`,
    scaleHigh: msg`High`,
  },
  stress: {
    name: msg`Stress`,
    description: msg`Rate how stressed you felt yourself, from 1 to 5.`,
    scaleLow: msg`Calm`,
    scaleHigh: msg`Very stressed`,
  },
  meditation: { name: msg`Meditation`, description: msg`Minutes of meditation.` },
  sauna: { name: msg`Sauna`, description: msg`Time in the sauna.` },
  cold_exposure: {
    name: msg`Cold exposure`,
    description: msg`Cold showers, plunges or swims.`,
  },
  dead_hang: { name: msg`Dead hang`, description: msg`Time hanging from a bar.` },
  flossed: { name: msg`Flossed`, description: msg`Whether you flossed today.` },
  gratitude: {
    name: msg`Gratitude`,
    description: msg`Something you are grateful for, with a note.`,
  },
};

export const TRACKER_TYPE_LABELS: Record<TrackerType, MessageDescriptor> = {
  number: msg`Number`,
  scale: msg`1 to 5`,
  yes_no: msg`Yes or no`,
  duration: msg`Duration`,
};

export const TRACKER_AGGREGATION_LABELS: Record<TrackerAggregation, MessageDescriptor> = {
  sum: msg`Add them up`,
  average: msg`Average`,
  last: msg`Keep the last one`,
  any: msg`Yes if any entry says yes`,
};

export const TRACKER_PERIOD_LABELS: Record<TrackerTargetPeriod, MessageDescriptor> = {
  day: msg`per day`,
  week: msg`per week`,
};

/** What a tracker looks like, as far as formatting goes. */
export type TrackerDisplayShape = {
  type: TrackerType;
  unit: string | null;
  decimals: number;
};

export function formatTrackerNumber(i18n: I18n, value: number, decimals: number): string {
  return new Intl.NumberFormat(i18n.locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.max(0, Math.min(TRACKER_LIMITS.maxDecimals, decimals)),
  }).format(roundForDisplay(value, decimals));
}

/** A duration in the member's language: "1 h 5 min", "20 min", "1 min 30 s", "45 s". */
export function formatTrackerDuration(i18n: I18n, seconds: number): string {
  const parts = durationParts(seconds);
  const out: string[] = [];
  if (parts.hours) out.push(i18n._(msg`${parts.hours} h`));
  if (parts.minutes) out.push(i18n._(msg`${parts.minutes} min`));
  if (parts.seconds && !parts.hours) out.push(i18n._(msg`${parts.seconds} s`));
  return out.length ? out.join(" ") : i18n._(msg`0 min`);
}

/**
 * A stored (or combined) value as the member reads it. A 1-5 self-rating reads
 * "3 of 5"; an averaged day may read "3.5 of 5". Yes/no reads "Yes" or "No"
 * (a weekly count of yes days is formatted with {@link formatTrackerTotal}).
 */
export function formatTrackerValue(i18n: I18n, shape: TrackerDisplayShape, value: number): string {
  switch (shape.type) {
    case "number": {
      const number = formatTrackerNumber(i18n, value, shape.decimals);
      return shape.unit ? `${number} ${shape.unit}` : number;
    }
    case "scale": {
      const rating = formatTrackerNumber(i18n, value, 1);
      return i18n._(msg`${rating} of 5`);
    }
    case "yes_no":
      return value > 0 ? i18n._(msg`Yes`) : i18n._(msg`No`);
    case "duration":
      return formatTrackerDuration(i18n, value);
  }
}

/** A total over several days: yes/no counts the yes days. */
export function formatTrackerTotal(i18n: I18n, shape: TrackerDisplayShape, value: number): string {
  if (shape.type === "yes_no") {
    const days = formatTrackerNumber(i18n, value, 0);
    return i18n._(msg`${days} days`);
  }
  return formatTrackerValue(i18n, shape, value);
}

/** "20 min per day", "5 days per week". */
export function formatTrackerTarget(
  i18n: I18n,
  shape: TrackerDisplayShape,
  target: { value: number; period: TrackerTargetPeriod },
): string {
  const amount =
    shape.type === "yes_no" && target.period === "week"
      ? formatTrackerTotal(i18n, shape, target.value)
      : formatTrackerValue(i18n, shape, target.value);
  return `${amount} ${i18n._(TRACKER_PERIOD_LABELS[target.period])}`;
}

const YES = new Set(["yes", "y", "sim", "s", "1", "true", "✓"]);
const NO = new Set(["no", "n", "não", "nao", "0", "false"]);

/**
 * Parses what the member typed for a tracker: a number in their locale (the
 * unit may follow), a 1-5 rating, yes/no (English or Portuguese), or a
 * duration ("20 min", "1:30", "45 s"). Null when it does not fit.
 */
export function parseTrackerInput(
  shape: TrackerDisplayShape,
  text: string,
  locale?: string,
): number | null {
  const input = text.trim();
  if (!input) return null;
  switch (shape.type) {
    case "number": {
      const unit = shape.unit?.trim().toLowerCase();
      const bare =
        unit && input.toLowerCase().endsWith(unit)
          ? input.slice(0, input.length - unit.length).trim()
          : input;
      const value = parseDecimal(bare, locale);
      return value !== null && Math.abs(value) <= TRACKER_LIMITS.maxAbsNumber ? value : null;
    }
    case "scale": {
      const value = parseDecimal(input.replace(/\s*(\/|of|de)\s*5$/i, ""), locale);
      return value !== null && Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
    }
    case "yes_no": {
      const word = input.toLowerCase();
      if (YES.has(word)) return 1;
      if (NO.has(word)) return 0;
      return null;
    }
    case "duration": {
      const seconds = parseDuration(input);
      return seconds !== null && seconds <= TRACKER_LIMITS.maxDurationSeconds ? seconds : null;
    }
  }
}

/** The minimum a tracker exposes to the log-kind list. */
export type TrackerForLogKind = TrackerDisplayShape & {
  id: string;
  name: string;
  icon: TrackerIcon;
  canLog: boolean;
  archivedAt: string | null;
};

export type TrackerLogKindId = `tracker:${string}`;

export function trackerLogKindId(trackerId: string): TrackerLogKindId {
  return `tracker:${trackerId}`;
}

/** The tracker id of a `tracker:<id>` log kind, or null for any other kind. */
export function trackerIdFromLogKind(kindId: string): string | null {
  return kindId.startsWith("tracker:") ? kindId.slice("tracker:".length) || null : null;
}

function valueField(shape: TrackerDisplayShape): LogKindField {
  switch (shape.type) {
    case "number":
      return {
        id: "value",
        label: msg`Value`,
        type: "number",
        required: true,
        // A free-text unit the member chose: shown as typed, never translated.
        ...(shape.unit
          ? { unit: { code: shape.unit, symbol: { id: shape.unit, message: shape.unit } } }
          : {}),
        step: 1 / 10 ** shape.decimals,
      };
    case "scale":
      return {
        id: "value",
        label: msg`Your rating`,
        type: "rating",
        required: true,
        min: 1,
        max: 5,
        step: 1,
      };
    case "yes_no":
      return { id: "value", label: msg`Done`, type: "yes_no", required: true };
    case "duration":
      return {
        id: "value",
        label: msg`Duration`,
        type: "duration",
        required: true,
        min: 1,
        max: TRACKER_LIMITS.maxDurationSeconds,
      };
  }
}

/**
 * The log kind a tracker adds to the shared list (#440), so it appears in the
 * palette, the picker and recents. The label is the member's own name for it,
 * shown as typed. Pass the result through `availableLogKinds(context, kinds)`
 * like any other kind.
 */
export function trackerLogKind(tracker: TrackerForLogKind): LogKind<TrackerLogKindId> {
  return {
    id: trackerLogKindId(tracker.id),
    label: { id: `tracker:${tracker.id}`, message: tracker.name },
    icon: tracker.icon,
    save: "at_once",
    permission: { resource: "records", action: "write" },
    gate: { module: null },
    fields: [
      valueField(tracker),
      { id: "observedAt", label: msg`Time`, type: "datetime", required: false },
      { id: "note", label: msg`Note`, type: "text", required: false },
    ],
    paths: { web: `/trackers/${tracker.id}`, native: `/trackers/${tracker.id}` },
  };
}

/** The log kinds of the trackers the member can log now (active, and theirs or shared). */
export function trackerLogKinds(
  trackers: readonly TrackerForLogKind[],
): LogKind<TrackerLogKindId>[] {
  return trackers
    .filter((tracker) => tracker.canLog && !tracker.archivedAt)
    .map((tracker) => trackerLogKind(tracker));
}

/**
 * A typed one-liner by tracker name: "sauna 20 min", "mood 4", "flossed yes".
 * The longest matching name wins; null when no tracker name starts the text or
 * the rest is not a value for it.
 */
export function matchTrackerOneLiner<T extends TrackerForLogKind>(
  text: string,
  trackers: readonly T[],
  locale?: string,
): { tracker: T; value: number } | null {
  const input = text.trim().replace(/\s+/g, " ");
  const lower = input.toLocaleLowerCase(locale);
  const candidates = trackers
    .filter((tracker) => tracker.canLog && !tracker.archivedAt)
    .map((tracker) => ({ tracker, name: tracker.name.trim().toLocaleLowerCase(locale) }))
    .filter(({ name }) => name.length > 0 && (lower === name || lower.startsWith(`${name} `)))
    .sort((a, b) => b.name.length - a.name.length);
  for (const { tracker, name } of candidates) {
    const rest = input.slice(name.length).trim();
    if (!rest) continue;
    const value = parseTrackerInput(tracker, rest, locale);
    if (value !== null) return { tracker, value };
  }
  return null;
}
