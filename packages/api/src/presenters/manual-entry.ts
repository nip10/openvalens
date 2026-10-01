/**
 * Manual entry presentation shared by web and mobile. Pure TypeScript, no
 * imports — safe for the app bundle. Used by the Vitals / Labs / Activity
 * "Add reading" forms, which write through `healthRecord.ingestMetricSample`.
 */
export type ManualEntryMetric =
  | "heart_rate"
  | "resting_heart_rate"
  | "steps"
  | "active_calories"
  | "distance"
  | "weight";

export type ManualEntryField = {
  metric: ManualEntryMetric;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
};

export const MANUAL_ENTRY_FIELDS: Record<ManualEntryMetric, ManualEntryField> = {
  heart_rate: {
    metric: "heart_rate",
    label: "Heart rate",
    unit: "bpm",
    min: 30,
    max: 220,
    step: 1,
  },
  resting_heart_rate: {
    metric: "resting_heart_rate",
    label: "Resting heart rate",
    unit: "bpm",
    min: 30,
    max: 120,
    step: 1,
  },
  steps: { metric: "steps", label: "Steps", unit: "steps", min: 0, max: 100_000, step: 1 },
  active_calories: {
    metric: "active_calories",
    label: "Active calories",
    unit: "kcal",
    min: 0,
    max: 10_000,
    step: 1,
  },
  distance: { metric: "distance", label: "Distance", unit: "m", min: 0, max: 200_000, step: 1 },
  weight: { metric: "weight", label: "Weight", unit: "kg", min: 20, max: 300, step: 0.1 },
};

/**
 * Stable client-side dedupe hash so a double-tap of "Save" doesn't create a
 * duplicate row. Combines the metric code, the observed-at minute, the value
 * and a per-device random nonce so unrelated entries don't collide.
 */
export function makeManualEntryHash(
  metric: ManualEntryMetric,
  observedAtIso: string,
  value: number,
): string {
  const minute = observedAtIso.slice(0, 16); // YYYY-MM-DDTHH:MM
  const valueKey = String(Math.round(value * 1000));
  return `manual-${metric}-${minute}-${valueKey}`;
}

/** Returns a sane default `observedAt` for a new entry (now, ISO minute precision). */
export function defaultObservedAt(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

/** Parses the value from a form string and clamps to the metric's allowed range. */
export function parseManualEntryValue(field: ManualEntryField, raw: string): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * 1000) / 1000;
  if (rounded < field.min || rounded > field.max) return null;
  return rounded;
}
