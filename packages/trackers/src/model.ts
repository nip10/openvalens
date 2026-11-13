import { z } from "zod";

/**
 * Custom trackers (Issue #441): the pure model, safe for the app bundles.
 *
 * A member defines a small tracker of their own (mood, sauna, dead hangs, …)
 * of one of four types. Values are stored as one number per entry:
 *
 * | type       | stored value          | several entries in a day        |
 * |------------|-----------------------|---------------------------------|
 * | `number`   | the value, in `unit`  | sum (default), average or last  |
 * | `scale`    | 1-5                   | average                         |
 * | `yes_no`   | 1 (yes) or 0 (no)     | yes if any entry says yes       |
 * | `duration` | seconds               | sum                             |
 *
 * Mood, energy and stress are self-ratings the member records: there is no
 * score, no screening language and no comparison with clinical scales.
 */

export const TRACKER_TYPES = ["number", "scale", "yes_no", "duration"] as const;
export type TrackerType = (typeof TRACKER_TYPES)[number];

export const NUMBER_AGGREGATIONS = ["sum", "average", "last"] as const;
export type NumberAggregation = (typeof NUMBER_AGGREGATIONS)[number];
export const TRACKER_AGGREGATIONS = ["sum", "average", "last", "any"] as const;
export type TrackerAggregation = (typeof TRACKER_AGGREGATIONS)[number];

export const TRACKER_TARGET_PERIODS = ["day", "week"] as const;
export type TrackerTargetPeriod = (typeof TRACKER_TARGET_PERIODS)[number];

/** Platform-neutral icon keys; each app maps them to its lucide icon. */
export const TRACKER_ICONS = [
  "smile",
  "zap",
  "activity",
  "leaf",
  "flame",
  "snowflake",
  "hand",
  "sparkles",
  "heart",
  "target",
  "timer",
  "check",
  "book",
  "droplet",
  "star",
  "sun",
  "moon",
  "coffee",
  "dumbbell",
  "footprints",
] as const;
export type TrackerIcon = (typeof TRACKER_ICONS)[number];

export const TRACKER_TEMPLATE_IDS = [
  "mood",
  "energy",
  "stress",
  "meditation",
  "sauna",
  "cold_exposure",
  "dead_hang",
  "flossed",
  "gratitude",
] as const;
export type TrackerTemplateId = (typeof TRACKER_TEMPLATE_IDS)[number];

/** v1 limits. */
export const TRACKER_LIMITS = Object.freeze({
  activePerMember: 50,
  nameLength: 40,
  unitLength: 12,
  noteLength: 500,
  maxDecimals: 2,
  /** One duration entry: at most 24 hours. */
  maxDurationSeconds: 86_400,
  /** A technical bound for numbers, not a plausibility range. */
  maxAbsNumber: 1_000_000_000,
  scaleMin: 1,
  scaleMax: 5,
});

/** The chart windows offered for each tracker. */
export const TRACKER_CHART_DAYS = [30, 90, 365] as const;
export type TrackerChartDays = (typeof TRACKER_CHART_DAYS)[number];

export type TrackerTemplate = {
  id: TrackerTemplateId;
  type: TrackerType;
  icon: TrackerIcon;
  aggregation: TrackerAggregation;
  /** "Coach and connected AI apps can read this" starts off for mood and stress. */
  aiVisible: boolean;
  /** Gratitude is a yes/no with a note: the form opens the note. */
  promptsNote?: boolean;
};

export const TRACKER_TEMPLATES: readonly TrackerTemplate[] = Object.freeze([
  { id: "mood", type: "scale", icon: "smile", aggregation: "average", aiVisible: false },
  { id: "energy", type: "scale", icon: "zap", aggregation: "average", aiVisible: true },
  { id: "stress", type: "scale", icon: "activity", aggregation: "average", aiVisible: false },
  { id: "meditation", type: "duration", icon: "leaf", aggregation: "sum", aiVisible: true },
  { id: "sauna", type: "duration", icon: "flame", aggregation: "sum", aiVisible: true },
  {
    id: "cold_exposure",
    type: "duration",
    icon: "snowflake",
    aggregation: "sum",
    aiVisible: true,
  },
  { id: "dead_hang", type: "duration", icon: "hand", aggregation: "sum", aiVisible: true },
  { id: "flossed", type: "yes_no", icon: "sparkles", aggregation: "any", aiVisible: true },
  {
    id: "gratitude",
    type: "yes_no",
    icon: "heart",
    aggregation: "any",
    aiVisible: true,
    promptsNote: true,
  },
] satisfies TrackerTemplate[]);

