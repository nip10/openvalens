/**
 * Meal diary presentation shared by web and mobile (Issue #77). Pure
 * TypeScript; imports only the zod-only wire contract — safe for app bundles.
 *
 * Copy rules (docs/mobile/tone-of-voice.md, CONTRIBUTING health-copy rules):
 * describe what was recorded, never judge it. No "good/bad" foods, no
 * "over"/"under", no streaks, no missed-day language. Missing nutrient data
 * is shown as unknown, never as zero, and an unmarked day is never a zero day.
 */
import {
  NUTRIENT_KEYS,
  type AmountUnit,
  type DayStatus,
  type DiaryEntry,
  type ManualFoodInput,
  type MealSlot,
  type NutrientBasis,
  type NutrientKey,
  type NutrientValues,
} from "../contracts/nutrition-diary";

export const SLOT_LABELS: Readonly<Record<MealSlot, string>> = Object.freeze({
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
  other: "Other",
});

export const UNIT_LABELS: Readonly<Record<AmountUnit, string>> = Object.freeze({
  g: "g",
  ml: "ml",
  serving: "serving",
});

/** Nutrients the day summary shows, in order. */
export const SUMMARY_NUTRIENTS: readonly NutrientKey[] = [
  "energyKcal",
  "proteinG",
  "carbohydrateG",
  "fatG",
  "fiberG",
];

export const NUTRIENT_LABELS: Readonly<Record<NutrientKey, { label: string; unit: string }>> =
  Object.freeze({
    energyKcal: { label: "Energy", unit: "kcal" },
    energyKj: { label: "Energy", unit: "kJ" },
    proteinG: { label: "Protein", unit: "g" },
    carbohydrateG: { label: "Carbohydrate", unit: "g" },
    fatG: { label: "Fat", unit: "g" },
    saturatedFatG: { label: "Saturated fat", unit: "g" },
    fiberG: { label: "Fibre", unit: "g" },
    totalSugarsG: { label: "Total sugars", unit: "g" },
    addedSugarsG: { label: "Added sugars", unit: "g" },
    freeSugarsG: { label: "Free sugars", unit: "g" },
    sodiumMg: { label: "Sodium", unit: "mg" },
    saltG: { label: "Salt", unit: "g" },
  });

/** A nutrient total over the entries that report it, plus how many do not. */
export type NutrientTotal = {
  /** Sum over entries with a value; `null` when no entry reports this nutrient. */
  known: number | null;
  /** Entries that report the nutrient (a recorded 0 counts as reported). */
  reported: number;
  /** Entries whose food did not provide the nutrient. */
  missing: number;
};

export type DaySummary = {
  entryCount: number;
  totals: Record<NutrientKey, NutrientTotal>;
};

/** Sums known values per nutrient; unknown values are counted, never added as 0. */
export function summarizeDay(entries: readonly Pick<DiaryEntry, "nutrients">[]): DaySummary {
  const totals = Object.fromEntries(
    NUTRIENT_KEYS.map((key) => {
      let known: number | null = null;
      let reported = 0;
      let missing = 0;
      for (const entry of entries) {
        const value = entry.nutrients[key];
        if (value === null) {
          missing += 1;
        } else {
          known = (known ?? 0) + value;
          reported += 1;
        }
      }
      return [key, { known, reported, missing }];
    }),
  ) as Record<NutrientKey, NutrientTotal>;
  return { entryCount: entries.length, totals };
}

