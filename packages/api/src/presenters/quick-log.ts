/**
 * Quick log (#440): turns a quick form or a recent entry into the write it
 * makes, for the web command palette and the mobile log picker. Pure
 * TypeScript — safe for the app bundle. Numbers go through the shared decimal
 * parser (#448).
 *
 * Which kinds get a quick form here: the single metrics, blood pressure,
 * sleep, water, supplement taken and custom trackers (#441). Goal check-ins
 * and private measurements
 * open their own screen (each goal and each measurement has its own rules
 * there), as do the draft kinds (food, lab result, workout).
 *
 * Drink presets (#443) and pain (#442) have no quick form: a drink saves at
 * once from its row or a one-liner ("beer 330"); pain saves from a one-liner
 * ("pain left knee 4"), and its row opens the body map to tap a region. Both
 * still build their write here, so the checks are shared.
 *
 * Undo: only kinds whose domain lets the member delete their own entry offer
 * it (sleep, water, supplement taken, food and drinks, pain, trackers). Metric samples (weight, blood
 * pressure, heart rate, steps, …) have no member delete, so they save without
 * an undo and stay editable on their screen.
 */
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { parseDecimal } from "@openvalens/i18n/numbers";
import { drinkPreset, presetGrams, type DrinkPresetKey } from "@openvalens/nutrition/drinks";
import {
  isPainRegion,
  PAIN_RATING_MAX,
  PAIN_RATING_MIN,
  PAIN_TYPES,
  type PainType,
} from "@openvalens/pain/model";
import { TRACKER_LIMITS } from "@openvalens/trackers/model";

import type { LogEntryInput } from "../contracts/nutrition-diary";
import type { RecentLogEntry } from "../contracts/quick-log";
import { DRINK_PRESET_LABELS } from "./drinks";
import {
  DRINK_MAX_ML,
  drinkLogKind,
  drinkPresetKeyOfLogKind,
  findLogKind,
  type BuiltInLogKindId,
  type LogKind,
} from "./log-kinds";
import {
  bloodPressureSamples,
  defaultObservedAt,
  localDateTimeToIso,
  makeManualEntryHash,
  MANUAL_ENTRY_FIELDS,
  parseBloodPressure,
  type ManualEntryMetric,
} from "./manual-entry";
import { defaultManualSleepWindow, parseManualSleepForm } from "./manual-sleep";
import { mealSlotForLocalTime } from "./nutrition-diary";
import type { MetricSamplePayload } from "./offline";
import { painEntrySummary, painRegionEntryLabel } from "./pain-entry";
import { KG_TO_LB } from "./product-formatting";
import {
  formatTrackerDuration,
  formatTrackerValue,
  parseTrackerInput,
  trackerIdFromLogKind,
  trackerShapeOfLogKind,
} from "./trackers";

/** Kinds the quick form handles; every other kind opens `paths.web` / `paths.native`. */
export const QUICK_FORM_KIND_IDS = [
  "weight",
  "blood_pressure",
  "heart_rate",
  "resting_heart_rate",
  "steps",
  "active_calories",
  "distance",
  "sleep",
  "water",
  "supplement_intake",
] as const satisfies readonly BuiltInLogKindId[];
export type QuickFormKindId = (typeof QUICK_FORM_KIND_IDS)[number];

/** Built-in quick-form kinds, and every custom tracker kind (`tracker:<id>`, #441). */
export function hasQuickForm(kind: Pick<LogKind, "id" | "save">): boolean {
  if (kind.save !== "at_once") return false;
  return (
    (QUICK_FORM_KIND_IDS as readonly string[]).includes(kind.id) ||
    trackerIdFromLogKind(kind.id) !== null
  );
}

/**
 * Built-in kinds whose saved entry the member can delete again, so an undo is
 * offered. Drink presets (`drink:<key>`, diary entries) and trackers undo too.
 */
export const UNDOABLE_KIND_IDS: ReadonlySet<string> = new Set([
  "sleep",
  "water",
  "supplement_intake",
  "food",
  "pain",
]);

