/**
 * Food search and barcode lookup presentation shared by web and mobile
 * (Issue #75). Pure TypeScript over the zod-only wire contracts, safe for app
 * bundles.
 *
 * Rules this module enforces for both apps:
 * - A barcode is a lookup key, never a product. A miss, a store/weighed-item
 *   code, an unreachable source or an offline cache miss each lead to a
 *   user-entered manual draft with the code prefilled (when it identifies a
 *   product) and every value blank; nothing is guessed or invented.
 * - Every candidate keeps its source label and, for catalog data, the
 *   attribution notice, plus which summary values the source did not
 *   provide. Nothing is logged until the member presses Save.
 * - Search text and barcodes are never sent anywhere but the lookup itself.
 */
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";

import type {
  FoodChoice,
  AmountUnit,
  FoodRef,
  NutrientBasis,
  NutrientValues,
} from "../contracts/nutrition-diary";
import type { BarcodeLookup, FoodOrigin, FoodResult } from "../contracts/nutrition-foods";
import {
  NUTRIENT_LABELS,
  SUMMARY_NUTRIENTS,
  formatNutrientValue,
  foodSourceLabel,
  unitsFor,
  type QuickAddFields,
} from "./nutrition-diary";
import { HIDDEN_VALUE, resolveHideNumbers } from "./nutrition-targets";

/** How the member found a food; becomes the entry's `method`. */
export type CandidateMethod = "manual" | "search" | "barcode";

/** A food the member can review and then log, from any source. */
export type FoodCandidate = {
  /** Stable list key. */
  key: string;
  /** What `nutritionDiary.logEntry` receives; catalog values are resolved server-side. */
  ref: FoodRef;
  method: CandidateMethod;
  source: FoodChoice["source"];
  name: string;
  brand: string | null;
  /** E.g. "Open Food Facts", "Open Food Facts (live lookup)", "My food". */
  sourceLabel: MessageDescriptor;
  /** Source notice to show with the candidate (always set for OFF data). */
  attribution: string | null;
  basis: NutrientBasis;
  nutrientsPerBasis: NutrientValues;
  /** Summary nutrients the source did not provide (shown as unknown). */
  missing: MessageDescriptor[];
  lastAmount?: number | null;
  lastUnit?: FoodChoice["lastUnit"];
  lastSlot?: FoodChoice["lastSlot"];
};

/**
 * Accessible and visible summary for a food lookup row. Values use the
 * declared serving when it is compatible with the nutrient basis; otherwise
 * they remain on the food's documented per-100 g/ml basis.
 */
export function formatFoodCandidateSummaryLine(
  candidate: Pick<FoodCandidate, "basis" | "nutrientsPerBasis">,
  hideNumbers: boolean | undefined,
  i18n: I18n,
): string {
  if (resolveHideNumbers(hideNumbers)) return i18n._(HIDDEN_VALUE);

  const { basis, nutrientsPerBasis } = candidate;
  const hasServing =
    basis.servingSizeAmount !== null &&
    basis.servingSizeUnit !== null &&
    basis.servingSizeAmount > 0 &&
    basis.servingSizeUnit === basis.nutrientBasisUnit;
  const scale = hasServing ? basis.servingSizeAmount! / basis.nutrientBasisAmount : 1;
  const energy =
    nutrientsPerBasis.energyKcal === null ? null : nutrientsPerBasis.energyKcal * scale;
  const protein = nutrientsPerBasis.proteinG === null ? null : nutrientsPerBasis.proteinG * scale;
  const amount = hasServing ? basis.servingSizeAmount! : basis.nutrientBasisAmount;
  const unit = hasServing ? basis.servingSizeUnit! : basis.nutrientBasisUnit;
  const formattedAmount = new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 2 }).format(
    amount,
  );
  const basisText = hasServing
    ? basis.servingLabel
      ? i18n._(msg`${basis.servingLabel} (${formattedAmount} ${unit})`)
      : i18n._(msg`serving (${formattedAmount} ${unit})`)
    : i18n._(msg`${formattedAmount} ${unit}`);

  return i18n._(
    msg`${formatNutrientValue("energyKcal", energy, i18n)} · ${formatNutrientValue("proteinG", protein, i18n)} protein · per ${basisText}`,
  );
}

function missingSummary(values: NutrientValues): MessageDescriptor[] {
  return SUMMARY_NUTRIENTS.filter((key) => values[key] === null).map(
    (key) => NUTRIENT_LABELS[key].label,
  );
}

function resultSourceLabel(source: FoodResult["source"], origin: FoodOrigin): MessageDescriptor {
  const label = foodSourceLabel(source);
  // Catalog source names are never translated, so their text is always set.
  const name = label.message;
  if (origin !== "live" || !name || source === "custom") return label;
  return msg`${name} (live lookup)`;
}

