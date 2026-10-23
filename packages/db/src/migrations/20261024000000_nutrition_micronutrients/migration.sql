-- Issue #78: optional micronutrient values, per the same basis as the core
-- nutrients. NULL means the source did not report the nutrient; existing rows
-- stay NULL (unknown), never zero.
ALTER TABLE "nutrition_food" ADD COLUMN "calcium_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food" ADD COLUMN "iron_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food" ADD COLUMN "magnesium_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food" ADD COLUMN "potassium_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food" ADD COLUMN "zinc_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food" ADD COLUMN "vitamin_c_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food" ADD COLUMN "vitamin_d_ug" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food" ADD COLUMN "vitamin_b12_ug" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food" ADD CONSTRAINT "nutrition_food_micronutrients_non_negative_check" CHECK (("nutrition_food"."calcium_mg" is null or "nutrition_food"."calcium_mg" >= 0) AND ("nutrition_food"."iron_mg" is null or "nutrition_food"."iron_mg" >= 0) AND ("nutrition_food"."magnesium_mg" is null or "nutrition_food"."magnesium_mg" >= 0) AND ("nutrition_food"."potassium_mg" is null or "nutrition_food"."potassium_mg" >= 0) AND ("nutrition_food"."zinc_mg" is null or "nutrition_food"."zinc_mg" >= 0) AND ("nutrition_food"."vitamin_c_mg" is null or "nutrition_food"."vitamin_c_mg" >= 0) AND ("nutrition_food"."vitamin_d_ug" is null or "nutrition_food"."vitamin_d_ug" >= 0) AND ("nutrition_food"."vitamin_b12_ug" is null or "nutrition_food"."vitamin_b12_ug" >= 0));
--> statement-breakpoint
ALTER TABLE "nutrition_food_snapshot" ADD COLUMN "calcium_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food_snapshot" ADD COLUMN "iron_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food_snapshot" ADD COLUMN "magnesium_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food_snapshot" ADD COLUMN "potassium_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food_snapshot" ADD COLUMN "zinc_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food_snapshot" ADD COLUMN "vitamin_c_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food_snapshot" ADD COLUMN "vitamin_d_ug" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food_snapshot" ADD COLUMN "vitamin_b12_ug" real;
--> statement-breakpoint
ALTER TABLE "nutrition_food_snapshot" ADD CONSTRAINT "nutrition_food_snapshot_micronutrients_non_negative_check" CHECK (("nutrition_food_snapshot"."calcium_mg" is null or "nutrition_food_snapshot"."calcium_mg" >= 0) AND ("nutrition_food_snapshot"."iron_mg" is null or "nutrition_food_snapshot"."iron_mg" >= 0) AND ("nutrition_food_snapshot"."magnesium_mg" is null or "nutrition_food_snapshot"."magnesium_mg" >= 0) AND ("nutrition_food_snapshot"."potassium_mg" is null or "nutrition_food_snapshot"."potassium_mg" >= 0) AND ("nutrition_food_snapshot"."zinc_mg" is null or "nutrition_food_snapshot"."zinc_mg" >= 0) AND ("nutrition_food_snapshot"."vitamin_c_mg" is null or "nutrition_food_snapshot"."vitamin_c_mg" >= 0) AND ("nutrition_food_snapshot"."vitamin_d_ug" is null or "nutrition_food_snapshot"."vitamin_d_ug" >= 0) AND ("nutrition_food_snapshot"."vitamin_b12_ug" is null or "nutrition_food_snapshot"."vitamin_b12_ug" >= 0));
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_fdc_food" ADD COLUMN "calcium_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_fdc_food" ADD COLUMN "iron_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_fdc_food" ADD COLUMN "magnesium_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_fdc_food" ADD COLUMN "potassium_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_fdc_food" ADD COLUMN "zinc_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_fdc_food" ADD COLUMN "vitamin_c_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_fdc_food" ADD COLUMN "vitamin_d_ug" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_fdc_food" ADD COLUMN "vitamin_b12_ug" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_fdc_food" ADD CONSTRAINT "nutrition_catalog_fdc_food_micronutrients_non_negative_check" CHECK (("nutrition_catalog_fdc_food"."calcium_mg" is null or "nutrition_catalog_fdc_food"."calcium_mg" >= 0) AND ("nutrition_catalog_fdc_food"."iron_mg" is null or "nutrition_catalog_fdc_food"."iron_mg" >= 0) AND ("nutrition_catalog_fdc_food"."magnesium_mg" is null or "nutrition_catalog_fdc_food"."magnesium_mg" >= 0) AND ("nutrition_catalog_fdc_food"."potassium_mg" is null or "nutrition_catalog_fdc_food"."potassium_mg" >= 0) AND ("nutrition_catalog_fdc_food"."zinc_mg" is null or "nutrition_catalog_fdc_food"."zinc_mg" >= 0) AND ("nutrition_catalog_fdc_food"."vitamin_c_mg" is null or "nutrition_catalog_fdc_food"."vitamin_c_mg" >= 0) AND ("nutrition_catalog_fdc_food"."vitamin_d_ug" is null or "nutrition_catalog_fdc_food"."vitamin_d_ug" >= 0) AND ("nutrition_catalog_fdc_food"."vitamin_b12_ug" is null or "nutrition_catalog_fdc_food"."vitamin_b12_ug" >= 0));
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_off_product" ADD COLUMN "calcium_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_off_product" ADD COLUMN "iron_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_off_product" ADD COLUMN "magnesium_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_off_product" ADD COLUMN "potassium_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_off_product" ADD COLUMN "zinc_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_off_product" ADD COLUMN "vitamin_c_mg" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_off_product" ADD COLUMN "vitamin_d_ug" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_off_product" ADD COLUMN "vitamin_b12_ug" real;
--> statement-breakpoint
ALTER TABLE "nutrition_catalog_off_product" ADD CONSTRAINT "nutrition_catalog_off_product_micronutrients_non_negative_check" CHECK (("nutrition_catalog_off_product"."calcium_mg" is null or "nutrition_catalog_off_product"."calcium_mg" >= 0) AND ("nutrition_catalog_off_product"."iron_mg" is null or "nutrition_catalog_off_product"."iron_mg" >= 0) AND ("nutrition_catalog_off_product"."magnesium_mg" is null or "nutrition_catalog_off_product"."magnesium_mg" >= 0) AND ("nutrition_catalog_off_product"."potassium_mg" is null or "nutrition_catalog_off_product"."potassium_mg" >= 0) AND ("nutrition_catalog_off_product"."zinc_mg" is null or "nutrition_catalog_off_product"."zinc_mg" >= 0) AND ("nutrition_catalog_off_product"."vitamin_c_mg" is null or "nutrition_catalog_off_product"."vitamin_c_mg" >= 0) AND ("nutrition_catalog_off_product"."vitamin_d_ug" is null or "nutrition_catalog_off_product"."vitamin_d_ug" >= 0) AND ("nutrition_catalog_off_product"."vitamin_b12_ug" is null or "nutrition_catalog_off_product"."vitamin_b12_ug" >= 0));