const SINGLE_METRICS = [
  "weight",
  "heart_rate",
  "resting_heart_rate",
  "steps",
  "active_calories",
  "distance",
] as const satisfies readonly ManualEntryMetric[];
type SingleMetric = (typeof SINGLE_METRICS)[number];
const isSingleMetric = (id: string): id is SingleMetric =>
  (SINGLE_METRICS as readonly string[]).includes(id);

const ML_PER: Record<string, number> = { ml: 1, l: 1000, fl_oz: 29.5735295625 };

/** One write a quick form or a repeat makes. */
export type QuickLogWrite =
  | { type: "metric"; kind: BuiltInLogKindId; samples: MetricSamplePayload[] }
  | {
      type: "sleep";
      input: { startAt: string; endAt: string; quality: number | null };
    }
  | {
      type: "water";
      input: {
        quantity: number;
        unit: "ml" | "l" | "fl_oz";
        observedAt: string;
        timeZone: string;
        clientMutationId: string;
      };
    }
  | {
      type: "supplement";
      input: {
        supplementId: number;
        occurredAt: string;
        timeZone: string;
        dose: string;
        clientMutationId: string;
      };
    }
  | {
      type: "tracker";
      /** `trackers.log` input; undo goes through `trackers.deleteEntry`. */
      input: {
        trackerId: string;
        value: number;
        loggedAt: string;
        timeZone: string;
        note?: string;
      };
    }
  | {
      type: "drink";
      preset: DrinkPresetKey;
      volumeMl: number;
      /** `nutritionDiary.logEntry` input; undo goes through `nutritionDiary.deleteEntry`. */
      input: LogEntryInput;
    }
  | {
      type: "pain";
      /** `pain.log` input, one region; undo goes through `pain.delete`. */
      input: {
        regions: [string];
        rating: number;
        type: PainType | null;
        loggedAt: string;
        timeZone: string;
      };
    };

/** Millilitres per typed drink unit. */
const DRINK_ML_PER: Record<string, number> = { ml: 1, cl: 10, l: 1000 };
/** Smallest drink volume a quick log accepts, in ml. */
const DRINK_MIN_ML = 10;

/** A local `YYYY-MM-DDTHH:MM` as a device-local `Date`. */
function localDateTime(local: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  return new Date(y, mo - 1, d, h, mi);
}

/**
 * A drink preset saved as a catalog food (#443): the preset's food and its
 * grams for `volumeMl`, on the local day and in the meal slot of `local`.
 */
function drinkWrite(
  key: DrinkPresetKey,
  volumeMl: number,
  local: string,
  context: { timeZone: string; newId: () => string },
  consumedAt?: string,
): Extract<QuickLogWrite, { type: "drink" }> {
  const preset = drinkPreset(key)!;
  const when = localDateTime(local) ?? new Date();
  return {
    type: "drink",
    preset: key,
    volumeMl,
    input: {
      clientMutationId: context.newId(),
      localDate: local.slice(0, 10),
      timeZone: context.timeZone,
      slot: mealSlotForLocalTime(when),
      food: { kind: "catalog", id: preset.catalogId },
      amount: Math.max(1, presetGrams(volumeMl, preset.gramsPerFlOz)),
      unit: "g",
      method: "preset",
      ...(consumedAt ? { consumedAt } : {}),
    },
  };
}

/** Raw form text by field id; a unit choice is under `"<fieldId>:unit"`. */
export type QuickFormValues = Readonly<Record<string, string>>;

export type QuickLogContext = {
  timeZone: string;
  newId: () => string;
  /** BCP 47 locale for the decimal parser ("1,250" in pt-PT is 1.25). */
  locale?: string;
  /** The supplement's dose to log when it is chosen. */
  supplementDose?: (supplementId: number) => string | null;
  now?: Date;
};

export type QuickLogParse = { ok: true; write: QuickLogWrite } | { ok: false; errors: string[] };

export const unitKey = (fieldId: string) => `${fieldId}:unit`;

