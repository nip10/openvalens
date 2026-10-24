/**
 * Supplements & medications presentation shared by web and mobile. Copy
 * follows docs/mobile/tone-of-voice.md (sentence case, real units, "—" when
 * absent).
 *
 * Frequency and time-of-day labels are Lingui message descriptors tagged
 * `safety` (dosing labels, #67); the apps render them with `_()`. Doses are
 * numbers with unit symbols or the member's own text, so they stay plain
 * strings. This module is app-only: server code must not import it.
 *
 * The plans domain stores doses as free-form strings (e.g. "800mcg",
 * "4000 IU") and supplements/medications schedules keep an optional
 * frequency. These helpers normalize both the closed frequency vocabulary
 * and the open-ended label text the same way on every surface.
 */
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

/**
 * Closed frequency vocabulary for the supplement / medication forms. Mirrors
 * the `supplement_schedule.frequency` examples in `packages/db/src/schema/plans.ts`
 * ("daily", "training days", "weekly").
 */
export const SUPPLEMENT_FREQUENCIES = ["daily", "training_days", "weekly"] as const;

export type SupplementFrequency = (typeof SUPPLEMENT_FREQUENCIES)[number];

const TRAINING_DAYS = msg({ message: "Training days", comment: "safety" });

const FREQUENCY_LABELS: Record<string, MessageDescriptor> = {
  daily: msg({ message: "Daily", comment: "safety" }),
  "training days": TRAINING_DAYS,
  training_days: TRAINING_DAYS,
  weekly: msg({ message: "Weekly", comment: "safety" }),
  biweekly: msg({ message: "Biweekly", comment: "safety" }),
  monthly: msg({ message: "Monthly", comment: "safety" }),
  once: msg({ message: "Once", comment: "safety" }),
};

/**
 * Free text the member entered (or "—" when absent), shown as written. It is
 * user text, so it is never translated.
 */
function asEntered(text: string): MessageDescriptor {
  return msg({
    message: `${text}`,
    comment: "Text the member entered, shown as written. Keep the placeholder as is.",
  });
}

/**
 * Render an arbitrary token in sentence case: split `_` / `-` separators into
 * spaces, collapse whitespace, then capitalize only the first word.
 */
export function sentenceCase(value: string): string {
  const cleaned = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (!cleaned) return "—";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Map the closed frequency enum to sentence case. Unknown-but-present values
 * fall back to sentence case so free-text frequencies still read cleanly.
 */
export function supplementFrequencyLabel(value: string | null | undefined): MessageDescriptor {
  if (value === null || value === undefined) return asEntered("—");
  const trimmed = value.trim();
  if (!trimmed) return asEntered("—");
  return FREQUENCY_LABELS[trimmed.toLowerCase()] ?? asEntered(sentenceCase(trimmed));
}

/**
 * Format a numeric dose plus its unit — "500 mg" / "—". Stored dose strings
 * (the plans tables keep `dose` as text) pass straight through trimmed.
 */
export function supplementDoseLabel(
  value: number | string | null | undefined,
  unit: string | null | undefined,
): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "—";
  }
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 1000) / 1000;
  return unit ? `${rounded} ${unit}` : String(rounded);
}

/** Medications share the supplement dose formatting rules. */
export function medicationDoseLabel(
  value: number | string | null | undefined,
  unit: string | null | undefined,
): string {
  return supplementDoseLabel(value, unit);
}

const TIME_OF_DAY_LABELS: Record<string, MessageDescriptor> = {
  morning: msg({ message: "Morning", comment: "safety" }),
  lunch: msg({ message: "Lunch", comment: "safety" }),
  dinner: msg({ message: "Dinner", comment: "safety" }),
  "pre-bed": msg({ message: "Pre-bed", comment: "safety" }),
  training: msg({ message: "Training", comment: "safety" }),
};

/**
 * Map the closed `ALLOWED_TIME_OF_DAY` enum ("morning", "lunch", "dinner",
 * "pre-bed", "training") to sentence case — "Morning" / "Pre-bed" / "—".
 */
export function formatScheduleTime(value: string | null | undefined): MessageDescriptor {
  if (value === null || value === undefined) return asEntered("—");
  const trimmed = value.trim();
  if (!trimmed) return asEntered("—");
  return TIME_OF_DAY_LABELS[trimmed.toLowerCase()] ?? asEntered(sentenceCase(trimmed));
}

const MEDICATION_STATUS_LABELS: Record<string, MessageDescriptor> = {
  active: msg({ message: "Active", context: "medication status", comment: "safety" }),
  completed: msg({ message: "Completed", context: "medication status", comment: "safety" }),
  paused: msg({ message: "Paused", context: "medication status", comment: "safety" }),
};

/** "Active" / "Completed" / "Paused"; other values in sentence case. */
export function medicationStatusLabel(value: string): MessageDescriptor {
  return MEDICATION_STATUS_LABELS[value.trim().toLowerCase()] ?? asEntered(sentenceCase(value));
}

// ─── Reminder days (weekly / training-day items) ────────────────

/** ISO weekday numbers in display order: 1 = Monday … 7 = Sunday. */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * Whether reminders for this frequency need weekdays chosen. "Training days"
 * are chosen like weekly days: the app has no per-member training calendar
 * (logged workouts are after the fact and not per member), so the member
 * says which days they train. Mirrors `frequencyNeedsDays` in
 * `@openvalens/plans` (server code; this module is app-only).
 */
export function frequencyNeedsDays(frequency: string | null | undefined): boolean {
  const normalized = (frequency ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "_");
  return normalized === "weekly" || normalized === "training_days";
}

/**
 * Locale-aware weekday name for an ISO weekday (1 = Monday … 7 = Sunday),
 * e.g. "Mon" / "seg." — formatted by `Intl`, never hardcoded.
 */
export function weekdayLabel(
  isoDay: number,
  locale: string,
  width: "short" | "long" = "short",
): string {
  // 2024-01-01 was a Monday, so day N of that week has ISO weekday N.
  return new Intl.DateTimeFormat(locale, { weekday: width, timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, 0, isoDay)),
  );
}

/** "Mon, Thu" in the member's locale, Monday first; empty when none. */
export function daysOfWeekLabel(
  days: ReadonlyArray<number> | null | undefined,
  locale: string,
): string {
  return [...new Set(days ?? [])]
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    .sort((a, b) => a - b)
    .map((day) => weekdayLabel(day, locale))
    .join(", ");
}

export const REMINDER_DAYS_COPY = {
  label: msg`Reminder days`,
  needed: msg`Choose days to get reminders for this item.`,
  trainingNote: msg`Choose the days you train. Reminders go out on those days.`,
  edit: msg`Change days`,
  save: msg`Save days`,
  cancel: msg`Cancel`,
} as const satisfies Record<string, MessageDescriptor>;

/**
 * The cadence line for a supplement schedule or medication: "Weekly · Mon,
 * Thu", or "Weekly" plus `needsDays` when reminders are waiting on days.
 */
export function reminderCadence(
  item: { frequency: string | null; daysOfWeek: ReadonlyArray<number> | null },
  locale: string,
): { frequency: MessageDescriptor; days: string; needsDays: boolean } {
  const needs = frequencyNeedsDays(item.frequency);
  const days = needs ? daysOfWeekLabel(item.daysOfWeek, locale) : "";
  return { frequency: supplementFrequencyLabel(item.frequency), days, needsDays: needs && !days };
}
