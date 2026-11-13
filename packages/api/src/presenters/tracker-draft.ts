import { parseDecimal } from "@openvalens/i18n/numbers";
import {
  defaultAggregation,
  findTrackerTemplate,
  parseDuration,
  TRACKER_LIMITS,
  type NumberAggregation,
  type TrackerAggregation,
  type TrackerCreateInput,
  type TrackerIcon,
  type TrackerTargetPeriod,
  type TrackerTemplateId,
  type TrackerType,
} from "@openvalens/trackers/model";

/**
 * The create / edit form's state for a custom tracker (#441), kept as the
 * strings the member typed so a half-typed value never turns into a number
 * too early. Pure, so the web and mobile forms share one rule.
 */
export type TrackerDraft = {
  template: TrackerTemplateId | null;
  name: string;
  icon: TrackerIcon;
  type: TrackerType;
  unit: string;
  decimals: number;
  aggregation: NumberAggregation;
  targetEnabled: boolean;
  /** Number or 1-5 for those types, a duration ("20 min") or a day count for yes/no per week. */
  target: string;
  targetPeriod: TrackerTargetPeriod;
  shared: boolean;
  aiVisible: boolean;
};

export function blankTrackerDraft(): TrackerDraft {
  return {
    template: null,
    name: "",
    icon: "target",
    type: "number",
    unit: "",
    decimals: 0,
    aggregation: "sum",
    targetEnabled: false,
    target: "",
    targetPeriod: "day",
    shared: false,
    aiVisible: true,
  };
}

/** A draft started from a template, named in the member's language. */
export function templateTrackerDraft(id: TrackerTemplateId, name: string): TrackerDraft {
  const template = findTrackerTemplate(id)!;
  return {
    ...blankTrackerDraft(),
    template: id,
    name,
    icon: template.icon,
    type: template.type,
    aiVisible: template.aiVisible,
  };
}

/** The stored target value from what was typed, or null when it does not parse. */
export function parseTargetValue(draft: TrackerDraft, locale?: string): number | null {
  const text = draft.target.trim();
  if (!text) return null;
  if (draft.type === "duration") return parseDuration(text);
  const value = parseDecimal(text, locale);
  if (value === null || value <= 0 || value > TRACKER_LIMITS.maxAbsNumber) return null;
  if (draft.type === "scale" && value > 5) return null;
  if (draft.type === "yes_no") {
    if (!Number.isInteger(value)) return null;
    if (draft.targetPeriod === "day" ? value !== 1 : value > 7) return null;
  }
  return value;
}

export type DraftProblem = "name" | "unit" | "target";

export function trackerDraftProblems(draft: TrackerDraft, locale?: string): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const name = draft.name.trim();
  if (!name || name.length > TRACKER_LIMITS.nameLength) problems.push("name");
  if (draft.type === "number") {
    const unit = draft.unit.trim();
    if (!unit || unit.length > TRACKER_LIMITS.unitLength) problems.push("unit");
  }
  if (draft.targetEnabled && parseTargetValue(draft, locale) === null) problems.push("target");
  return problems;
}

/** The create input, or null while the draft has problems. */
export function trackerCreatePayload(
  draft: TrackerDraft,
  locale?: string,
): TrackerCreateInput | null {
  if (trackerDraftProblems(draft, locale).length > 0) return null;
  const target = draft.targetEnabled ? parseTargetValue(draft, locale) : null;
  return {
    template: draft.template,
    name: draft.name.trim(),
    icon: draft.icon,
    type: draft.type,
    unit: draft.type === "number" ? draft.unit.trim() : null,
    decimals: draft.type === "number" ? draft.decimals : 0,
    aggregation: draft.type === "number" ? draft.aggregation : defaultAggregation(draft.type),
    target: target === null ? null : { value: target, period: draft.targetPeriod },
    shared: draft.shared,
    aiVisible: draft.aiVisible,
  };
}

/** What the settings form needs from a stored tracker. */
export type TrackerForDraft = {
  template: TrackerTemplateId | null;
  name: string;
  icon: TrackerIcon;
  type: TrackerType;
  unit: string | null;
  decimals: number;
  aggregation: TrackerAggregation;
  target: { value: number; period: TrackerTargetPeriod } | null;
  shared: boolean;
  aiVisible: boolean;
  locked: boolean;
};

/** A stored tracker as an editable draft (durations' targets in minutes). */
export function draftFromTracker(tracker: TrackerForDraft): TrackerDraft {
  return {
    ...blankTrackerDraft(),
    template: tracker.template,
    name: tracker.name,
    icon: tracker.icon,
    type: tracker.type,
    unit: tracker.unit ?? "",
    decimals: tracker.decimals,
    aggregation:
      tracker.aggregation === "average" || tracker.aggregation === "last"
        ? tracker.aggregation
        : "sum",
    targetEnabled: tracker.target !== null,
    target:
      tracker.target === null
        ? ""
        : tracker.type === "duration"
          ? `${Math.round(tracker.target.value / 60)} min`
          : String(tracker.target.value),
    targetPeriod: tracker.target?.period ?? "day",
    shared: tracker.shared,
    aiVisible: tracker.aiVisible,
  };
}

/**
 * The update input for the owner's settings form, or null while the draft has
 * problems. Type, unit and aggregation are sent only while the tracker has no
 * entries (the server refuses them after).
 */
export function trackerUpdatePayload(
  id: string,
  tracker: Pick<TrackerForDraft, "locked">,
  draft: TrackerDraft,
  locale?: string,
) {
  const payload = trackerCreatePayload(draft, locale);
  if (!payload) return null;
  return {
    id,
    name: payload.name,
    icon: payload.icon,
    target: payload.target ?? null,
    decimals: payload.decimals ?? 0,
    shared: payload.shared ?? false,
    aiVisible: payload.aiVisible ?? true,
    ...(tracker.locked
      ? {}
      : {
          type: payload.type,
          unit: payload.unit ?? null,
          aggregation: payload.aggregation ?? defaultAggregation(payload.type),
        }),
  };
}

/** The device's IANA time zone; days follow it. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** `datetime-local` value for now, in local time. */
export function nowLocalInput(): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

/** A `datetime-local` value as an ISO instant, or undefined when empty/invalid. */
export function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