/** Starting values: now for times, last night for sleep, the stored unit for units. */
export function quickFormDefaults(
  kind: LogKind,
  now: Date = new Date(),
  preferred: { weightUnit?: "kg" | "lb" } = {},
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of kind.fields) {
    if (field.type === "datetime") values[field.id] = defaultObservedAt(now);
    else values[field.id] = "";
    if (field.acceptedUnits && field.unit) values[unitKey(field.id)] = field.unit.code;
  }
  if (kind.id === "weight" && preferred.weightUnit) values[unitKey("value")] = preferred.weightUnit;
  if (kind.id === "sleep") {
    const night = defaultManualSleepWindow(now);
    values.bedtime = night.bedtime;
    values.wakeAt = night.wakeAt;
  }
  return values;
}

function parseNumber(raw: string | undefined, locale?: string): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  return parseDecimal(raw, locale);
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** A typed weight in kg (lb is converted). */
export function weightInKg(value: number, unit: string): number {
  return unit === "lb" ? value / KG_TO_LB : value;
}

/**
 * Checks a quick form and builds its write. `errors` are the field ids that
 * are wrong (`"order"` when systolic is not above diastolic, or the wake time
 * is not after bedtime).
 */
export function buildQuickLogWrite(
  kind: LogKind,
  values: QuickFormValues,
  context: QuickLogContext,
): QuickLogParse {
  const now = context.now ?? new Date();
  const observedLocal = values.observedAt?.trim() || defaultObservedAt(now);
  const observedAt = localDateTimeToIso(observedLocal);
  const timeErrors = kind.fields.some((field) => field.id === "observedAt") && !observedAt;

  const trackerId = trackerIdFromLogKind(kind.id);
  if (trackerId !== null) {
    const shape = trackerShapeOfLogKind(kind);
    const value = shape ? parseTrackerInput(shape, values.value ?? "", context.locale) : null;
    const note = values.note?.trim() ?? "";
    const errors: string[] = [];
    if (value === null) errors.push("value");
    if (timeErrors) errors.push("observedAt");
    if (note.length > TRACKER_LIMITS.noteLength) errors.push("note");
    if (errors.length > 0 || value === null || !observedAt) return { ok: false, errors };
    return {
      ok: true,
      write: {
        type: "tracker",
        input: {
          trackerId,
          value,
          loggedAt: observedAt,
          timeZone: context.timeZone,
          ...(note ? { note } : {}),
        },
      },
    };
  }

  const drinkKey = drinkPresetKeyOfLogKind(kind.id);
  if (drinkKey !== null) {
    // No volume typed: the preset's own ("espresso" is 30 ml).
    const typedText = values.volume?.trim() ?? "";
    const unit = values[unitKey("volume")] ?? "ml";
    const typed = typedText ? parseNumber(typedText, context.locale) : null;
    const perUnit = DRINK_ML_PER[unit];
    const ml = typedText
      ? typed === null || perUnit === undefined
        ? null
        : Math.round(typed * perUnit)
      : (drinkPreset(drinkKey)?.volumeMl ?? null);
    const errors: string[] = [];
    if (ml === null || ml < DRINK_MIN_ML || ml > DRINK_MAX_ML) errors.push("volume");
    if (timeErrors) errors.push("observedAt");
    if (errors.length > 0 || ml === null || !observedAt) return { ok: false, errors };
    const named = values.observedAt?.trim() ? observedAt : undefined;
    return { ok: true, write: drinkWrite(drinkKey, ml, observedLocal, context, named) };
  }

  if (kind.id === "pain") {
    const region = values.region?.trim() ?? "";
    const rating = parseNumber(values.rating, context.locale);
    const typeText = values.type?.trim() ?? "";
    // Empty is "no type"; an unknown word is an error (undefined).
    const type: PainType | null | undefined = !typeText
      ? null
      : (PAIN_TYPES as readonly string[]).includes(typeText)
        ? (typeText as PainType)
        : undefined;
    const errors: string[] = [];
    if (!isPainRegion(region)) errors.push("region");
    if (
      rating === null ||
      !Number.isInteger(rating) ||
      rating < PAIN_RATING_MIN ||
      rating > PAIN_RATING_MAX
    )
      errors.push("rating");
    if (type === undefined) errors.push("type");
    if (timeErrors) errors.push("observedAt");
    if (errors.length > 0 || rating === null || type === undefined || !observedAt)
      return { ok: false, errors };
    return {
      ok: true,
      write: {
        type: "pain",
        input: {
          regions: [region],
          rating,
          type,
          loggedAt: observedAt,
          timeZone: context.timeZone,
        },
      },
    };
  }

  if (isSingleMetric(kind.id)) {
    const field = MANUAL_ENTRY_FIELDS[kind.id];
    const typed = parseNumber(values.value, context.locale);
    const value =
      typed === null
        ? null
        : round3(
            kind.id === "weight" ? weightInKg(typed, values[unitKey("value")] ?? "kg") : typed,
          );
    const errors: string[] = [];
    if (value === null || value < field.min || value > field.max) errors.push("value");
    if (timeErrors) errors.push("observedAt");
    if (errors.length > 0 || value === null || !observedAt) return { ok: false, errors };
    return {
      ok: true,
      write: {
        type: "metric",
        kind: kind.id,
        samples: [
          {
            metricCode: kind.id,
            observedAt,
            valueNumeric: value,
            dedupeHash: makeManualEntryHash(kind.id, observedLocal, value),
          },
        ],
      },
    };
  }

  switch (kind.id) {
    case "blood_pressure": {
      const parsed = parseBloodPressure(
        {
          systolic: values.systolic ?? "",
          diastolic: values.diastolic ?? "",
          pulse: values.pulse ?? "",
        },
        (field, raw) => {
          const value = parseNumber(raw, context.locale);
          if (value === null) return null;
          const rounded = round3(value);
          return rounded < field.min || rounded > field.max ? null : rounded;
        },
      );
      const errors: string[] = parsed.ok ? [] : [...parsed.errors];
      if (timeErrors) errors.push("observedAt");
      if (!parsed.ok || errors.length > 0) return { ok: false, errors };
      return {
        ok: true,
        write: {
          type: "metric",
          kind: "blood_pressure",
          samples: bloodPressureSamples(parsed.reading, observedLocal),
        },
      };
    }
    case "sleep": {
      const parsed = parseManualSleepForm(values.bedtime ?? "", values.wakeAt ?? "", now);
      const qualityText = values.quality?.trim() ?? "";
      const quality = qualityText === "" ? null : Number(qualityText);
      const qualityOk =
        quality === null || (Number.isInteger(quality) && quality >= 1 && quality <= 5);
      if (!parsed.ok || !qualityOk) {
        const errors: string[] = [];
        if (!parsed.ok) errors.push(parsed.error === "invalid" ? "bedtime" : "order");
        if (!qualityOk) errors.push("quality");
        return { ok: false, errors };
      }
      return {
        ok: true,
        write: {
          type: "sleep",
          input: { startAt: parsed.window.startAt, endAt: parsed.window.endAt, quality },
        },
      };
    }
    case "water": {
      const field = kind.fields.find((item) => item.id === "quantity");
      const unit = (values[unitKey("quantity")] ?? "ml") as "ml" | "l" | "fl_oz";
      const quantity = parseNumber(values.quantity, context.locale);
      const ml = quantity === null ? null : quantity * (ML_PER[unit] ?? 1);
      const errors: string[] = [];
      if (
        quantity === null ||
        ml === null ||
        !(unit in ML_PER) ||
        ml < (field?.min ?? 1) ||
        ml > (field?.max ?? 5_000)
      )
        errors.push("quantity");
      if (timeErrors) errors.push("observedAt");
      if (errors.length > 0 || quantity === null || !observedAt) return { ok: false, errors };
      return {
        ok: true,
        write: {
          type: "water",
          input: {
            quantity,
            unit,
            observedAt,
            timeZone: context.timeZone,
            clientMutationId: context.newId(),
          },
        },
      };
    }
    case "supplement_intake": {
      const supplementId = Number(values.supplement);
      const dose =
        Number.isInteger(supplementId) && supplementId > 0
          ? (context.supplementDose?.(supplementId)?.trim() ?? "")
          : "";
      const errors: string[] = [];
      if (!dose) errors.push("supplement");
      if (timeErrors) errors.push("observedAt");
      if (errors.length > 0 || !observedAt) return { ok: false, errors };
      return {
        ok: true,
        write: {
          type: "supplement",
          input: {
            supplementId,
            occurredAt: observedAt,
            timeZone: context.timeZone,
            dose,
            clientMutationId: context.newId(),
          },
        },
      };
    }
    default:
      return { ok: false, errors: ["kind"] };
  }
}

