/**
 * Timeline presentation shared by web and mobile, so both render the same
 * groups, labels and tones. Pure TypeScript: safe for the app bundle. Copy
 * follows docs/mobile/tone-of-voice.md (sentence case, ISO dates, 24-hour
 * times). Labels are Lingui message descriptors (#67).
 */
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { WearableProviderId } from "@openvalens/wearables";

import { MANUAL_ENTRY_FIELDS } from "./manual-entry";
import { formatSleepDuration } from "./sleep";

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

function eventType(item: TimelineItemLike): string | null {
  return item.kind === "event" ? text(item.canonical?.type) : null;
}

/** The record type in the reader's language; unknown types keep the server title. */
export function timelineTitle(item: TimelineItemLike, i18n: I18n): string {
  const copy = metricCopy(item);
  if (copy) return i18n._(copy.label);
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

/** Groups newest-first items into local days, preserving the server's order. */
export function groupTimelineByDay<T extends TimelineItemLike>(
  items: readonly T[],
  timeZone: string,
): TimelineDayGroup<T>[] {
  const groups: TimelineDayGroup<T>[] = [];
  for (const item of items) {
    const { day, time } = localParts(item.at, timeZone);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push({ ...item, time });
    else groups.push({ day, items: [{ ...item, time }] });
  }
  return groups;
}
