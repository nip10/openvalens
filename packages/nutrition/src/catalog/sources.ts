/**
 * Public food catalog sources (Issue #72) and their license/attribution
 * terms. These strings are the single source for every notice the app shows
 * or exports with catalog data; see `DATA-LICENSES.md`.
 *
 * - USDA FoodData Central is CC0 1.0 (public domain dedication). USDA asks
 *   for attribution, which we always give.
 * - Open Food Facts is a database under ODbL 1.0 whose individual contents
 *   are under DbCL 1.0. The notice below must appear on every OFF-backed
 *   product view and search result, in About/Settings and in export footers.
 *   Product images (CC BY-SA) are never stored.
 */

export const CATALOG_SOURCES = ["fdc", "off"] as const;
export type CatalogSource = (typeof CATALOG_SOURCES)[number];

export type CatalogSourceTerms = {
  source: CatalogSource;
  name: string;
  homepage: string;
  /** SPDX id of the dataset license, stored on every release row. */
  license: "CC0-1.0" | "ODbL-1.0";
  licenseUrl: string;
  /** License of individual contents, when it differs from the database's. */
  contentsLicense: { spdx: string; url: string } | null;
  /** Notice shown with any data from this source. */
  notice: string;
  /** Whether a derived/filtered copy must itself be offered under the same license. */
  shareAlike: boolean;
};

export const CATALOG_SOURCE_TERMS: Readonly<Record<CatalogSource, CatalogSourceTerms>> =
  Object.freeze({
    fdc: Object.freeze({
      source: "fdc",
      name: "USDA FoodData Central",
      homepage: "https://fdc.nal.usda.gov/",
      license: "CC0-1.0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      contentsLicense: null,
      notice:
        "Source: U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov (CC0 1.0).",
      shareAlike: false,
    }),
    off: Object.freeze({
      source: "off",
      name: "Open Food Facts",
      homepage: "https://world.openfoodfacts.org/",
      license: "ODbL-1.0",
      licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
      contentsLicense: Object.freeze({
        spdx: "DbCL-1.0",
        url: "https://opendatacommons.org/licenses/dbcl/1-0/",
      }),
      notice:
        "Contains data from Open Food Facts (https://world.openfoodfacts.org/), available under the Open Database License (https://opendatacommons.org/licenses/odbl/1-0/).",
      shareAlike: true,
    }),
  });

export function isCatalogSource(value: unknown): value is CatalogSource {
  return typeof value === "string" && (CATALOG_SOURCES as readonly string[]).includes(value);
}