/** The same entry again, with the time set to now. */
export function repeatRecentEntry(
  entry: RecentLogEntry,
  context: Omit<QuickLogContext, "locale" | "supplementDose">,
): QuickLogWrite {
  const now = context.now ?? new Date();
  const local = defaultObservedAt(now);
  const iso = localDateTimeToIso(local) ?? now.toISOString();
  if ("preset" in entry) return drinkWrite(entry.preset, entry.volumeMl, local, context);
  switch (entry.kind) {
    case "blood_pressure":
      return {
        type: "metric",
        kind: "blood_pressure",
        samples: bloodPressureSamples(
          { systolic: entry.systolic, diastolic: entry.diastolic, pulse: entry.pulse },
          local,
        ),
      };
    case "water":
      return {
        type: "water",
        input: {
          quantity: entry.quantityMl,
          unit: "ml",
          observedAt: iso,
          timeZone: context.timeZone,
          clientMutationId: context.newId(),
        },
      };
    case "supplement_intake":
      return {
        type: "supplement",
        input: {
          supplementId: entry.supplementId,
          occurredAt: iso,
          timeZone: context.timeZone,
          dose: entry.dose,
          clientMutationId: context.newId(),
        },
      };
    default:
      return {
        type: "metric",
        kind: entry.kind,
        samples: [
          {
            metricCode: entry.kind,
            observedAt: iso,
            valueNumeric: entry.value,
            dedupeHash: makeManualEntryHash(entry.kind, local, entry.value),
          },
        ],
      };
  }
}

