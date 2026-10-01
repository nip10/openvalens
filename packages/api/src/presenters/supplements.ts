/**
 * Supplements & medications presentation shared by web and mobile. Pure
 * TypeScript, no imports — safe for the app bundle. Copy follows
 * docs/mobile/tone-of-voice.md (sentence case, real units, "—" when absent).
 *
 * The plans domain stores doses as free-form strings (e.g. "800mcg",
 * "4000 IU") and supplements/medications schedules keep an optional
 * frequency. These helpers normalize both the closed frequency vocabulary
 * and the open-ended label text the same way on every surface.
 */

/**
 * Closed frequency vocabulary for the supplement / medication forms. Mirrors
 * the `supplement_schedule.frequency` examples in `packages/db/src/schema/plans.ts`
 * ("daily", "training days", "weekly").
 */
export const SUPPLEMENT_FREQUENCIES = ["daily", "training_days", "weekly"] as const;

export type SupplementFrequency = (typeof SUPPLEMENT_FREQUENCIES)[number];

const FREQUENCY_LABELS: Record<string, string> = {
  daily: "Daily",
  "training days": "Training days",
  training_days: "Training days",
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  once: "Once",
};

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
export function supplementFrequencyLabel(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const trimmed = value.trim();
  if (!trimmed) return "—";
  return FREQUENCY_LABELS[trimmed.toLowerCase()] ?? sentenceCase(trimmed);
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

const TIME_OF_DAY_LABELS: Record<string, string> = {
  morning: "Morning",
  lunch: "Lunch",
  dinner: "Dinner",
  "pre-bed": "Pre-bed",
  training: "Training",
};

/**
 * Map the closed `ALLOWED_TIME_OF_DAY` enum ("morning", "lunch", "dinner",
 * "pre-bed", "training") to sentence case — "Morning" / "Pre-bed" / "—".
 */
export function formatScheduleTime(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const trimmed = value.trim();
  if (!trimmed) return "—";
  return TIME_OF_DAY_LABELS[trimmed.toLowerCase()] ?? sentenceCase(trimmed);
}
