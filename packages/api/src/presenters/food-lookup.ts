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
import type {
  FoodChoice,
  FoodRef,
  NutrientBasis,
  NutrientValues,
} from "../contracts/nutrition-diary";
import type { BarcodeLookup, FoodOrigin, FoodResult } from "../contracts/nutrition-foods";
import {
  NUTRIENT_LABELS,
  SUMMARY_NUTRIENTS,
  foodSourceLabel,
  type QuickAddFields,
} from "./nutrition-diary";

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
  sourceLabel: string;
  /** Source notice to show with the candidate (always set for OFF data). */
  attribution: string | null;
  basis: NutrientBasis;
  nutrientsPerBasis: NutrientValues;
  /** Summary nutrients the source did not provide (shown as unknown). */
  missing: string[];
};

function missingSummary(values: NutrientValues): string[] {
  return SUMMARY_NUTRIENTS.filter((key) => values[key] === null).map(
    (key) => NUTRIENT_LABELS[key].label,
  );
}

function originSuffix(origin: FoodOrigin): string {
  return origin === "live" ? " (live lookup)" : "";
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
  };
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
    sourceLabel: `${foodSourceLabel(result.source)}${originSuffix(result.origin)}`,
    attribution: result.attribution?.notice ?? null,
    basis: result.basis,
    nutrientsPerBasis: result.nutrients,
    missing: missingSummary(result.nutrients),
  };
}

/** One line naming summary values the source left blank, or `null` when all are present. */
export function missingDataNote(candidate: Pick<FoodCandidate, "missing">): string | null {
  if (candidate.missing.length === 0) return null;
  return `Not provided by the source: ${candidate.missing.join(", ")}. Shown as unknown.`;
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
): { ok: true; barcode: string } | { ok: false; error: string } {
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
      message: string;
    }
  | {
      kind: "manual";
      /** Code to prefill on the draft; `null` for store/weighed-item codes. */
      barcode: string | null;
      reason: ManualDraftReason;
      message: string;
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
  mode: "Barcode",
  scan: "Scan barcode",
  stopScan: "Stop scanning",
  digitsLabel: "Barcode digits",
  lookUp: "Look up",
  lookingUp: "Looking up…",
  invalid: "Enter the 8 to 14 digits printed under the barcode.",
  enterManually: "Enter food manually",
  notThisProduct: "Enter the food from its label instead.",
  retry: "Try lookup again",
  verify: "Check the product, source and amount. Nothing is saved until you press Save.",
  manualNote:
    "Enter values from the label. Leave anything you do not know blank; it is shown as unknown, not zero.",
  barcodeOnDraft: "Barcode (kept with this food)",
  found: (count: number) =>
    count === 1
      ? "1 match found. Check it before saving."
      : `${count} matches found. Pick one and check it before saving.`,
  foundCached: (count: number) =>
    `Offline. ${count === 1 ? "1 match" : `${count} matches`} saved on this device from an earlier lookup; the source may have changed since.`,
  manual: Object.freeze({
    no_match: "No match for this barcode. Enter the food from its label instead.",
    variable_measure:
      "This is a store or weighed-item code, so it does not identify a product. Enter the food from its label instead.",
    unavailable:
      "The food source could not be reached. Try the lookup again later, or enter the food from its label.",
    unnamed:
      "The source has this barcode but no product name. Enter the food from its label instead.",
    offline:
      "Offline. No match for this barcode is saved on this device. Enter the food from its label, or look it up when you are back online.",
  } satisfies Record<ManualDraftReason, string>),
  cameraPrompt: "The camera is used only while you scan. Nothing is recorded.",
  cameraDenied:
    "Camera access is required to scan a barcode. Type the digits instead, or allow access in Settings.",
  cameraUnavailable: "Scanning is not available on this device. Type the barcode digits instead.",
  cameraFailed: "The camera could not start. Type the barcode digits instead.",
  webNoCamera:
    "Type the digits printed under the barcode. Camera scanning is available in the mobile app.",
  scanned: (barcode: string) => `Scanned ${barcode}. Looking it up.`,
  searchLabel: "Search foods",
  searchHint: "Type at least 2 characters to search food databases too.",
  searchOffline:
    "Offline. Searching food databases needs a connection; showing foods saved on this device.",
  searchEmpty: "No foods match this search.",
  searchFailed: "Could not search food databases. Showing foods saved on this device.",
  savedFoods: "Saved and recent",
  searchResults: "Food databases",
});