const UNIT_SYMBOL: Record<string, MessageDescriptor> = {
  weight: MANUAL_ENTRY_FIELDS.weight.unit,
  heart_rate: MANUAL_ENTRY_FIELDS.heart_rate.unit,
  resting_heart_rate: MANUAL_ENTRY_FIELDS.resting_heart_rate.unit,
  steps: MANUAL_ENTRY_FIELDS.steps.unit,
  active_calories: MANUAL_ENTRY_FIELDS.active_calories.unit,
  distance: MANUAL_ENTRY_FIELDS.distance.unit,
};

export const QUICK_LOG_COPY = Object.freeze({
  bloodPressure: msg({
    message: "{systolic}/{diastolic} mmHg",
    comment: "Blood pressure reading; keep the unit symbol as is.",
  }),
  withPulse: msg({ message: "{reading}, pulse {pulse} bpm", comment: "Keep bpm as is." }),
  water: msg({ message: "{amount} ml", comment: "Keep ml as is." }),
  sleep: msg({
    message: "{duration}, {from}–{to}",
    comment: "Sleep length, then bedtime and wake time.",
  }),
});

const formatNumber = (i18n: I18n, value: number, digits = 1) =>
  new Intl.NumberFormat(i18n.locale || "en", { maximumFractionDigits: digits }).format(value);

/** "82,4 kg", "120/80 mmHg", "500 ml", "200 mg": the value a recent entry repeats. */
export function recentEntryValue(entry: RecentLogEntry, i18n: I18n): string {
  if ("preset" in entry)
    return i18n._({
      ...QUICK_LOG_COPY.water,
      values: { amount: formatNumber(i18n, entry.volumeMl, 0) },
    });
  switch (entry.kind) {
    case "blood_pressure": {
      const reading = i18n._({
        ...QUICK_LOG_COPY.bloodPressure,
        values: {
          systolic: formatNumber(i18n, entry.systolic, 0),
          diastolic: formatNumber(i18n, entry.diastolic, 0),
        },
      });
      return entry.pulse === null
        ? reading
        : i18n._({
            ...QUICK_LOG_COPY.withPulse,
            values: { reading, pulse: formatNumber(i18n, entry.pulse, 0) },
          });
    }
    case "water":
      return i18n._({
        ...QUICK_LOG_COPY.water,
        values: { amount: formatNumber(i18n, entry.quantityMl, 0) },
      });
    case "supplement_intake":
      return entry.dose;
    default: {
      const symbol = UNIT_SYMBOL[entry.kind];
      const digits = entry.kind === "weight" ? 1 : 0;
      return `${formatNumber(i18n, entry.value, digits)}${symbol ? ` ${i18n._(symbol)}` : ""}`;
    }
  }
}

