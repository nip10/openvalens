import type { Database } from "@openvalens/db";
import { nutritionFood } from "@openvalens/db/schema/nutrition";
import { and, asc, eq, ilike, isNull, or, type SQL } from "drizzle-orm";

import {
  catalogAttribution,
  catalogFoodToSnapshotInput,
  createFoodCatalog,
  parseCatalogFoodId,
  type CatalogAttribution,
  type CatalogFood,
} from "./catalog/repository";
import type { OffProductRecord } from "./catalog/record";
import { CATALOG_SOURCES } from "./catalog/sources";
import { NutritionError } from "./errors";
import type { FoodLookupProvider } from "./food-lookup";
import { micronutrientsOf, type MicronutrientValues } from "./micronutrients";
import { nutrientsOf, type NutrientBasis, type NutrientValues } from "./nutrients";
import type { CustomFood, LogEntryInput, NutritionScope } from "./repository";
import { normalizeBarcode, sourceQualifiedId } from "./snapshot";

/**
 * Tenant-scoped food search and barcode lookup (Issue #69).
 *
 * Combines three kinds of source at query time without ever merging them:
 *
 * - `custom` — the member's own private foods (#74), filtered by the
 *   session-derived `NutritionScope` (organization *and* user). Another member
 *   or organization cannot see them, by search, barcode or id.
 * - `fdc` / `off` — the instance-wide public catalog mirrors (#72), which are
 *   reference data, not tenant rows.
 * - optional live Open Food Facts lookup for barcodes the local sources miss
 *   (`foodLookup` integration, off by default).
 *
 * Every result keeps its source-qualified id, source version, basis, units,
 * nullable nutrients (unknown stays `null`) and attribution. Search text and
 * barcodes are never logged or echoed into error messages.
 */

export const FOOD_SOURCES = ["custom", ...CATALOG_SOURCES] as const;
export type FoodSource = (typeof FOOD_SOURCES)[number];

/** Where a result came from: the member's private foods, a catalog mirror, or a live lookup. */
export type FoodOrigin = "private" | "catalog" | "live";

export type FoodResult = {
  /** Source-qualified id: `custom:42`, `fdc:123456` or `off:3017620422003`. */
  id: string;
  source: FoodSource;
  sourceFoodId: string;
  /** Custom-food revision, FDC release, or OFF last-modified time (ISO). */
  sourceVersion: string;
  origin: FoodOrigin;
  /** FDC data type; `null` for other sources. */
  dataType: string | null;
  /** `null` only for OFF products with no name upstream (log them as a manual draft). */
  name: string | null;
  brand: string | null;
  barcode: string | null;
  basis: NutrientBasis;
  /** Per-basis values; `null` = not provided. */
  nutrients: NutrientValues;
  /** Optional micronutrients (#78), per basis; `null` = not provided. */
  micronutrients: MicronutrientValues;
  /** Source license/notice; `null` for private custom foods. Show `notice` with every result. */
  attribution: CatalogAttribution | null;
  /** Catalog release the record was imported in; `null` for custom foods and live lookups. */
  release: CatalogFood["release"] | null;
  /** OFF operator overlay rows applied to a mirror record. */
  overlay: { ids: number[] } | null;
};

export type FoodSearchInput = {
  query: string;
  /** Defaults to every source. */
  sources?: readonly FoodSource[];
  /** Maximum results per source (1–50, default 20). */
  limit?: number;
};

export type LiveLookupStatus = {
  /**
   * - `off` — no live provider is configured; nothing was sent.
   * - `skipped` — a local source matched, or the code is a store/variable-measure
   *   code; nothing was sent.
   * - `found` / `not_found` — the provider answered (possibly from its cache).
   * - `unavailable` — timeout, rate limit or upstream error; retry later or log manually.
   */
  status: "off" | "skipped" | "found" | "not_found" | "unavailable";
  reason: "timeout" | "rate_limited" | "upstream_error" | "invalid_response" | null;
  retryAfterSeconds: number | null;
};

export type BarcodeLookupResult = {
  /** The normalized digits-only code. */
  barcode: string;
  status: "found" | "not_found";
  /** Private, then FDC, then OFF mirror, then live OFF; each its own attributed result. */
  matches: FoodResult[];
  live: LiveLookupStatus;
  /**
   * Present on a miss: the client should offer a user-confirmed manual food
   * draft. `barcode` is `null` for store/variable-measure codes, whose digits
   * encode a price or weight rather than a product.
   */
  manualDraft: { barcode: string | null; reason: "no_match" | "variable_measure" } | null;
};

/** A live source could not answer (timeout, rate limit, upstream error). Retryable. */
export class FoodSourceUnavailableError extends Error {
  readonly reason: NonNullable<LiveLookupStatus["reason"]>;
  readonly retryAfterSeconds: number | null;