export function findTrackerTemplate(id: string | null | undefined): TrackerTemplate | undefined {
  return TRACKER_TEMPLATES.find((template) => template.id === id);
}

/** The fixed aggregation of a non-number type, or the default for numbers. */
export function defaultAggregation(type: TrackerType): TrackerAggregation {
  switch (type) {
    case "number":
    case "duration":
      return "sum";
    case "scale":
      return "average";
    case "yes_no":
      return "any";
  }
}

/** Whether a type allows this aggregation (numbers choose; the others are fixed). */
export function aggregationAllowed(type: TrackerType, aggregation: TrackerAggregation): boolean {
  if (type === "number") return (NUMBER_AGGREGATIONS as readonly string[]).includes(aggregation);
  return aggregation === defaultAggregation(type);
}

// ─── Values ───────────────────────────────────────────────────

export type TrackerShape = {
  type: TrackerType;
  unit: string | null;
  decimals: number;
  aggregation: TrackerAggregation;
};

/** Why a value cannot be stored for a tracker, or null when it can. */
export function trackerValueProblem(type: TrackerType, value: number): string | null {
  if (!Number.isFinite(value)) return "Enter a number.";
  switch (type) {
    case "number":
      return Math.abs(value) <= TRACKER_LIMITS.maxAbsNumber ? null : "That number is too large.";
    case "scale":
      return Number.isInteger(value) &&
        value >= TRACKER_LIMITS.scaleMin &&
        value <= TRACKER_LIMITS.scaleMax
        ? null
        : "Choose 1 to 5.";
    case "yes_no":
      return value === 0 || value === 1 ? null : "Choose yes or no.";
    case "duration":
      return Number.isInteger(value) && value > 0 && value <= TRACKER_LIMITS.maxDurationSeconds
        ? null
        : "Enter a duration up to 24 hours.";
  }
}

export type DayValue = { value: number; loggedAt: Date | string };

/**
 * Combines one day's entries: sum, average or last for numbers, sum for
 * durations, average for scales, and yes if any entry says yes. Null when the
 * day has no entries.
 */
export function aggregateValues(
  aggregation: TrackerAggregation,
  entries: readonly DayValue[],
): number | null {
  if (entries.length === 0) return null;
  switch (aggregation) {
    case "sum":
      return entries.reduce((total, entry) => total + entry.value, 0);
    case "average":
      return entries.reduce((total, entry) => total + entry.value, 0) / entries.length;
    case "any":
      return entries.some((entry) => entry.value > 0) ? 1 : 0;
    case "last": {
      let latest = entries[0]!;
      for (const entry of entries) {
        if (new Date(entry.loggedAt).getTime() >= new Date(latest.loggedAt).getTime())
          latest = entry;
      }
      return latest.value;
    }
  }
}

/**
 * A week's value for a weekly target, from its days' values: totals for sum
 * trackers, the number of "yes" days for yes/no, and the average of the days
 * for averaged trackers (the latest day for `last`).
 */
export function aggregateWeek(
  aggregation: TrackerAggregation,
  days: readonly { date: string; value: number | null }[],
): number | null {
  const logged = days.filter((day): day is { date: string; value: number } => day.value !== null);
  if (logged.length === 0) return null;
  switch (aggregation) {
    case "sum":
    case "any":
      return logged.reduce((total, day) => total + day.value, 0);
    case "average":
      return logged.reduce((total, day) => total + day.value, 0) / logged.length;
    case "last":
      return [...logged].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!.value;
  }
}

/** Rounds a stored number to the tracker's decimals for display. */
export function roundForDisplay(value: number, decimals: number): number {
  const factor = 10 ** Math.max(0, Math.min(TRACKER_LIMITS.maxDecimals, decimals));
  return Math.round(value * factor) / factor;
}

// ─── Durations ────────────────────────────────────────────────

/**
 * Parses a typed duration into seconds: `20` and `20 min` are minutes,
 * `45 s`, `1:30` (minutes:seconds), `1h 10m`, `1.5 h`. Null when it is not a
 * duration.
 */
