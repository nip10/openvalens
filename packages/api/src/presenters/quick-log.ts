/**
 * Quick log (#440): turns a quick form or a recent entry into the write it
 * makes, for the web command palette and the mobile log picker. Pure
 * TypeScript — safe for the app bundle. Numbers go through the shared decimal
 * parser (#448).
 *
 * Which kinds get a quick form here: the single metrics, blood pressure,
 * sleep, water and supplement taken. Goal check-ins and private measurements
 * open their own screen (each goal and each measurement has its own rules
 * there), as do the draft kinds (food, lab result, workout).
 *
 * Undo: only kinds whose domain lets the member delete their own entry offer
 * it (sleep, water, supplement taken, food). Metric samples (weight, blood
 * pressure, heart rate, steps, …) have no member delete, so they save without
 * an undo and stay editable on their screen.
 */
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { parseDecimal } from "@openvalens/i18n/numbers";

import type { RecentLogEntry } from "../contracts/quick-log";
import { findLogKind, type BuiltInLogKindId, type LogKind } from "./log-kinds";
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
import type { MetricSamplePayload } from "./offline";
import { KG_TO_LB } from "./product-formatting";

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

export function hasQuickForm(kind: Pick<LogKind, "id" | "save">): kind is LogKind<QuickFormKindId> {
  return kind.save === "at_once" && (QUICK_FORM_KIND_IDS as readonly string[]).includes(kind.id);
}

/** Kinds whose saved entry the member can delete again, so an undo is offered. */
export const UNDOABLE_KIND_IDS: ReadonlySet<string> = new Set([
  "sleep",
  "water",
  "supplement_intake",
  "food",
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
    };

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
});

const formatNumber = (i18n: I18n, value: number, digits = 1) =>
  new Intl.NumberFormat(i18n.locale || "en", { maximumFractionDigits: digits }).format(value);

/** "82,4 kg", "120/80 mmHg", "500 ml", "200 mg": the value a recent entry repeats. */
export function recentEntryValue(entry: RecentLogEntry, i18n: I18n): string {
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

/** "Weight", "Water", or the supplement's name. */
export function recentEntryTitle(entry: RecentLogEntry, i18n: I18n): string {
  if (entry.kind === "supplement_intake") return entry.supplementName;
  const kind = findLogKind(entry.kind);
  return kind ? i18n._(kind.label) : entry.kind;
}
