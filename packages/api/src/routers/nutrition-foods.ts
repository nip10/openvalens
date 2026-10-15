import { NutritionError } from "@openvalens/nutrition/errors";
import {
  createFoodSearch,
  FoodSourceUnavailableError,
  type FoodSearch,
} from "@openvalens/nutrition/food-search";

import type { Context } from "../context";
import {
  foodResult,
  getFoodInput,
  lookupBarcodeInput,
  lookupBarcodeOutput,
  searchFoodsInput,
  searchFoodsOutput,
} from "../contracts/nutrition-foods";
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
    .use(validateInput(searchFoodsInput))
    .input(searchFoodsInput)
    .output(searchFoodsOutput)
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
    .use(validateInput(getFoodInput))
    .input(getFoodInput)
    .output(foodResult)
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
