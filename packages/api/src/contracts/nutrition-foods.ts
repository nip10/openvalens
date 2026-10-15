import { z } from "zod";

import { NUTRIENT_KEYS, type NutrientKey } from "./nutrition-diary";

/**
 * `nutritionFoods.*` wire contract (Issues #69, #75). Shared by the server
 * router and the web/mobile food search and barcode flows, so this file
 * imports only `zod` (a parity test keeps the enums aligned with
 * `@openvalens/nutrition`).
 *
 * Inputs are strict: no tenant or member id can be supplied. Search text and
 * barcodes are never logged, audited or echoed in errors.
 */

export const FOOD_SOURCES = ["custom", "fdc", "off"] as const;
export type FoodSource = (typeof FOOD_SOURCES)[number];

export const FOOD_ORIGINS = ["private", "catalog", "live"] as const;
export type FoodOrigin = (typeof FOOD_ORIGINS)[number];

export const searchFoodsInput = z.strictObject({
  query: z.string().trim().min(2).max(100),
  sources: z.array(z.enum(FOOD_SOURCES)).min(1).max(FOOD_SOURCES.length).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export type SearchFoodsInput = z.infer<typeof searchFoodsInput>;

export const getFoodInput = z.strictObject({ id: z.string().trim().min(1).max(64) });

export const lookupBarcodeInput = z.strictObject({ barcode: z.string().min(1).max(32) });
export type LookupBarcodeInput = z.infer<typeof lookupBarcodeInput>;

const nutrientsShape = z.object(
  Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, z.number().nullable()])) as Record<
    NutrientKey,
    z.ZodNullable<z.ZodNumber>
  >,
);

export const foodResult = z.object({
  /** Source-qualified id: `custom:42`, `fdc:123456` or `off:3017620422003`. */
  id: z.string(),
  source: z.enum(FOOD_SOURCES),
  sourceFoodId: z.string(),
  sourceVersion: z.string(),
  origin: z.enum(FOOD_ORIGINS),
  dataType: z.string().nullable(),
  /** `null` only for OFF products with no name upstream (log them as a manual draft). */
  name: z.string().nullable(),
  brand: z.string().nullable(),
  barcode: z.string().nullable(),
  basis: z.object({
    nutrientBasisAmount: z.number(),
    nutrientBasisUnit: z.enum(["g", "ml", "serving"]),
    servingSizeAmount: z.number().nullable(),
    servingSizeUnit: z.enum(["g", "ml"]).nullable(),
    servingLabel: z.string().nullable(),
  }),
  /** Per-basis values; `null` = not provided by the source. */
  nutrients: nutrientsShape,
  /** Source license/notice; `null` for private custom foods. Show `notice` with every result. */
  attribution: z
    .object({
      source: z.enum(["fdc", "off"]),
      sourceName: z.string(),
      homepage: z.string(),
      license: z.enum(["CC0-1.0", "ODbL-1.0"]),
      licenseUrl: z.string(),
      notice: z.string(),
    })
    .nullable(),
  release: z
    .object({
      id: z.number(),
      dataset: z.string(),
      version: z.string(),
      artifact: z.string(),
      artifactSha256: z.string(),
      sourceUrl: z.string(),
      importedAt: z.date(),
    })
    .nullable(),
  overlay: z.object({ ids: z.array(z.number()) }).nullable(),
});
export type FoodResult = z.infer<typeof foodResult>;

export const searchFoodsOutput = z.object({ results: z.array(foodResult) });

export const LIVE_LOOKUP_STATUSES = [
  "off",
  "skipped",
  "found",
  "not_found",
  "unavailable",
] as const;
export const LIVE_LOOKUP_REASONS = [
  "timeout",
  "rate_limited",
  "upstream_error",
  "invalid_response",
] as const;
export const MANUAL_DRAFT_REASONS = ["no_match", "variable_measure"] as const;
export type ManualDraftReason = (typeof MANUAL_DRAFT_REASONS)[number];

export const lookupBarcodeOutput = z.object({
  /** The normalized digits-only code. */
  barcode: z.string(),
  status: z.enum(["found", "not_found"]),
  /** Private, then FDC, then OFF mirror, then live OFF; each its own attributed result. */
  matches: z.array(foodResult),
  live: z.object({
    status: z.enum(LIVE_LOOKUP_STATUSES),
    reason: z.enum(LIVE_LOOKUP_REASONS).nullable(),
    retryAfterSeconds: z.number().nullable(),
  }),
  /**
   * Present on a miss: offer a user-confirmed manual draft. `barcode` is
   * `null` for store/variable-measure codes (their digits encode a price or
   * weight, not a product).
   */
  manualDraft: z
    .object({
      barcode: z.string().nullable(),
      reason: z.enum(MANUAL_DRAFT_REASONS),
    })
    .nullable(),
});
export type BarcodeLookup = z.infer<typeof lookupBarcodeOutput>;
