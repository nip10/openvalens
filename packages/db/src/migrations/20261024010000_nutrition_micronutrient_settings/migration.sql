-- Issue #78: the micronutrient summary is opt-in. The reference source and
-- population are stored only after the member accepts them; NULL means none.
ALTER TABLE "nutrition_target_settings" ADD COLUMN "micronutrients_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "nutrition_target_settings" ADD COLUMN "micronutrient_reference_source" text;
--> statement-breakpoint
ALTER TABLE "nutrition_target_settings" ADD COLUMN "micronutrient_population" text;
--> statement-breakpoint
ALTER TABLE "nutrition_target_settings" ADD CONSTRAINT "nutrition_target_settings_micronutrient_source_check" CHECK ("micronutrient_reference_source" is null or "micronutrient_reference_source" in ('efsa', 'nasem'));
