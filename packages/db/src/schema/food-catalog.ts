import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import {
  basisChecks,
  basisColumns,
  micronutrientColumns,
  micronutrientsNonNegative,
  nutrientColumns,
  nutrientsNonNegative,
} from "./nutrition";

// ─── Public food catalogs (Issue #72) ─────────────────────────
//
// Instance-wide, read-only mirrors of public food databases. They hold no
// tenant or personal data (no organization_id / user_id) and are classified
// as `reference` in the data-rights registry.
//
// Each source keeps its own table and never merges into another source or
// into the tenant `nutrition_food` table; search and lookup union them at
// query time with a `source` column (see `@openvalens/nutrition/catalog`).
//
// - USDA FoodData Central (`fdc`): CC0 1.0, attribution requested.
// - Open Food Facts (`off`): database under ODbL 1.0, contents under DbCL 1.0.
//   The mirror table is a Collective Database next to FDC; any filtering or
//   correction lives in `nutrition_catalog_off_overlay`, never in the mirror,
//   so OFF-derived data stays separable and publishable under ODbL. Product
//   images (CC BY-SA) are not stored.
//
// Diary entries never reference these rows: logging copies a catalog food
// into a tenant `nutrition_food_snapshot`, so a refresh cannot rewrite
// history.

/**
 * One imported dataset artifact (import batch). Records the exact upstream
 * artifact, its SHA-256 and the license/attribution notice in force, so a
 * mirror row can always be traced to what it was imported from.
 */
