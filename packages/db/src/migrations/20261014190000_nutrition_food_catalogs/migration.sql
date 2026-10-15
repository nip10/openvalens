-- Issue #72 — separate, attributed public food catalogs.
--
-- Creates four new, empty, instance-wide reference tables: the import-batch
-- ledger (`nutrition_catalog_release`, recording artifact, SHA-256, license
-- and attribution), one mirror table per source (USDA FoodData Central under
-- CC0 1.0; Open Food Facts under ODbL 1.0 / DbCL 1.0) and an overlay table
-- for OFF transformations/corrections so the OFF mirror is never edited in
-- place. No table holds tenant or personal data, and no tenant table
-- references a catalog row: diary entries copy catalog foods into
-- `nutrition_food_snapshot`. Additive only: no existing table, column,
-- constraint or row is altered or removed.

CREATE TABLE "nutrition_catalog_release" (
	"id" serial PRIMARY KEY,
	"source" text NOT NULL,
	"dataset" text NOT NULL,
	"version" text NOT NULL,
	"artifact" text NOT NULL,
	"artifact_sha256" text NOT NULL,
	"source_url" text NOT NULL,
	"license" text NOT NULL,
	"attribution" text NOT NULL,
	"record_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_catalog_release_source_check" CHECK (("source" = 'fdc' and "license" = 'CC0-1.0') or ("source" = 'off' and "license" = 'ODbL-1.0')),
	CONSTRAINT "nutrition_catalog_release_sha256_check" CHECK ("artifact_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "nutrition_catalog_release_text_check" CHECK (length("dataset") > 0 and length("version") > 0 and length("artifact") > 0 and length("source_url") > 0 and length("attribution") > 0),
	CONSTRAINT "nutrition_catalog_release_counts_check" CHECK ("record_count" >= 0 and "rejected_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "nutrition_catalog_fdc_food" (
	"fdc_id" text PRIMARY KEY,
	"source" text DEFAULT 'fdc' NOT NULL,
	"release_id" integer NOT NULL,
	"data_type" text NOT NULL,
	"source_version" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"barcode" text,
	"nutrient_basis_amount" real NOT NULL,
	"nutrient_basis_unit" text NOT NULL,
	"serving_size_amount" real,
	"serving_size_unit" text,
	"serving_label" text,
	"energy_kcal" real,
	"energy_kj" real,
	"protein_g" real,
	"carbohydrate_g" real,
	"fat_g" real,
	"saturated_fat_g" real,
	"fiber_g" real,
	"total_sugars_g" real,
	"added_sugars_g" real,
	"free_sugars_g" real,
	"sodium_mg" real,
	"salt_g" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_catalog_fdc_food_nutrient_basis_amount_check" CHECK ("nutrient_basis_amount" > 0),
	CONSTRAINT "nutrition_catalog_fdc_food_nutrient_basis_unit_check" CHECK ("nutrient_basis_unit" in ('g', 'ml', 'serving')),
	CONSTRAINT "nutrition_catalog_fdc_food_serving_size_check" CHECK (("serving_size_amount" is null and "serving_size_unit" is null) or ("serving_size_amount" > 0 and "serving_size_unit" in ('g', 'ml'))),
	CONSTRAINT "nutrition_catalog_fdc_food_source_check" CHECK ("source" = 'fdc'),
	CONSTRAINT "nutrition_catalog_fdc_food_fdc_id_check" CHECK ("fdc_id" ~ '^[0-9]{1,12}$'),
	CONSTRAINT "nutrition_catalog_fdc_food_name_check" CHECK (length("name") > 0),
	CONSTRAINT "nutrition_catalog_fdc_food_barcode_check" CHECK ("barcode" is null or "barcode" ~ '^[0-9]{8,14}$'),
	CONSTRAINT "nutrition_catalog_fdc_food_nutrients_non_negative_check" CHECK (("energy_kcal" is null or "energy_kcal" >= 0) and ("energy_kj" is null or "energy_kj" >= 0) and ("protein_g" is null or "protein_g" >= 0) and ("carbohydrate_g" is null or "carbohydrate_g" >= 0) and ("fat_g" is null or "fat_g" >= 0) and ("saturated_fat_g" is null or "saturated_fat_g" >= 0) and ("fiber_g" is null or "fiber_g" >= 0) and ("total_sugars_g" is null or "total_sugars_g" >= 0) and ("added_sugars_g" is null or "added_sugars_g" >= 0) and ("free_sugars_g" is null or "free_sugars_g" >= 0) and ("sodium_mg" is null or "sodium_mg" >= 0) and ("salt_g" is null or "salt_g" >= 0))
);
--> statement-breakpoint
CREATE TABLE "nutrition_catalog_off_product" (
	"code" text PRIMARY KEY,
	"source" text DEFAULT 'off' NOT NULL,
	"release_id" integer NOT NULL,
	"last_modified_at" timestamp with time zone NOT NULL,
	"name" text,
	"brand" text,
	"barcode" text,
	"nutrient_basis_amount" real NOT NULL,
	"nutrient_basis_unit" text NOT NULL,
	"serving_size_amount" real,
	"serving_size_unit" text,
	"serving_label" text,
	"energy_kcal" real,
	"energy_kj" real,
	"protein_g" real,
	"carbohydrate_g" real,
	"fat_g" real,
	"saturated_fat_g" real,
	"fiber_g" real,
	"total_sugars_g" real,
	"added_sugars_g" real,
	"free_sugars_g" real,
	"sodium_mg" real,
	"salt_g" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_catalog_off_product_nutrient_basis_amount_check" CHECK ("nutrient_basis_amount" > 0),
	CONSTRAINT "nutrition_catalog_off_product_nutrient_basis_unit_check" CHECK ("nutrient_basis_unit" in ('g', 'ml', 'serving')),
	CONSTRAINT "nutrition_catalog_off_product_serving_size_check" CHECK (("serving_size_amount" is null and "serving_size_unit" is null) or ("serving_size_amount" > 0 and "serving_size_unit" in ('g', 'ml'))),
	CONSTRAINT "nutrition_catalog_off_product_source_check" CHECK ("source" = 'off'),
	CONSTRAINT "nutrition_catalog_off_product_code_check" CHECK ("code" ~ '^[0-9]{1,24}$'),
	CONSTRAINT "nutrition_catalog_off_product_name_check" CHECK ("name" is null or length("name") > 0),
	CONSTRAINT "nutrition_catalog_off_product_barcode_check" CHECK ("barcode" is null or "barcode" ~ '^[0-9]{8,14}$'),
	CONSTRAINT "nutrition_catalog_off_product_nutrients_non_negative_check" CHECK (("energy_kcal" is null or "energy_kcal" >= 0) and ("energy_kj" is null or "energy_kj" >= 0) and ("protein_g" is null or "protein_g" >= 0) and ("carbohydrate_g" is null or "carbohydrate_g" >= 0) and ("fat_g" is null or "fat_g" >= 0) and ("saturated_fat_g" is null or "saturated_fat_g" >= 0) and ("fiber_g" is null or "fiber_g" >= 0) and ("total_sugars_g" is null or "total_sugars_g" >= 0) and ("added_sugars_g" is null or "added_sugars_g" >= 0) and ("free_sugars_g" is null or "free_sugars_g" >= 0) and ("sodium_mg" is null or "sodium_mg" >= 0) and ("salt_g" is null or "salt_g" >= 0))
);
--> statement-breakpoint
CREATE TABLE "nutrition_catalog_off_overlay" (
	"id" serial PRIMARY KEY,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"changes" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retracted_at" timestamp with time zone,
	CONSTRAINT "nutrition_catalog_off_overlay_kind_check" CHECK ("kind" in ('transformation', 'correction')),
	CONSTRAINT "nutrition_catalog_off_overlay_reason_check" CHECK (length("reason") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_catalog_release_id_source_key" ON "nutrition_catalog_release" ("id","source");
--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_catalog_release_artifact_key" ON "nutrition_catalog_release" ("source","dataset","version","artifact_sha256");
--> statement-breakpoint
CREATE INDEX "nutrition_catalog_fdc_food_barcode_idx" ON "nutrition_catalog_fdc_food" ("barcode") WHERE "barcode" is not null;
--> statement-breakpoint
CREATE INDEX "nutrition_catalog_fdc_food_release_id_idx" ON "nutrition_catalog_fdc_food" ("release_id");
--> statement-breakpoint
CREATE INDEX "nutrition_catalog_off_product_barcode_idx" ON "nutrition_catalog_off_product" ("barcode") WHERE "barcode" is not null;
--> statement-breakpoint
CREATE INDEX "nutrition_catalog_off_product_release_id_idx" ON "nutrition_catalog_off_product" ("release_id");
--> statement-breakpoint
CREATE INDEX "nutrition_catalog_off_overlay_code_idx" ON "nutrition_catalog_off_overlay" ("code");
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_fdc_food" ADD CONSTRAINT "nutrition_catalog_fdc_food_release_fk" FOREIGN KEY ("release_id","source") REFERENCES "nutrition_catalog_release"("id","source") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_off_product" ADD CONSTRAINT "nutrition_catalog_off_product_release_fk" FOREIGN KEY ("release_id","source") REFERENCES "nutrition_catalog_release"("id","source") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_off_overlay" ADD CONSTRAINT "nutrition_catalog_off_overlay_product_fk" FOREIGN KEY ("code") REFERENCES "nutrition_catalog_off_product"("code") ON DELETE RESTRICT;