  constructor(reason: FoodSourceUnavailableError["reason"], retryAfterSeconds: number | null) {
    super("Food source is unavailable");
    this.name = "FoodSourceUnavailableError";
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const SEARCH_MIN = 2;
const SEARCH_MAX = 100;
const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 50;
const BARCODE_MATCH_LIMIT = 10;

const NOT_SENT: LiveLookupStatus = { status: "skipped", reason: null, retryAfterSeconds: null };
const LIVE_OFF: LiveLookupStatus = { status: "off", reason: null, retryAfterSeconds: null };

/**
 * GS1 restricted-circulation numbers (store and variable-measure codes):
 * GTIN-13 prefixes 02 and 20–29, and UPC-A number system 2. Their digits carry
 * an in-store item number plus a price or weight, so they never identify a
 * product in a public catalog and must not be sent upstream. EAN-8/UPC-E
 * codes are not classified here (UPC-E commonly starts with 0).
 */
export function isVariableMeasureBarcode(barcode: string): boolean {
  if (barcode.length < 12) return false;
  const gtin14 = barcode.padStart(14, "0");
  return gtin14[1] === "2" || gtin14.slice(1, 3) === "02";
}

/** Parses `custom:<id>`; `null` for any other prefix. Throws for a malformed custom id. */
function parseCustomFoodId(id: string): number | null {
  const trimmed = id.trim();
  if (!trimmed.startsWith("custom:")) return null;
  const match = /^custom:([1-9][0-9]{0,9})$/.exec(trimmed);
  const value = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(value) || value > 2_147_483_647)
    throw new NutritionError("INVALID_INPUT", "Custom food id must be custom:<id>");
  return value;
}

function basisOf(row: NutrientBasis): NutrientBasis {
  return {
    nutrientBasisAmount: row.nutrientBasisAmount,
    nutrientBasisUnit: row.nutrientBasisUnit,
    servingSizeAmount: row.servingSizeAmount,
    servingSizeUnit: row.servingSizeUnit,
    servingLabel: row.servingLabel,
  };
}

function customResult(row: CustomFood): FoodResult {
  return {
    id: sourceQualifiedId("custom", String(row.id)),
    source: "custom",
    sourceFoodId: String(row.id),
    sourceVersion: String(row.revision),
    origin: "private",
    dataType: null,
    name: row.name,
    brand: row.brand,
    barcode: row.barcode,
    basis: basisOf(row),
    nutrients: nutrientsOf(row),
    micronutrients: micronutrientsOf(row),
    attribution: null,
    release: null,
    overlay: null,
  };
}

function catalogResult(food: CatalogFood): FoodResult {
  return { ...food, origin: "catalog" };
}

/** A live OFF record, unmodified; operator overlays apply to the mirror only. */
function liveResult(record: OffProductRecord): FoodResult {
  return {
    id: sourceQualifiedId("off", record.code),
    source: "off",
    sourceFoodId: record.code,
    sourceVersion: record.lastModifiedAt.toISOString(),
    origin: "live",
    dataType: null,
    name: record.name,
    brand: record.brand,
    barcode: record.barcode,
    basis: basisOf(record),
    nutrients: nutrientsOf(record),
    micronutrients: micronutrientsOf(record),
    attribution: catalogAttribution("off"),
    release: null,
    overlay: null,
  };
}

/** `ILIKE` pattern matching `text` literally anywhere. */
function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function assertSearchInput(input: FoodSearchInput) {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (query.length < SEARCH_MIN || query.length > SEARCH_MAX)
    throw new NutritionError(
      "INVALID_INPUT",
      `Search text must be ${SEARCH_MIN} to ${SEARCH_MAX} characters`,
    );
  const limit = input.limit ?? LIMIT_DEFAULT;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT_MAX)
    throw new NutritionError("INVALID_INPUT", `Limit must be 1 to ${LIMIT_MAX}`);
  const sources = new Set(input.sources ?? FOOD_SOURCES);
  if (![...sources].every((source) => (FOOD_SOURCES as readonly string[]).includes(source)))
    throw new NutritionError("INVALID_INPUT", "Unsupported food source");
  return { query, limit, sources };
}

/**
 * The `food` argument for `NutritionRepository.logEntry` (#74) for a result
 * the server itself resolved (never client-supplied nutrient values). Custom
 * foods are snapshotted from their current row; catalog and live results are
 * copied with source, version and attribution. Throws `INVALID_INPUT` for a
 * nameless OFF product — the client must offer a manual draft instead.
 */
export function foodResultToLogFood(food: FoodResult): LogEntryInput["food"] {
  if (food.source === "custom") return { kind: "custom", foodId: Number(food.sourceFoodId) };
  if (food.name === null)
    throw new NutritionError("INVALID_INPUT", "Catalog food has no name to log");
  if (food.release !== null && food.attribution !== null)
    return {
      kind: "external",
      snapshot: catalogFoodToSnapshotInput({
        ...food,
        source: food.source,
        release: food.release,
        attribution: food.attribution,
      }),
    };
  return {
    kind: "external",
    snapshot: {
      source: food.source,
      sourceFoodId: food.sourceFoodId,
      sourceVersion: food.sourceVersion,
      attribution: food.attribution?.notice ?? null,
      name: food.name,
      brand: food.brand,
      barcode: food.barcode,
      ...food.basis,
      nutrients: food.nutrients,
      micronutrients: food.micronutrients,
    },
  };
}