/** A saved, recent or favourite food (from `nutritionDiary.listFoods`). */
export function candidateFromChoice(choice: FoodChoice): FoodCandidate {
  return {
    key: JSON.stringify(choice.ref),
    ref: choice.ref,
    method: "manual",
    source: choice.source,
    name: choice.name,
    brand: choice.brand,
    sourceLabel: foodSourceLabel(choice.source),
    attribution: choice.attribution,
    basis: choice.basis,
    nutrientsPerBasis: choice.nutrientsPerBasis,
    missing: missingSummary(choice.nutrientsPerBasis),
    lastAmount: choice.lastAmount ?? null,
    lastUnit: choice.lastUnit ?? null,
    lastSlot: choice.lastSlot ?? null,
  };
}

/** Prefer a supported last portion, then a real serving, then the nutrient basis. */
export function defaultFoodPortion(
  candidate: Pick<FoodCandidate, "basis" | "lastAmount" | "lastUnit">,
): { amount: number; unit: AmountUnit } {
  const supported = unitsFor(candidate.basis);
  if (
    candidate.lastAmount &&
    candidate.lastAmount > 0 &&
    candidate.lastUnit &&
    supported.includes(candidate.lastUnit)
  )
    return { amount: candidate.lastAmount, unit: candidate.lastUnit };
  if (
    candidate.basis.servingSizeAmount &&
    candidate.basis.servingSizeAmount > 0 &&
    supported.includes("serving")
  )
    return { amount: 1, unit: "serving" };
  return { amount: candidate.basis.nutrientBasisAmount, unit: candidate.basis.nutrientBasisUnit };
}

/**
 * A `nutritionFoods` search or barcode result. `null` for a product with no
 * name upstream: it cannot be logged as-is and goes to a manual draft.
 */
export function candidateFromResult(
  result: FoodResult,
  method: Exclude<CandidateMethod, "manual">,
): FoodCandidate | null {
  if (!result.name) return null;
  return {
    key: result.id,
    ref: { kind: "catalog", id: result.id },
    method,
    source: result.source,
    name: result.name,
    brand: result.brand,
    sourceLabel: resultSourceLabel(result.source, result.origin),
    attribution: result.attribution?.notice ?? null,
    basis: result.basis,
    nutrientsPerBasis: result.nutrients,
    missing: missingSummary(result.nutrients),
  };
}

/** One line naming summary values the source left blank, or `null` when all are present. */
export function missingDataNote(
  candidate: Pick<FoodCandidate, "missing">,
  i18n: I18n,
): string | null {
  if (candidate.missing.length === 0) return null;
  const list = candidate.missing.map((label) => i18n._(label)).join(", ");
  return i18n._(msg`Not provided by the source: ${list}. Shown as unknown.`);
}

/** Search text the server accepts (2–100 characters after trimming). */
export function isSearchable(query: string): boolean {
  const trimmed = query.trim();
  return trimmed.length >= 2 && trimmed.length <= 100;
}

/**
 * Search results as candidates, dropping private foods already listed from
 * the device's saved foods (`knownIds` holds their `custom:<id>`) and
 * nameless products.
 */
export function searchCandidates(
  results: readonly FoodResult[],
  knownIds: ReadonlySet<string> = new Set(),
): FoodCandidate[] {
  return results
    .filter((result) => !knownIds.has(result.id))
    .map((result) => candidateFromResult(result, "search"))
    .filter((candidate): candidate is FoodCandidate => candidate !== null);
}

// ─── Barcodes ─────────────────────────────────────────────────

/**
 * Digits-only barcode from typed or scanned text: spaces and dashes are
 * ignored, 8–14 digits required. Mirrors `normalizeBarcode` in
 * `@openvalens/nutrition` (a parity test keeps them aligned); the server
 * validates again.
 */
export function parseBarcode(
  raw: string,
): { ok: true; barcode: string } | { ok: false; error: MessageDescriptor } {
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^\d{8,14}$/.test(digits)) return { ok: false, error: BARCODE_COPY.invalid };
  return { ok: true, barcode: digits };
}

/**
 * GS1 store and variable-measure codes (GTIN-13 prefixes 02 and 20–29,
 * UPC-A number system 2): their digits encode a price or weight, not a
 * product. Mirrors `isVariableMeasureBarcode` in `@openvalens/nutrition`.
 */
export function isVariableMeasureBarcode(barcode: string): boolean {
  if (barcode.length < 12) return false;
  const gtin14 = barcode.padStart(14, "0");
  return gtin14[1] === "2" || gtin14.slice(1, 3) === "02";
}

export type ManualDraftReason =
  | "no_match"
  | "variable_measure"
  | "unavailable"
  | "unnamed"
  | "offline";

/** What the barcode panel shows after a lookup. */
export type BarcodeOutcome =
  | {
      kind: "matches";
      barcode: string;
      candidates: FoodCandidate[];
      /** Set when the matches come from this device's cache (offline). */
      cachedAt: number | null;
      message: MessageDescriptor;
    }
  | {
      kind: "manual";
      /** Code to prefill on the draft; `null` for store/weighed-item codes. */
      barcode: string | null;
      reason: ManualDraftReason;
      message: MessageDescriptor;
      /** The lookup itself may succeed later (source unreachable or offline). */
      canRetry: boolean;
    };