function round(value: number, unit: string): string {
  const digits = unit === "kcal" || unit === "kJ" || unit === "mg" ? 0 : 1;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** `"412 kcal"`, `"Unknown"`, or a value without a unit when `unit` is omitted. */
export function formatNutrientValue(key: NutrientKey, value: number | null): string {
  if (value === null) return "Unknown";
  const { unit } = NUTRIENT_LABELS[key];
  return `${round(value, unit)} ${unit}`;
}

/**
 * One summary line, e.g. `"412 kcal"`, `"412 kcal from 3 of 4 entries"` or
 * `"Unknown"`. Partial coverage is stated, not hidden.
 */
export function formatNutrientTotal(key: NutrientKey, total: NutrientTotal): string {
  if (total.known === null) return total.missing > 0 ? "Unknown" : "—";
  const value = formatNutrientValue(key, total.known);
  if (total.missing === 0) return value;
  return `${value} from ${total.reported} of ${total.reported + total.missing} entries`;
}

/** Amount with unit, e.g. `"150 g"`, `"2 servings"`. */
export function formatAmount(amount: number, unit: AmountUnit): string {
  const value = amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (unit === "serving") return `${value} ${amount === 1 ? "serving" : "servings"}`;
  return `${value} ${unit}`;
}

/** Source label shown with every entry so provenance stays visible. */
export function foodSourceLabel(source: DiaryEntry["food"]["source"]): string {
  switch (source) {
    case "fdc":
      return "USDA FoodData Central";
    case "off":
      return "Open Food Facts";
    case "custom":
      return "My food";
    case "manual":
      return "Quick add";
  }
}

/** Day marker copy. A blank day and a day marked complete with no entries read differently. */
export function dayStatusText(
  status: DayStatus,
  entryCount: number,
): { label: string; description: string } {
  if (status === "complete")
    return {
      label: "Marked complete",
      description:
        entryCount === 0
          ? "You marked this day complete with nothing logged."
          : "You marked this day complete.",
    };
  return {
    label: "Not marked complete",
    description:
      entryCount === 0
        ? "Nothing logged. Days without a marker are treated as unknown, not as zero."
        : "This day may be partial. Totals cover logged entries only.",
  };
}

export const DIARY_COPY = Object.freeze({
  title: "Meal diary",
  empty: "Nothing logged for this day.",
  emptySlot: "Nothing logged",
  addFood: "Add food",
  markComplete: "Mark day complete",
  clearComplete: "Clear marker",
  copyFrom: "Copy from another day",
  deleted: "Entry removed.",
  undo: "Undo",
  restored: "Entry restored.",
  networkError: "Could not reach the server. Your saved entries are unchanged.",
  retry: "Retry",
  unknownNote: "Unknown means the food's source did not provide that value.",
  conflictTitle: "This entry changed on another device",
  keepMine: "Keep my change",
  keepServer: "Keep the other version",
  clearCache: "Clear diary data on this device",
});

/** Local outbox states shown next to unsynced changes (mobile). */
export type DiarySyncState = "queued" | "syncing" | "synced" | "needs_attention";

export const SYNC_STATE_LABELS: Readonly<Record<DiarySyncState, string>> = Object.freeze({
  queued: "Queued",
  syncing: "Syncing",
  synced: "Synced",
  needs_attention: "Needs attention",
});

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
): { slot: MealSlot; label: string; entries: T[] }[] {
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
};

/**
 * Turns quick-add form text into a manual food. Blank nutrient fields stay
 * unknown (omitted), never 0. Returns an error message for invalid input.
 */
export function parseQuickAdd(
  fields: QuickAddFields,
): { ok: true; food: ManualFoodInput } | { ok: false; error: string } {
  const name = fields.name.trim();
  if (!name) return { ok: false, error: "Enter a food name." };
  const basisAmount = Number(fields.basisAmount);
  if (!fields.basisAmount.trim() || !Number.isFinite(basisAmount) || basisAmount <= 0)
    return { ok: false, error: "Values are per a positive amount, for example 100 g." };
  const nutrients: Partial<NutrientValues> = {};
  for (const key of NUTRIENT_KEYS) {
    const raw = fields.nutrients[key]?.trim();
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0)
      return {
        ok: false,
        error: `${NUTRIENT_LABELS[key].label} must be 0 or more, or left blank.`,
      };
    nutrients[key] = value;
  }
  return {
    ok: true,
    food: {
      name,
      nutrientBasisAmount: basisAmount,
      nutrientBasisUnit: fields.basisUnit,
      nutrients,
    },
  };
}