export const nutritionCatalogRelease = pgTable(
  "nutrition_catalog_release",
  {
    id: serial("id").primaryKey(),
    source: text("source").$type<"fdc" | "off">().notNull(),
    /** Upstream dataset inside the source, e.g. `foundation`, `branded`, `products`. */
    dataset: text("dataset").notNull(),
    /** Upstream release id or dump date, e.g. `2025-04-24`. */
    version: text("version").notNull(),
    /** Upstream artifact file name as published. */
    artifact: text("artifact").notNull(),
    artifactSha256: text("artifact_sha256").notNull(),
    sourceUrl: text("source_url").notNull(),
    /** SPDX id of the dataset license (`CC0-1.0` / `ODbL-1.0`). */
    license: text("license").notNull(),
    /** Exact attribution notice shown with this release's data. */
    attribution: text("attribution").notNull(),
    recordCount: integer("record_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    importedAt: timestamp("imported_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    nutritionCatalogReleaseIdSourceUnique: uniqueIndex(
      "nutrition_catalog_release_id_source_key",
    ).on(table.id, table.source),
    nutritionCatalogReleaseArtifactUnique: uniqueIndex("nutrition_catalog_release_artifact_key").on(
      table.source,
      table.dataset,
      table.version,
      table.artifactSha256,
    ),
    nutritionCatalogReleaseSourceCheck: check(
      "nutrition_catalog_release_source_check",
      sql`(${table.source} = 'fdc' and ${table.license} = 'CC0-1.0') or (${table.source} = 'off' and ${table.license} = 'ODbL-1.0')`,
    ),
    nutritionCatalogReleaseSha256Check: check(
      "nutrition_catalog_release_sha256_check",
      sql`${table.artifactSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    nutritionCatalogReleaseTextCheck: check(
      "nutrition_catalog_release_text_check",
      sql`length(${table.dataset}) > 0 and length(${table.version}) > 0 and length(${table.artifact}) > 0 and length(${table.sourceUrl}) > 0 and length(${table.attribution}) > 0`,
    ),
    nutritionCatalogReleaseCountsCheck: check(
      "nutrition_catalog_release_counts_check",
      sql`${table.recordCount} >= 0 and ${table.rejectedCount} >= 0`,
    ),
  }),
);

/**
 * USDA FoodData Central foods (CC0 1.0). `fdc_id` is FDC's stable id; a
 * refresh replaces the row and its `release_id` / `source_version`. The
 * constant `source` column plus the composite release FK make it impossible
 * to file an FDC row under an Open Food Facts release.
 */
export const nutritionCatalogFdcFood = pgTable(
  "nutrition_catalog_fdc_food",
  {
    fdcId: text("fdc_id").primaryKey(),
    source: text("source").$type<"fdc">().notNull().default("fdc"),
    releaseId: integer("release_id").notNull(),
    /** FDC data type as published, e.g. `Foundation`, `SR Legacy`, `Branded`. */
    dataType: text("data_type").notNull(),
    /** Version of this record: the FDC release it was imported from. */
    sourceVersion: text("source_version").notNull(),
    name: text("name").notNull(),
    brand: text("brand"),
    /** Normalized digits-only GTIN/UPC (Branded foods). */
    barcode: text("barcode"),
    ...basisColumns(),
    ...nutrientColumns(),
    ...micronutrientColumns(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    nutritionCatalogFdcFoodBarcodeIdx: index("nutrition_catalog_fdc_food_barcode_idx")
      .on(table.barcode)
      .where(sql`${table.barcode} is not null`),
    nutritionCatalogFdcFoodReleaseIdx: index("nutrition_catalog_fdc_food_release_id_idx").on(
      table.releaseId,
    ),
    ...basisChecks("nutrition_catalog_fdc_food", table),
    nutritionCatalogFdcFoodSourceCheck: check(
      "nutrition_catalog_fdc_food_source_check",
      sql`${table.source} = 'fdc'`,
    ),
    nutritionCatalogFdcFoodIdCheck: check(
      "nutrition_catalog_fdc_food_fdc_id_check",
      sql`${table.fdcId} ~ '^[0-9]{1,12}$'`,
    ),
    nutritionCatalogFdcFoodNameCheck: check(
      "nutrition_catalog_fdc_food_name_check",
      sql`length(${table.name}) > 0`,
    ),
    nutritionCatalogFdcFoodBarcodeCheck: check(
      "nutrition_catalog_fdc_food_barcode_check",
      sql`${table.barcode} is null or ${table.barcode} ~ '^[0-9]{8,14}$'`,
    ),
    nutritionCatalogFdcFoodNutrientsCheck: check(
      "nutrition_catalog_fdc_food_nutrients_non_negative_check",
      nutrientsNonNegative(table),
    ),
    nutritionCatalogFdcFoodMicronutrientsCheck: check(
      "nutrition_catalog_fdc_food_micronutrients_non_negative_check",
      micronutrientsNonNegative(table),
    ),
    nutritionCatalogFdcFoodReleaseFk: foreignKey({
      columns: [table.releaseId, table.source],
      foreignColumns: [nutritionCatalogRelease.id, nutritionCatalogRelease.source],
      name: "nutrition_catalog_fdc_food_release_fk",
    }).onDelete("restrict"),
  }),
);

/**
 * Open Food Facts products (ODbL 1.0 / DbCL 1.0), mirrored unmodified apart
 * from mapping into the core nutrient columns. `code` is the OFF product
 * code; `last_modified_at` is OFF's `last_modified_t`. Never edited in place:
 * corrections go to `nutrition_catalog_off_overlay`.
 */
export const nutritionCatalogOffProduct = pgTable(
  "nutrition_catalog_off_product",
  {
    code: text("code").primaryKey(),
    source: text("source").$type<"off">().notNull().default("off"),
    releaseId: integer("release_id").notNull(),
    lastModifiedAt: timestamp("last_modified_at", { withTimezone: true, mode: "date" }).notNull(),
    /** OFF products may lack a name; it is never invented. */
    name: text("name"),
    brand: text("brand"),
    /** `code` normalized as a GTIN/EAN/UPC when it is one (8–14 digits). */
    barcode: text("barcode"),
    ...basisColumns(),
    ...nutrientColumns(),
    ...micronutrientColumns(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    nutritionCatalogOffProductBarcodeIdx: index("nutrition_catalog_off_product_barcode_idx")
      .on(table.barcode)
      .where(sql`${table.barcode} is not null`),
    nutritionCatalogOffProductReleaseIdx: index("nutrition_catalog_off_product_release_id_idx").on(
      table.releaseId,
    ),
    ...basisChecks("nutrition_catalog_off_product", table),
    nutritionCatalogOffProductSourceCheck: check(
      "nutrition_catalog_off_product_source_check",
      sql`${table.source} = 'off'`,
    ),
    nutritionCatalogOffProductCodeCheck: check(
      "nutrition_catalog_off_product_code_check",
      sql`${table.code} ~ '^[0-9]{1,24}$'`,
    ),
    nutritionCatalogOffProductNameCheck: check(
      "nutrition_catalog_off_product_name_check",
      sql`${table.name} is null or length(${table.name}) > 0`,
    ),
    nutritionCatalogOffProductBarcodeCheck: check(
      "nutrition_catalog_off_product_barcode_check",
      sql`${table.barcode} is null or ${table.barcode} ~ '^[0-9]{8,14}$'`,
    ),
    nutritionCatalogOffProductNutrientsCheck: check(
      "nutrition_catalog_off_product_nutrients_non_negative_check",
      nutrientsNonNegative(table),
    ),
    nutritionCatalogOffProductMicronutrientsCheck: check(
      "nutrition_catalog_off_product_micronutrients_non_negative_check",
      micronutrientsNonNegative(table),
    ),
    nutritionCatalogOffProductReleaseFk: foreignKey({
      columns: [table.releaseId, table.source],
      foreignColumns: [nutritionCatalogRelease.id, nutritionCatalogRelease.source],
      name: "nutrition_catalog_off_product_release_fk",
    }).onDelete("restrict"),
  }),
);

/**
 * Transformations and corrections to Open Food Facts products, kept apart
 * from the mirror. Together with the mirror this is the OFF-derived database
 * published under ODbL 1.0. Rows are instance-level and carry no author
 * identity; retracting sets `retracted_at` instead of deleting.
 */
export const nutritionCatalogOffOverlay = pgTable(
  "nutrition_catalog_off_overlay",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    kind: text("kind").$type<"transformation" | "correction">().notNull(),
    /** Validated changes: `{ name?, brand?, nutrients? }`; see `@openvalens/nutrition/catalog`. */
    changes: jsonb("changes").$type<Record<string, unknown>>().notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    retractedAt: timestamp("retracted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => ({
    nutritionCatalogOffOverlayCodeIdx: index("nutrition_catalog_off_overlay_code_idx").on(
      table.code,
    ),
    nutritionCatalogOffOverlayKindCheck: check(
      "nutrition_catalog_off_overlay_kind_check",
      sql`${table.kind} in ('transformation', 'correction')`,
    ),
    nutritionCatalogOffOverlayReasonCheck: check(
      "nutrition_catalog_off_overlay_reason_check",
      sql`length(${table.reason}) > 0`,
    ),
    nutritionCatalogOffOverlayProductFk: foreignKey({
      columns: [table.code],
      foreignColumns: [nutritionCatalogOffProduct.code],
      name: "nutrition_catalog_off_overlay_product_fk",
    }).onDelete("restrict"),
  }),
);