/** "Weight", "Water", "Espresso", or the supplement's name. */
export function recentEntryTitle(entry: RecentLogEntry, i18n: I18n): string {
  if (entry.kind === "supplement_intake") return entry.supplementName;
  if ("preset" in entry) return i18n._(DRINK_PRESET_LABELS[entry.preset]);
  const kind = findLogKind(entry.kind);
  return kind ? i18n._(kind.label) : entry.kind;
}

/** The kind a recent entry repeats: a built-in kind, or a drink preset's kind. */
export function recentEntryLogKind(entry: RecentLogEntry): LogKind | undefined {
  return "preset" in entry ? drinkLogKind(entry.preset) : findLogKind(entry.kind);
}

const formatClock = (i18n: I18n, iso: string) =>
  new Intl.DateTimeFormat(i18n.locale || "en", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );

/**
 * The value a write saves, as the member reads it: "82,6 kg", "120/80 mmHg",
 * "500 ml", "7 h 30 min, 23:30–07:00", "200 mg", "20 min". Weight shows in the
 * member's preferred unit, whatever unit they typed.
 */
export function quickLogWriteValue(
  write: QuickLogWrite,
  kind: Pick<LogKind, "id" | "fields">,
  i18n: I18n,
  preferred: { weightUnit?: "kg" | "lb" } = {},
): string {
  switch (write.type) {
    case "metric": {
      if (write.kind === "blood_pressure") {
        const value = (code: string) =>
          write.samples.find((sample) => sample.metricCode === code)?.valueNumeric ?? null;
        const reading = i18n._({
          ...QUICK_LOG_COPY.bloodPressure,
          values: {
            systolic: formatNumber(i18n, value("blood_pressure_systolic") ?? 0, 0),
            diastolic: formatNumber(i18n, value("blood_pressure_diastolic") ?? 0, 0),
          },
        });
        const pulse = value("heart_rate");
        return pulse === null
          ? reading
          : i18n._({
              ...QUICK_LOG_COPY.withPulse,
              values: { reading, pulse: formatNumber(i18n, pulse, 0) },
            });
      }
      const sample = write.samples[0];
      if (sample?.valueNumeric === undefined) return "";
      if (write.kind === "weight" && preferred.weightUnit === "lb")
        return `${formatNumber(i18n, sample.valueNumeric * KG_TO_LB)} lb`;
      const symbol = UNIT_SYMBOL[write.kind];
      const digits = write.kind === "weight" ? 1 : 0;
      return `${formatNumber(i18n, sample.valueNumeric, digits)}${symbol ? ` ${i18n._(symbol)}` : ""}`;
    }
    case "water":
      return i18n._({
        ...QUICK_LOG_COPY.water,
        values: {
          amount: formatNumber(i18n, write.input.quantity * (ML_PER[write.input.unit] ?? 1), 0),
        },
      });
    case "sleep": {
      const minutes = Math.round(
        (Date.parse(write.input.endAt) - Date.parse(write.input.startAt)) / 60_000,
      );
      return i18n._({
        ...QUICK_LOG_COPY.sleep,
        values: {
          duration: formatTrackerDuration(i18n, minutes * 60),
          from: formatClock(i18n, write.input.startAt),
          to: formatClock(i18n, write.input.endAt),
        },
      });
    }
    case "supplement":
      return write.input.dose;
    case "tracker": {
      const shape = trackerShapeOfLogKind(kind);
      return shape ? formatTrackerValue(i18n, shape, write.input.value) : String(write.input.value);
    }
    case "drink":
      return i18n._({
        ...QUICK_LOG_COPY.water,
        values: { amount: formatNumber(i18n, write.volumeMl, 0) },
      });
    case "pain": {
      // "Left knee · 4 of 10 · Ache": the number as given, nothing else.
      const region = write.input.regions[0];
      const label = painRegionEntryLabel(region);
      return `${label ? i18n._(label) : region} · ${painEntrySummary(write.input, i18n)}`;
    }
  }
}
