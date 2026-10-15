import { NUTRIENT_KEYS, type NutrientKey, type NutrientValues } from "./nutrients";

/**
 * Daily nutrient totals with explicit coverage (Issue #79). Pure TypeScript
 * with no database import, so `@openvalens/api` presenters can share it with
 * the web and mobile bundles.
 *
 * Rules:
 * - A total sums only the values the logged foods provided. An unknown value
 *   (`null`) is counted as missing and never added as 0; a recorded 0 is
 *   reported data.
 * - Nothing is converted or inferred: salt stays apart from sodium, and
 *   total sugars apart from added/free sugars.
 * - A day with no entries has no totals ("not logged"), not zero totals.
 */

/**
 * How many of a day's entries provided a nutrient:
 * `full` all of them, `partial` some, `none` none, `no_entries` nothing logged.
 */
export const NUTRIENT_COVERAGE = ["full", "partial", "none", "no_entries"] as const;
export type NutrientCoverage = (typeof NUTRIENT_COVERAGE)[number];

/** A nutrient total over the entries that report it, plus how many do not. */
export type NutrientTotal = {
  /** Sum over entries with a value; `null` when no entry reports this nutrient. */
  known: number | null;
  /** Entries that report the nutrient (a recorded 0 counts as reported). */
  reported: number;
  /** Entries whose food did not provide the nutrient. */
  missing: number;
  coverage: NutrientCoverage;
};

export type NutrientTotals = {
  entryCount: number;
  totals: Record<NutrientKey, NutrientTotal>;
};

/** Where a day's logged foods came from; totals are estimates from these sources. */
export const TOTALS_FOOD_SOURCES = ["fdc", "off", "custom", "manual"] as const;
export type TotalsFoodSource = (typeof TOTALS_FOOD_SOURCES)[number];
export type FoodSourceCounts = Record<TotalsFoodSource, number>;

/** Totals plus provenance for a set of entries (one local day). */
export type NutrientSummary = NutrientTotals & { sources: FoodSourceCounts };

export function nutrientCoverage(reported: number, missing: number): NutrientCoverage {
  if (reported + missing === 0) return "no_entries";
  if (missing === 0) return "full";
  return reported === 0 ? "none" : "partial";
}

/** Sums known values per nutrient; unknown values are counted, never added as 0. */
export function summarizeNutrients(
  entries: readonly { nutrients: NutrientValues }[],
): NutrientTotals {
  const totals = Object.fromEntries(
    NUTRIENT_KEYS.map((key) => {
      let known: number | null = null;
      let reported = 0;
      let missing = 0;
      for (const entry of entries) {
        const value = entry.nutrients[key];
        if (value === null || value === undefined) {
          missing += 1;
        } else {
          known = (known ?? 0) + value;
          reported += 1;
        }
      }
      return [key, { known, reported, missing, coverage: nutrientCoverage(reported, missing) }];
    }),
  ) as Record<NutrientKey, NutrientTotal>;
  return { entryCount: entries.length, totals };
}

/** `summarizeNutrients` plus a count of entries per food source. */
export function summarizeEntries(
  entries: readonly { nutrients: NutrientValues; source: TotalsFoodSource }[],
): NutrientSummary {
  const sources = Object.fromEntries(
    TOTALS_FOOD_SOURCES.map((source) => [source, 0]),
  ) as FoodSourceCounts;
  for (const entry of entries) sources[entry.source] += 1;
  return { ...summarizeNutrients(entries), sources };
}
