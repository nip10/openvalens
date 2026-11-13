-- Issue #443: caffeine (mg) and alcohol (ethanol, g) per the same basis as the
-- core nutrients, on custom foods, snapshots and both catalog mirrors. NULL
-- means the source did not report the value; existing rows stay NULL
-- (unknown), never zero, until the catalogs are re-imported. Additive only.
ALTER TABLE "nutrition_food" ADD COLUMN "caffeine_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food" ADD COLUMN "alcohol_g" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food" ADD CONSTRAINT "nutrition_food_drink_nutrients_non_negative_check" CHECK (("nutrition_food"."caffeine_mg" is null or "nutrition_food"."caffeine_mg" >= 0) AND ("nutrition_food"."alcohol_g" is null or "nutrition_food"."alcohol_g" >= 0));
--> statement-breakpoint
ALTER TABLE "nutrition_food_snapshot" ADD COLUMN "caffeine_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food_snapshot" ADD COLUMN "alcohol_g" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food_snapshot" ADD CONSTRAINT "nutrition_food_snapshot_drink_nutrients_non_negative_check" CHECK (("nutrition_food_snapshot"."caffeine_mg" is null or "nutrition_food_snapshot"."caffeine_mg" >= 0) AND ("nutrition_food_snapshot"."alcohol_g" is null or "nutrition_food_snapshot"."alcohol_g" >= 0));
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_fdc_food" ADD COLUMN "caffeine_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_fdc_food" ADD COLUMN "alcohol_g" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_fdc_food" ADD CONSTRAINT "nutrition_catalog_fdc_food_drink_nutrients_non_negative_check" CHECK (("nutrition_catalog_fdc_food"."caffeine_mg" is null or "nutrition_catalog_fdc_food"."caffeine_mg" >= 0) AND ("nutrition_catalog_fdc_food"."alcohol_g" is null or "nutrition_catalog_fdc_food"."alcohol_g" >= 0));
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_off_product" ADD COLUMN "caffeine_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_off_product" ADD COLUMN "alcohol_g" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_off_product" ADD CONSTRAINT "nutrition_catalog_off_product_drink_nutrients_non_negative_check" CHECK (("nutrition_catalog_off_product"."caffeine_mg" is null or "nutrition_catalog_off_product"."caffeine_mg" >= 0) AND ("nutrition_catalog_off_product"."alcohol_g" is null or "nutrition_catalog_off_product"."alcohol_g" >= 0));
--> statement-breakpoint
-- The adapter mapping version each release was last parsed with. Releases
-- imported before #443 get 1, so re-importing the same artifact with the new
-- adapters (version 2) parses it again and fills caffeine and alcohol.
ALTER TABLE "nutrition_catalog_release" ADD COLUMN "adapter_version" integer DEFAULT 1 NOT NULL;