function manual(
  barcode: string,
  reason: ManualDraftReason,
  canRetry = false,
): Extract<BarcodeOutcome, { kind: "manual" }> {
  return {
    kind: "manual",
    barcode: reason === "variable_measure" ? null : barcode,
    reason,
    message: BARCODE_COPY.manual[reason],
    canRetry,
  };
}

/** Turns a `nutritionFoods.lookupBarcode` result into what the member sees next. */
export function describeBarcodeLookup(
  result: BarcodeLookup,
  cachedAt: number | null = null,
): BarcodeOutcome {
  const candidates = result.matches
    .map((match) => candidateFromResult(match, "barcode"))
    .filter((candidate): candidate is FoodCandidate => candidate !== null);
  if (candidates.length > 0)
    return {
      kind: "matches",
      barcode: result.barcode,
      candidates,
      cachedAt,
      message:
        cachedAt === null
          ? BARCODE_COPY.found(candidates.length)
          : BARCODE_COPY.foundCached(candidates.length),
    };
  if (result.manualDraft?.reason === "variable_measure")
    return manual(result.barcode, "variable_measure");
  if (result.matches.length > 0) return manual(result.barcode, "unnamed");
  if (result.live.status === "unavailable") return manual(result.barcode, "unavailable", true);
  return manual(result.barcode, "no_match");
}

/**
 * Offline lookup (mobile): a code this device looked up before resolves to
 * the cached candidates, labelled as cached; anything else is a manual draft
 * that says no match is available offline. Nothing is guessed.
 */
export function describeOfflineBarcode(
  barcode: string,
  cached: { data: BarcodeLookup; savedAt: number } | null,
): BarcodeOutcome {
  if (isVariableMeasureBarcode(barcode)) return manual(barcode, "variable_measure");
  if (cached && cached.data.barcode === barcode) {
    const outcome = describeBarcodeLookup(cached.data, cached.savedAt);
    if (outcome.kind === "matches") return outcome;
  }
  return manual(barcode, "offline", true);
}

/** Empty manual-draft fields with the barcode prefilled; values stay blank (unknown). */
export function manualDraftFields(barcode: string | null): QuickAddFields {
  return {
    name: "",
    basisAmount: "100",
    basisUnit: "g",
    nutrients: {},
    barcode: barcode ?? "",
  };
}

export const BARCODE_COPY = Object.freeze({
  mode: msg`Barcode`,
  scan: msg`Scan barcode`,
  stopScan: msg`Stop scanning`,
  digitsLabel: msg`Barcode digits`,
  lookUp: msg`Look up`,
  lookingUp: msg`Looking up…`,
  invalid: msg`Enter the 8 to 14 digits printed under the barcode.`,
  enterManually: msg`Enter food manually`,
  notThisProduct: msg`Enter the food from its label instead.`,
  retry: msg`Try lookup again`,
  verify: msg`Check the product, source and amount. Nothing is saved until you press Save.`,
  manualNote: msg`Enter values from the label. Leave anything you do not know blank; it is shown as unknown, not zero.`,
  barcodeOnDraft: msg`Barcode (kept with this food)`,
  found: (count: number): MessageDescriptor =>
    msg`${plural(count, {
      one: "# match found. Check it before saving.",
      other: "# matches found. Pick one and check it before saving.",
    })}`,
  foundCached: (count: number): MessageDescriptor =>
    msg`Offline. ${plural(count, { one: "# match", other: "# matches" })} saved on this device from an earlier lookup; the source may have changed since.`,
  manual: Object.freeze({
    no_match: msg`No match for this barcode. Enter the food from its label instead.`,
    variable_measure: msg`This is a store or weighed-item code, so it does not identify a product. Enter the food from its label instead.`,
    unavailable: msg`The food source could not be reached. Try the lookup again later, or enter the food from its label.`,
    unnamed: msg`The source has this barcode but no product name. Enter the food from its label instead.`,
    offline: msg`Offline. No match for this barcode is saved on this device. Enter the food from its label, or look it up when you are back online.`,
  } satisfies Record<ManualDraftReason, MessageDescriptor>),
  cameraPrompt: msg`The camera is used only while you scan. Nothing is recorded.`,
  cameraDenied: msg`Camera access is required to scan a barcode. Type the digits instead, or allow access in Settings.`,
  cameraUnavailable: msg`Scanning is not available on this device. Type the barcode digits instead.`,
  cameraFailed: msg`The camera could not start. Type the barcode digits instead.`,
  webNoCamera: msg`Type the digits printed under the barcode. Camera scanning is available in the mobile app.`,
  scanned: (barcode: string): MessageDescriptor => msg`Scanned ${barcode}. Looking it up.`,
  searchLabel: msg`Search foods`,
  searchHint: msg`Type at least 2 characters to search food databases too.`,
  searchOffline: msg`Offline. Searching food databases needs a connection; showing foods saved on this device.`,
  searchEmpty: msg`No foods match this search.`,
  searchFailed: msg`Could not search food databases. Showing foods saved on this device.`,
  savedFoods: msg`Saved and recent`,
  searchResults: msg`Food databases`,
});
