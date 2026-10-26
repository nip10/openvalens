/**
 * Meal diary presentation shared by web and mobile (Issue #77). Pure
 * TypeScript; imports only the zod-only wire contract — safe for app bundles.
 *
 * Copy rules (docs/mobile/tone-of-voice.md, CONTRIBUTING health-copy rules):
 * describe what was recorded, never judge it. No "good/bad" foods, no
 * "over"/"under", no streaks, no missed-day language. Missing nutrient data
 * is shown as unknown, never as zero, and an unmarked day is never a zero day.
 */
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg, plural, select } from "@lingui/core/macro";
import { summarizeNutrients } from "@openvalens/nutrition/totals";

import {
  NUTRIENT_KEYS,
  type AmountUnit,
  type DayStatus,
  type DiaryEntry,
  type ManualFoodInput,
  type MealSlot,
  type NutrientBasis,
  type NutrientKey,
  type NutrientSummary,
  type NutrientTotal,
  type NutrientValues,
} from "../contracts/nutrition-diary";

export type { NutrientTotal } from "../contracts/nutrition-diary";

/**
 * Text that is never translated (brand and source names), as a descriptor so
 * it can sit next to translated labels. Not in any catalog, so it always
 * renders as written.
 */
export function untranslated(text: string): MessageDescriptor {
  return { id: text, message: text };
}

export const SLOT_LABELS: Readonly<Record<MealSlot, MessageDescriptor>> = Object.freeze({
  breakfast: msg`Breakfast`,
  lunch: msg`Lunch`,
  dinner: msg`Dinner`,
  snack: msg`Snack`,
  other: msg`Other`,
});

/** Unit symbols stay as written; "serving" is a word. */
export const UNIT_LABELS: Readonly<Record<AmountUnit, MessageDescriptor>> = Object.freeze({
  g: untranslated("g"),
  ml: untranslated("ml"),
  serving: msg`serving`,
});

/** Nutrients the day summary shows, in order. */
export const SUMMARY_NUTRIENTS: readonly NutrientKey[] = [
  "energyKcal",
  "proteinG",
  "carbohydrateG",
  "fatG",
  "fiberG",
];

export const NUTRIENT_LABELS: Readonly<
  Record<NutrientKey, { label: MessageDescriptor; unit: string }>
> = Object.freeze({
  energyKcal: { label: msg`Energy`, unit: "kcal" },
  energyKj: { label: msg`Energy`, unit: "kJ" },
  proteinG: { label: msg`Protein`, unit: "g" },
  carbohydrateG: { label: msg`Carbohydrate`, unit: "g" },
  fatG: { label: msg`Fat`, unit: "g" },
  saturatedFatG: { label: msg`Saturated fat`, unit: "g" },
  fiberG: { label: msg`Fibre`, unit: "g" },
  totalSugarsG: { label: msg`Total sugars`, unit: "g" },
  addedSugarsG: { label: msg`Added sugars`, unit: "g" },
  freeSugarsG: { label: msg`Free sugars`, unit: "g" },
  sodiumMg: { label: msg`Sodium`, unit: "mg" },
  saltG: { label: msg`Salt`, unit: "g" },
});

export type DaySummary = {
  entryCount: number;
  totals: Record<NutrientKey, NutrientTotal>;
};

/**
 * Sums known values per nutrient with per-nutrient coverage; unknown values
 * are counted, never added as 0. The same function the server uses for
 * `getDay.summary` and `getTotals` (#79), so a local preview of queued
 * offline entries matches what the server will compute.
 */
export function summarizeDay(entries: readonly Pick<DiaryEntry, "nutrients">[]): DaySummary {
  return summarizeNutrients(entries);
}