export function parseDuration(text: string): number | null {
  const input = text.trim().toLowerCase().replace(",", ".");
  if (!input) return null;
  const clock = /^(\d{1,3}):([0-5]\d)$/.exec(input);
  if (clock) {
    const seconds = Number(clock[1]) * 60 + Number(clock[2]);
    return seconds > 0 ? seconds : null;
  }
  // Longest spellings first, so `min` is not read as `m` plus leftovers.
  const unitPattern =
    /(\d+(?:\.\d+)?)\s*(hours?|hrs|hr|h|minutes?|mins|min|m|seconds?|secs|sec|s)?/g;
  let total = 0;
  let consumed = "";
  let match: RegExpExecArray | null;
  let parts = 0;
  while ((match = unitPattern.exec(input)) !== null) {
    parts += 1;
    consumed += match[0];
    const amount = Number(match[1]);
    const unit = match[2] ?? "min";
    const factor = unit.startsWith("h") ? 3600 : unit.startsWith("s") ? 1 : 60;
    total += amount * factor;
  }
  if (parts === 0 || consumed.replace(/\s/g, "") !== input.replace(/\s/g, "")) return null;
  const seconds = Math.round(total);
  return seconds > 0 ? seconds : null;
}

/** Splits seconds into whole hours, minutes and seconds. */
export function durationParts(seconds: number): {
  hours: number;
  minutes: number;
  seconds: number;
} {
  const whole = Math.max(0, Math.round(seconds));
  return {
    hours: Math.floor(whole / 3600),
    minutes: Math.floor((whole % 3600) / 60),
    seconds: whole % 60,
  };
}

/** A compact, language-neutral duration: `1 h 5 min`, `20 min`, `1 min 30 s`, `45 s`. */
export function formatDurationShort(seconds: number): string {
  const parts = durationParts(seconds);
  const out: string[] = [];
  if (parts.hours) out.push(`${parts.hours} h`);
  if (parts.minutes) out.push(`${parts.minutes} min`);
  if (parts.seconds && !parts.hours) out.push(`${parts.seconds} s`);
  return out.length ? out.join(" ") : "0 min";
}

// ─── Days and weeks ───────────────────────────────────────────

/** Whether `zone` is an IANA time zone this runtime knows. */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar day (YYYY-MM-DD) of an instant in a time zone. */
export function localDateIn(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Adds whole days to a calendar date. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The Monday that starts the week of a calendar date. */
export function weekStart(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

/** Every calendar date from `from` to `to`, inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) out.push(date);
  return out;
}

export type TrackerTarget = { value: number; period: TrackerTargetPeriod };

export type TargetProgress = {
  period: TrackerTargetPeriod;
  target: number;
  /** Today's value for a daily target, this week's for a weekly one. */
  current: number | null;
  met: boolean;
  /** Days (or weeks) in the window that met the target, out of those shown. */
  metCount: number;
  periodCount: number;
};

/**
 * Target progress over a window of days, newest last. A target is met when
 * the day's (or week's) value reaches it.
 */
export function targetProgress(
  aggregation: TrackerAggregation,
  target: TrackerTarget,
  days: readonly { date: string; value: number | null }[],
): TargetProgress {
  if (target.period === "day") {
    const current = days.at(-1)?.value ?? null;
    const metCount = days.filter((day) => day.value !== null && day.value >= target.value).length;
    return {
      period: "day",
      target: target.value,
      current,
      met: current !== null && current >= target.value,
      metCount,
      periodCount: days.length,
    };
  }
  const weeks = new Map<string, { date: string; value: number | null }[]>();
  for (const day of days) {
    const key = weekStart(day.date);
    const list = weeks.get(key) ?? [];
    list.push(day);
    weeks.set(key, list);
  }
  const values = [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, list]) => aggregateWeek(aggregation, list));
  const current = values.at(-1) ?? null;
  return {
    period: "week",
    target: target.value,
    current,
    met: current !== null && current >= target.value,
    metCount: values.filter((value) => value !== null && value >= target.value).length,
    periodCount: values.length,
  };
}

// ─── Input schemas (shared by the API and the apps) ───────────

const trimmedName = z
  .string()
  .trim()
  .min(1, { message: "Give the tracker a name." })
  .max(TRACKER_LIMITS.nameLength, {
    message: `Use up to ${TRACKER_LIMITS.nameLength} characters.`,
  });
