import { NutritionError } from "@openvalens/nutrition/errors";
import {
  createFoodSearch,
  FOOD_SOURCES,
  FoodSourceUnavailableError,
  type FoodSearch,
} from "@openvalens/nutrition/food-search";
import { AMOUNT_UNITS, NUTRIENT_KEYS, SERVING_SIZE_UNITS } from "@openvalens/nutrition/nutrients";
import { z } from "zod";

import type { Context } from "../context";
import { permissionedProcedure, raiseApiError, validateInput } from "../index";

/**
 * Food search and barcode lookup (Issue #69), shared by web and mobile.
 *
 * - `nutritionFoods.search`        — the member's private custom foods plus the
 *   public FDC/OFF catalog mirrors, grouped by source, never merged.
 * - `nutritionFoods.get`           — one food by source-qualified id
 *   (`custom:42`, `fdc:123`, `off:<code>`); typed `NOT_FOUND` when absent.
 * - `nutritionFoods.lookupBarcode` — normalized barcode lookup. A miss is a
 *   typed result with a manual-draft hint (#75), never an error.
 *
 * All three are reads on `permissionedProcedure` (`records:read`). The
 * organization and member come from the session only; inputs are
 * `strictObject`, so no tenant or user id can be supplied. Private custom
 * foods are additionally scoped to the member, so other members of the same
 * organization cannot see them. Search text and barcodes are never logged,
 * audited or echoed in errors.
 */

const READ = { resource: "records", action: "read" } as const;

const searchInput = z.strictObject({
  query: z.string().trim().min(2).max(100),
  sources: z.array(z.enum(FOOD_SOURCES)).min(1).max(FOOD_SOURCES.length).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const getInput = z.strictObject({ id: z.string().trim().min(1).max(64) });

const lookupBarcodeInput = z.strictObject({ barcode: z.string().min(1).max(32) });

const nutrientsShape = z.object(
  Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, z.number().nullable()])) as Record<
    (typeof NUTRIENT_KEYS)[number],
    z.ZodNullable<z.ZodNumber>
  >,
);

const foodResultShape = z.object({
  id: z.string(),
  source: z.enum(FOOD_SOURCES),
  sourceFoodId: z.string(),
  sourceVersion: z.string(),
  origin: z.enum(["private", "catalog", "live"]),
  dataType: z.string().nullable(),
  name: z.string().nullable(),
  brand: z.string().nullable(),
  barcode: z.string().nullable(),
  basis: z.object({
    nutrientBasisAmount: z.number(),
    nutrientBasisUnit: z.enum(AMOUNT_UNITS),
    servingSizeAmount: z.number().nullable(),
    servingSizeUnit: z.enum(SERVING_SIZE_UNITS).nullable(),
    servingLabel: z.string().nullable(),
  }),
  nutrients: nutrientsShape,
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

const searchOutput = z.object({ results: z.array(foodResultShape) });

const lookupBarcodeOutput = z.object({
  barcode: z.string(),
  status: z.enum(["found", "not_found"]),
  matches: z.array(foodResultShape),
  live: z.object({
    status: z.enum(["off", "skipped", "found", "not_found", "unavailable"]),
    reason: z.enum(["timeout", "rate_limited", "upstream_error", "invalid_response"]).nullable(),
    retryAfterSeconds: z.number().nullable(),
  }),
  manualDraft: z
    .object({
      barcode: z.string().nullable(),
      reason: z.enum(["no_match", "variable_measure"]),
    })
    .nullable(),
});

type Authz = { activeOrganizationId: string; user: { id: string } };

function scopeOf(authz: Authz) {
  return { organizationId: authz.activeOrganizationId, userId: authz.user.id };
}

function foodSearch(context: Context): FoodSearch {
  return createFoodSearch(context.db, { liveLookup: context.foodLookup ?? null });
}

/**
 * Maps domain failures to the stable envelope. Domain messages name the rule
 * that failed, never the submitted text or code; anything else becomes a
 * generic `INTERNAL` with no detail.
 */
function toFoodError(error: unknown): Error {
  if (error instanceof NutritionError) {
    if (error.code === "NOT_FOUND") return raiseApiError("NOT_FOUND", "Food not found.");
    return raiseApiError("INVALID_INPUT", error.message);
  }
  if (error instanceof FoodSourceUnavailableError)
    return raiseApiError("SOURCE_UNAVAILABLE", "Food source is unavailable. Try again later.", {
      reason: error.reason,
      retryAfterSeconds: error.retryAfterSeconds,
    });
  return raiseApiError("INTERNAL", "Something went wrong.");
}

export const nutritionFoodsRouter = {
  /** Substring search over private foods and the catalog mirrors (no live search). */
  search: permissionedProcedure(READ)
    .use(validateInput(searchInput))
    .input(searchInput)
    .output(searchOutput)
    .handler(async ({ input, context }) => {
      try {
        return { results: await foodSearch(context).search(scopeOf(context.authz), input) };
      } catch (error) {
        throw toFoodError(error);
      }
    }),

  /**
   * One food by source-qualified id. Another member's custom food, an
   * archived custom food and an unknown catalog id all return `NOT_FOUND`.
   */
  get: permissionedProcedure(READ)
    .use(validateInput(getInput))
    .input(getInput)
    .output(foodResultShape)
    .handler(async ({ input, context }) => {
      let food;
      try {
        food = await foodSearch(context).getFood(scopeOf(context.authz), input.id);
      } catch (error) {
        throw toFoodError(error);
      }
      if (!food) throw raiseApiError("NOT_FOUND", "Food not found.");
      return food;
    }),

  /**
   * Barcode lookup for the diary/scanner. Malformed codes are `INVALID_INPUT`;
   * misses, store/variable-measure codes and live-source failures are typed
   * results that point the client at a manual draft.
   */
  lookupBarcode: permissionedProcedure(READ)
    .use(validateInput(lookupBarcodeInput))
    .input(lookupBarcodeInput)
    .output(lookupBarcodeOutput)
    .handler(async ({ input, context }) => {
      try {
        return await foodSearch(context).lookupBarcode(scopeOf(context.authz), input.barcode);
      } catch (error) {
        throw toFoodError(error);
      }
    }),
};