function round(value: number, unit: string): string {
  const digits = unit === "kcal" || unit === "kJ" || unit === "mg" ? 0 : 1;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** `"412 kcal"` or `"Unknown"`. */
export function formatNutrientValue(key: NutrientKey, value: number | null, i18n: I18n): string {
  if (value === null) return i18n._(msg`Unknown`);
  const { unit } = NUTRIENT_LABELS[key];
  return `${round(value, unit)} ${unit}`;
}

/**
 * One summary line, e.g. `"412 kcal"`, `"412 kcal from 3 of 4 entries"` or
 * `"Unknown"`. Partial coverage is stated, not hidden.
 */
export function formatNutrientTotal(
  key: NutrientKey,
  total: Pick<NutrientTotal, "known" | "reported" | "missing">,
  i18n: I18n,
): string {
  if (total.known === null) return total.missing > 0 ? i18n._(msg`Unknown`) : "—";
  const value = formatNutrientValue(key, total.known, i18n);
  if (total.missing === 0) return value;
  const reported = total.reported;
  const count = total.reported + total.missing;
  return i18n._(
    msg`${value} from ${reported} of ${plural(count, { one: "# entry", other: "# entries" })}`,
  );
}

/** The value part of a total: a number, `"Unknown"` (no entry provided it) or `"—"` (nothing logged). */
export function formatTotalValue(
  key: NutrientKey,
  total: Pick<NutrientTotal, "known" | "reported" | "missing">,
  i18n: I18n,
): string {
  if (total.known !== null) return formatNutrientValue(key, total.known, i18n);
  return total.missing > 0 ? i18n._(msg`Unknown`) : "—";
}

/**
 * Coverage line for one nutrient, e.g. `"All 3 entries"`, `"2 of 3 entries"`,
 * `"Not provided by 3 entries"` or `"Nothing logged"`. Always shown, so a
 * total never looks more complete than the data behind it.
 */
export function formatCoverage(
  total: Pick<NutrientTotal, "reported" | "missing">,
): MessageDescriptor {
  const count = total.reported + total.missing;
  const reported = total.reported;
  if (count === 0) return msg`Nothing logged`;
  if (total.missing === 0)
    return count === 1
      ? msg`From 1 entry`
      : msg`All ${plural(count, { one: "# entry", other: "# entries" })}`;
  if (reported === 0)
    return msg`Not provided by ${plural(count, { one: "# entry", other: "# entries" })}`;
  return msg`${reported} of ${plural(count, { one: "# entry", other: "# entries" })}`;
}

/** The coverage line in lower case, for use after a comma. */
export function coveragePhrase(
  total: Pick<NutrientTotal, "reported" | "missing">,
  i18n: I18n,
): string {
  return i18n._(formatCoverage(total)).toLocaleLowerCase(i18n.locale);
}

/** Accessible one-line reading of a nutrient total and its coverage. */
export function describeNutrientTotal(key: NutrientKey, total: NutrientTotal, i18n: I18n): string {
  const label = i18n._(NUTRIENT_LABELS[key].label);
  if (total.coverage === "no_entries") return i18n._(msg`${label}: nothing logged`);
  const coverage = coveragePhrase(total, i18n);
  if (total.known === null) return i18n._(msg`${label}: unknown, ${coverage}`);
  const value = formatNutrientValue(key, total.known, i18n);
  return i18n._(msg`${label}: ${value}, ${coverage}`);
}

/**
 * Every nutrient in display order, grouped so related values sit together
 * but stay separate: sodium is not salt, total sugars are not added or free
 * sugars, and kcal is not converted to kJ.
 */
export const ALL_NUTRIENTS: readonly NutrientKey[] = [
  "energyKcal",
  "energyKj",
  "proteinG",
  "carbohydrateG",
  "totalSugarsG",
  "addedSugarsG",
  "freeSugarsG",
  "fiberG",
  "fatG",
  "saturatedFatG",
  "sodiumMg",
  "saltG",
];

/** Where the day's logged foods came from, e.g. `"2 from USDA FoodData Central, 1 from Quick add"`. */
export function formatSources(sources: NutrientSummary["sources"], i18n: I18n): string | null {
  const parts = (["fdc", "off", "custom", "manual"] as const)
    .filter((source) => sources[source] > 0)
    .map((source) => {
      const count = sources[source];
      const label = i18n._(foodSourceLabel(source));
      return i18n._(msg`${count} from ${label}`);
    });
  return parts.length ? parts.join(", ") : null;
}

/** Amount with unit, e.g. `"150 g"`, `"2 servings"`. */
export function formatAmount(amount: number, unit: AmountUnit, i18n: I18n): string {
  const value = amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (unit === "serving")
    return i18n._(msg`${plural(amount, { one: `${value} serving`, other: `${value} servings` })}`);
  return `${value} ${unit}`;
}

/** Source label shown with every entry so provenance stays visible. */
export function foodSourceLabel(source: DiaryEntry["food"]["source"]): MessageDescriptor {
  switch (source) {
    case "fdc":
      return untranslated("USDA FoodData Central");
    case "off":
      return untranslated("Open Food Facts");
    case "custom":
      return msg`My food`;
    case "manual":
      return msg`Quick add`;
  }
}

/** Day marker copy. A blank day and a day marked complete with no entries read differently. */
export function dayStatusText(
  status: DayStatus,
  entryCount: number,
): { label: MessageDescriptor; description: MessageDescriptor } {
  if (status === "complete")
    return {
      label: msg`Marked complete`,
      description:
        entryCount === 0
          ? msg`You marked this day complete with nothing logged.`
          : msg`You marked this day complete.`,
    };
  return {
    label: msg`Not marked complete`,
    description:
      entryCount === 0
        ? msg`Nothing logged. Days without a marker are treated as unknown, not as zero.`
        : msg`This day may be partial. Totals cover logged entries only.`,
  };
}

export const DIARY_COPY = Object.freeze({
  title: msg`Meal diary`,
  empty: msg`Nothing logged for this day.`,
  emptySlot: msg`Nothing logged`,
  addFood: msg`Add food`,
  markComplete: msg`Mark day complete`,
  clearComplete: msg`Clear marker`,
  copyFrom: msg`Copy from another day`,
  deleted: msg`Entry removed.`,
  undo: msg`Undo`,
  restored: msg`Entry restored.`,
  networkError: msg`Could not reach the server. Your saved entries are unchanged.`,
  retry: msg`Retry`,
  unknownNote: msg`Unknown means the food's source did not provide that value.`,
  totalsTitle: msg`Day totals`,
  totalsNote: msg`Totals are estimates from the foods you logged. They add up only the values each food's source provided.`,
  allNutrients: msg`All nutrients`,
  sourcesLabel: msg`Sources`,
  pendingTotals: msg`Includes changes waiting to sync. Totals are confirmed after sync.`,
  conflictTitle: msg`This entry changed on another device`,
  keepMine: msg`Keep my change`,
  keepServer: msg`Keep the other version`,
  clearCache: msg`Clear diary data on this device`,
});

/** Local outbox states shown next to unsynced changes (mobile). */
export type DiarySyncState = "queued" | "syncing" | "synced" | "needs_attention";

export const SYNC_STATE_LABELS: Readonly<Record<DiarySyncState, MessageDescriptor>> = Object.freeze(
  {
    queued: msg`Queued`,
    syncing: msg`Syncing`,
    synced: msg`Synced`,
    needs_attention: msg`Needs attention`,
  },
);

/** Calendar date (`YYYY-MM-DD`) of `now` in `timeZone`; falls back to UTC. */
export function localDateIn(timeZone: string | undefined, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** `YYYY-MM-DD` shifted by whole days (calendar arithmetic, no time zone). */
export function shiftLocalDate(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return date.toISOString().slice(0, 10);
}

/** The device's IANA time zone, or `UTC` when the runtime does not expose one. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Groups entries by slot in slot order (every slot present, possibly empty). */
export function groupBySlot<T extends { slot: MealSlot }>(
  entries: readonly T[],
): { slot: MealSlot; label: MessageDescriptor; entries: T[] }[] {
  return (Object.keys(SLOT_LABELS) as MealSlot[]).map((slot) => ({
    slot,
    label: SLOT_LABELS[slot],
    entries: entries.filter((entry) => entry.slot === slot),
  }));
}

/** A fresh client mutation id (RFC 4122 v4 when `crypto.randomUUID` exists). */
export function newClientMutationId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Multiplier from per-basis values to `amount` `unit`, or `null` when the
 * units cannot be converted. Mirrors `computeNutrientFactor` in
 * `@openvalens/nutrition` (a parity test keeps them aligned) so clients can
 * preview a portion before saving and show queued offline entries.
 */
export function previewFactor(
  basis: NutrientBasis,
  amount: number,
  unit: AmountUnit,
): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const { nutrientBasisAmount, nutrientBasisUnit, servingSizeAmount, servingSizeUnit } = basis;
  if (unit === nutrientBasisUnit) return amount / nutrientBasisAmount;
  if (servingSizeAmount !== null && servingSizeUnit !== null) {
    if (unit === "serving" && servingSizeUnit === nutrientBasisUnit)
      return (amount * servingSizeAmount) / nutrientBasisAmount;
    if (nutrientBasisUnit === "serving" && servingSizeUnit === unit)
      return amount / servingSizeAmount / nutrientBasisAmount;
  }
  return null;
}

/** Per-entry values for a portion; unknown stays `null`. `null` overall when units are incompatible. */
export function previewNutrients(
  basis: NutrientBasis,
  perBasis: NutrientValues,
  amount: number,
  unit: AmountUnit,
): NutrientValues | null {
  const factor = previewFactor(basis, amount, unit);
  if (factor === null) return null;
  return Object.fromEntries(
    NUTRIENT_KEYS.map((key) => {
      const value = perBasis[key];
      return [key, value === null ? null : value * factor];
    }),
  ) as NutrientValues;
}

/** Units a food can be logged in, given its basis and serving size. */
export function unitsFor(basis: NutrientBasis): AmountUnit[] {
  return (["g", "ml", "serving"] as const).filter((unit) => previewFactor(basis, 1, unit) !== null);
}

export type QuickAddFields = {
  name: string;
  basisAmount: string;
  basisUnit: AmountUnit;
  nutrients: Partial<Record<NutrientKey, string>>;
  /** Barcode kept with a manual draft (#75); blank or absent means none. */
  barcode?: string;
};

/**
 * Turns quick-add form text into a manual food. Blank nutrient fields stay
 * unknown (omitted), never 0. Returns an error message for invalid input.
 */
export function parseQuickAdd(
  fields: QuickAddFields,
): { ok: true; food: ManualFoodInput } | { ok: false; error: MessageDescriptor } {
  const name = fields.name.trim();
  if (!name) return { ok: false, error: msg`Enter a food name.` };
  const basisAmount = Number(fields.basisAmount);
  if (!fields.basisAmount.trim() || !Number.isFinite(basisAmount) || basisAmount <= 0)
    return { ok: false, error: msg`Values are per a positive amount, for example 100 g.` };
  const nutrients: Partial<NutrientValues> = {};
  for (const key of NUTRIENT_KEYS) {
    const raw = fields.nutrients[key]?.trim();
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return { ok: false, error: nutrientValueError(key) };
    nutrients[key] = value;
  }
  const rawBarcode = fields.barcode?.replace(/[\s-]/g, "") ?? "";
  if (rawBarcode && !/^\d{8,14}$/.test(rawBarcode))
    return { ok: false, error: msg`Barcode must be 8 to 14 digits, or left blank.` };
  return {
    ok: true,
    food: {
      name,
      nutrientBasisAmount: basisAmount,
      nutrientBasisUnit: fields.basisUnit,
      nutrients,
      ...(rawBarcode ? { barcode: rawBarcode } : {}),
    },
  };
}

/** `"Protein must be 0 or more, or left blank."` as one sentence per nutrient. */
function nutrientValueError(key: NutrientKey): MessageDescriptor {
  return msg`${select(key, {
    energyKcal: "Energy",
    energyKj: "Energy",
    proteinG: "Protein",
    carbohydrateG: "Carbohydrate",
    fatG: "Fat",
    saturatedFatG: "Saturated fat",
    fiberG: "Fibre",
    totalSugarsG: "Total sugars",
    addedSugarsG: "Added sugars",
    freeSugarsG: "Free sugars",
    sodiumMg: "Sodium",
    saltG: "Salt",
    other: "A value",
  })} must be 0 or more, or left blank.`;
}