const unitText = z
  .string()
  .trim()
  .min(1, { message: "Enter a unit." })
  .max(TRACKER_LIMITS.unitLength, {
    message: `Use up to ${TRACKER_LIMITS.unitLength} characters.`,
  });
const target = z
  .strictObject({
    value: z.number().positive().max(TRACKER_LIMITS.maxAbsNumber),
    period: z.enum(TRACKER_TARGET_PERIODS),
  })
  .nullable();

export const trackerCreateInput = z
  .strictObject({
    template: z.enum(TRACKER_TEMPLATE_IDS).nullable().optional(),
    name: trimmedName,
    icon: z.enum(TRACKER_ICONS),
    type: z.enum(TRACKER_TYPES),
    unit: unitText.nullable().optional(),
    decimals: z.number().int().min(0).max(TRACKER_LIMITS.maxDecimals).optional(),
    aggregation: z.enum(TRACKER_AGGREGATIONS).optional(),
    target: target.optional(),
    shared: z.boolean().optional(),
    /** Omitted: the template's default (off for mood and stress), else on. */
    aiVisible: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "number" && !value.unit)
      ctx.addIssue({ code: "custom", path: ["unit"], message: "Enter a unit." });
    if (value.type !== "number" && value.unit)
      ctx.addIssue({
        code: "custom",
        path: ["unit"],
        message: "Only number trackers have a unit.",
      });
    if (value.aggregation && !aggregationAllowed(value.type, value.aggregation))
      ctx.addIssue({
        code: "custom",
        path: ["aggregation"],
        message: "This tracker type combines a day's entries in a fixed way.",
      });
  });
export type TrackerCreateInput = z.infer<typeof trackerCreateInput>;

export const trackerUpdateInput = z.strictObject({
  id: z.uuid(),
  name: trimmedName.optional(),
  icon: z.enum(TRACKER_ICONS).optional(),
  target: target.optional(),
  decimals: z.number().int().min(0).max(TRACKER_LIMITS.maxDecimals).optional(),
  shared: z.boolean().optional(),
  aiVisible: z.boolean().optional(),
  /** Locked after the first entry: create a new tracker instead. */
  type: z.enum(TRACKER_TYPES).optional(),
  unit: unitText.nullable().optional(),
  aggregation: z.enum(TRACKER_AGGREGATIONS).optional(),
});
export type TrackerUpdateInput = z.infer<typeof trackerUpdateInput>;

export const trackerIdInput = z.strictObject({ id: z.uuid() });
export const trackerArchiveInput = z.strictObject({ id: z.uuid(), archived: z.boolean() });
/** Deleting needs the tracker's name typed back. */
export const trackerDeleteInput = z.strictObject({
  id: z.uuid(),
  confirmation: z.string().max(200),
});

const timeZone = z.string().min(1).max(64).refine(isTimeZone, { message: "Unknown time zone." });
const note = z
  .string()
  .trim()
  .max(TRACKER_LIMITS.noteLength, { message: `Use up to ${TRACKER_LIMITS.noteLength} characters.` })
  .nullable()
  .optional();

export const trackerListInput = z.strictObject({
  timeZone,
  includeArchived: z.boolean().optional(),
});

export const trackerLogInput = z.strictObject({
  trackerId: z.uuid(),
  value: z.number(),
  /** When it happened; now when omitted. */
  loggedAt: z.iso.datetime({ offset: true }).optional(),
  timeZone,
  note,
});
export type TrackerLogInput = z.infer<typeof trackerLogInput>;

export const trackerEntryUpdateInput = z.strictObject({
  id: z.uuid(),
  value: z.number().optional(),
  loggedAt: z.iso.datetime({ offset: true }).optional(),
  timeZone,
  note,
});
export const trackerEntryIdInput = z.strictObject({ id: z.uuid() });

export const trackerEntriesInput = z.strictObject({
  trackerId: z.uuid(),
  limit: z.number().int().min(1).max(200).optional(),
  /** The `loggedAt` of the last entry already shown (paging, newest first). */
  before: z.iso.datetime({ offset: true }).optional(),
});

export const trackerChartInput = z.strictObject({
  trackerId: z.uuid(),
  days: z.union([z.literal(30), z.literal(90), z.literal(365)]),
  timeZone,
});