export type FoodSearchOptions = {
  /** Live barcode lookup; `null`/omitted keeps lookups local. */
  liveLookup?: FoodLookupProvider | null;
};

export function createFoodSearch(db: Database, options: FoodSearchOptions = {}) {
  const catalog = createFoodCatalog(db);
  const liveLookup = options.liveLookup ?? null;

  const ownFoods = (scope: NutritionScope, where: SQL | undefined) =>
    and(
      eq(nutritionFood.organizationId, scope.organizationId),
      eq(nutritionFood.userId, scope.userId),
      isNull(nutritionFood.archivedAt),
      where,
    );

  const findOwnFoods = (scope: NutritionScope, where: SQL | undefined, limit: number) =>
    db
      .select()
      .from(nutritionFood)
      .where(ownFoods(scope, where))
      .orderBy(asc(nutritionFood.name), asc(nutritionFood.id))
      .limit(limit);

  return {
    /**
     * Case-insensitive substring match on name or brand, grouped by source
     * (private, FDC, OFF). No relevance or completeness guarantee; there is no
     * live search.
     */
    async search(scope: NutritionScope, input: FoodSearchInput): Promise<FoodResult[]> {
      const { query, limit, sources } = assertSearchInput(input);
      const results: FoodResult[] = [];
      if (sources.has("custom")) {
        const pattern = containsPattern(query);
        const rows = await findOwnFoods(
          scope,
          or(ilike(nutritionFood.name, pattern), ilike(nutritionFood.brand, pattern)),
          limit,
        );
        results.push(...rows.map(customResult));
      }
      const catalogSources = CATALOG_SOURCES.filter((source) => sources.has(source));
      if (catalogSources.length)
        results.push(
          ...(await catalog.searchFoods({ query, sources: catalogSources, limit })).map(
            catalogResult,
          ),
        );
      return results;
    },

    /**
     * One food by source-qualified id, or `null` when it does not exist *for
     * this member* (another member's custom food is indistinguishable from a
     * missing one). An `off:` id the mirror lacks is resolved through the live
     * provider when one is configured; an unreachable provider throws
     * {@link FoodSourceUnavailableError}.
     */
    async getFood(scope: NutritionScope, id: string): Promise<FoodResult | null> {
      if (typeof id !== "string") throw new NutritionError("INVALID_INPUT", "Food id must be text");
      const customId = parseCustomFoodId(id);
      if (customId !== null) {
        const [row] = await findOwnFoods(scope, eq(nutritionFood.id, customId), 1);
        return row ? customResult(row) : null;
      }
      const { source, sourceFoodId } = parseCatalogFoodId(id);
      const food = await catalog.getFood(id);
      if (food) return catalogResult(food);
      if (source !== "off" || !liveLookup || isVariableMeasureBarcode(sourceFoodId)) return null;
      const live = await liveLookup.lookup(sourceFoodId);
      if (live.status === "unavailable")
        throw new FoodSourceUnavailableError(live.reason, live.retryAfterSeconds);
      return live.status === "found" ? liveResult(live.record) : null;
    },

    /**
     * Resolves a scanned or typed barcode. A miss is a normal, typed result
     * with a manual-draft hint, never an error; only a malformed code throws
     * `INVALID_INPUT`. The live provider is asked only when every local
     * source missed, and its failure degrades to `live.status: "unavailable"`
     * so a lookup can never block manual logging.
     */
    async lookupBarcode(scope: NutritionScope, raw: string): Promise<BarcodeLookupResult> {
      if (typeof raw !== "string")
        throw new NutritionError("INVALID_INPUT", "Barcode must be 8 to 14 digits");
      const barcode = normalizeBarcode(raw);
      if (isVariableMeasureBarcode(barcode))
        return {
          barcode,
          status: "not_found",
          matches: [],
          live: NOT_SENT,
          manualDraft: { barcode: null, reason: "variable_measure" },
        };

      const own = await findOwnFoods(
        scope,
        eq(nutritionFood.barcode, barcode),
        BARCODE_MATCH_LIMIT,
      );
      const matches = [
        ...own.map(customResult),
        ...(await catalog.lookupBarcode(barcode)).map(catalogResult),
      ];

      let live: LiveLookupStatus = liveLookup ? NOT_SENT : LIVE_OFF;
      if (!matches.length && liveLookup) {
        const result = await liveLookup.lookup(barcode);
        if (result.status === "found") {
          matches.push(liveResult(result.record));
          live = { status: "found", reason: null, retryAfterSeconds: null };
        } else if (result.status === "not_found") {
          live = { status: "not_found", reason: null, retryAfterSeconds: null };
        } else {
          live = {
            status: "unavailable",
            reason: result.reason,
            retryAfterSeconds: result.retryAfterSeconds,
          };
        }
      }

      return {
        barcode,
        status: matches.length ? "found" : "not_found",
        matches,
        live,
        manualDraft: matches.length ? null : { barcode, reason: "no_match" },
      };
    },
  };
}

export type FoodSearch = ReturnType<typeof createFoodSearch>;
