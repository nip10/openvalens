/**
 * Manual entry presentation shared by web and mobile. Pure TypeScript — safe
 * for the app bundle. Used by the Vitals / Labs / Activity "Add reading"
 * forms, which write through `healthRecord.ingestMetricSample`. Labels and
 * units are Lingui message descriptors (#67).
 */
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { parseDecimal } from "@openvalens/i18n/numbers";

import type { MetricSamplePayload } from "./offline";

export type ManualEntryMetric =
  | "heart_rate"
  | "resting_heart_rate"
  | "steps"
  | "active_calories"
  | "distance"
  | "weight"
  | "blood_pressure_systolic"
  | "blood_pressure_diastolic";

export type ManualEntryField = {
  metric: ManualEntryMetric;
  label: MessageDescriptor;
  /** Unit shown next to the value: a symbol kept as is, or a word for steps. */
  unit: MessageDescriptor;
  /** The stored unit code (the metric taxonomy's unit). */
  unitCode: string;
  min: number;
  max: number;
  step: number;
};

export const MANUAL_ENTRY_FIELDS: Record<ManualEntryMetric, ManualEntryField> = {
  heart_rate: {
    metric: "heart_rate",
    label: msg`Heart rate`,
    unit: msg({ message: "bpm", comment: "Unit symbol; keep as is." }),
    unitCode: "bpm",
    min: 30,
    max: 220,
    step: 1,
  },
  resting_heart_rate: {
    metric: "resting_heart_rate",
    label: msg`Resting heart rate`,
    unit: msg({ message: "bpm", comment: "Unit symbol; keep as is." }),
    unitCode: "bpm",
    min: 30,
    max: 120,
    step: 1,
  },
  steps: {
    metric: "steps",
    label: msg`Steps`,
    unit: msg({ message: "steps", context: "unit", comment: "safety" }),
    unitCode: "count",
    min: 0,
    max: 100_000,
    step: 1,
  },
  active_calories: {
    metric: "active_calories",
    label: msg`Active calories`,
    unit: msg({ message: "kcal", comment: "Unit symbol; keep as is." }),
    unitCode: "kcal",
    min: 0,
    max: 10_000,
    step: 1,
  },
  distance: {
    metric: "distance",
    label: msg`Distance`,
    unit: msg({ message: "m", comment: "Unit symbol; keep as is." }),
    unitCode: "m",
    min: 0,
    max: 200_000,
    step: 1,
  },
  weight: {
    metric: "weight",
    label: msg`Weight`,
    unit: msg({ message: "kg", comment: "Unit symbol; keep as is." }),
    unitCode: "kg",
    min: 20,
    max: 300,
    step: 0.1,
  },
  blood_pressure_systolic: {
    metric: "blood_pressure_systolic",
    label: msg`Systolic`,
    unit: msg({ message: "mmHg", comment: "Unit symbol; keep as is." }),
    unitCode: "mmHg",
    min: 50,
    max: 260,
    step: 1,
  },
  blood_pressure_diastolic: {
    metric: "blood_pressure_diastolic",
    label: msg`Diastolic`,
    unit: msg({ message: "mmHg", comment: "Unit symbol; keep as is." }),
    unitCode: "mmHg",
    min: 30,
    max: 180,
    step: 1,
  },
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

/**
 * A local `YYYY-MM-DDTHH:MM` form value (as `defaultObservedAt` and
 * `<input type="datetime-local">` produce) as a UTC ISO instant, read in the
 * device's time zone. `null` when it is not a date and time.
 */
export function localDateTimeToIso(local: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d ||
    date.getHours() !== h
  )
    return null;
  return date.toISOString();
}

/**
 * Parses the value from a form string and clamps to the metric's allowed range.
 * The single number parser for manual forms; it uses the shared decimal
 * parser (#448), so "82,4" and "82.4" both read as 82.4. With the member's
 * `locale`, "1,250" is 1.25 in pt-PT (#455).
 */
export function parseManualEntryValue(
  field: Pick<ManualEntryField, "min" | "max">,
  raw: string,
  locale?: string,
): number | null {
  const value = parseDecimal(raw, locale);
  if (value === null) return null;
  const rounded = Math.round(value * 1000) / 1000;
  if (rounded < field.min || rounded > field.max) return null;
  return rounded;
}

// ─── Blood pressure (#440) ──────────────────────────────────────

export type BloodPressureInput = { systolic: string; diastolic: string; pulse: string };

export type BloodPressureReading = { systolic: number; diastolic: number; pulse: number | null };

/** Which part of a blood pressure form is wrong; `order` = systolic not above diastolic. */
export type BloodPressureError = "systolic" | "diastolic" | "pulse" | "order";

export type BloodPressureParse =
  | { ok: true; reading: BloodPressureReading }
  | { ok: false; errors: BloodPressureError[] };

/**
 * Parses a blood pressure form: systolic and diastolic in mmHg, optional pulse
 * in bpm. Systolic must be above diastolic.
 */
export function parseBloodPressure(
  input: BloodPressureInput,
  parse: typeof parseManualEntryValue = parseManualEntryValue,
): BloodPressureParse {
  const systolic = parse(MANUAL_ENTRY_FIELDS.blood_pressure_systolic, input.systolic);
  const diastolic = parse(MANUAL_ENTRY_FIELDS.blood_pressure_diastolic, input.diastolic);
  const pulseRaw = input.pulse.trim();
  const pulse = pulseRaw === "" ? null : parse(MANUAL_ENTRY_FIELDS.heart_rate, pulseRaw);
  const errors: BloodPressureError[] = [];
  if (systolic === null) errors.push("systolic");
  if (diastolic === null) errors.push("diastolic");
  if (pulseRaw !== "" && pulse === null) errors.push("pulse");
  if (systolic !== null && diastolic !== null && systolic <= diastolic) errors.push("order");
  if (errors.length > 0 || systolic === null || diastolic === null) return { ok: false, errors };
  return { ok: true, reading: { systolic, diastolic, pulse } };
}

/**
 * The `healthRecord.ingestMetricSample` writes for one reading: systolic,
 * diastolic and (when given) pulse as heart rate — the same codes a Bluetooth
 * monitor writes. All share one time, so they read back as one reading.
 * `observedAtLocal` is the form's local `YYYY-MM-DDTHH:MM` value.
 */
export function bloodPressureSamples(
  reading: BloodPressureReading,
  observedAtLocal: string,
): MetricSamplePayload[] {
  const observedAt = localDateTimeToIso(observedAtLocal) ?? observedAtLocal;
  const sample = (metric: ManualEntryMetric, value: number): MetricSamplePayload => ({
    metricCode: metric,
    observedAt,
    valueNumeric: value,
    dedupeHash: makeManualEntryHash(metric, observedAtLocal, value),
  });
  return [
    sample("blood_pressure_systolic", reading.systolic),
    sample("blood_pressure_diastolic", reading.diastolic),
    ...(reading.pulse === null ? [] : [sample("heart_rate", reading.pulse)]),
  ];
}
