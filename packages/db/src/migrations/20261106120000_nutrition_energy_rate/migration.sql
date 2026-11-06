-- Issue #396 — member-chosen weekly rate for energy suggestions (nutrition-safety/v2).
-- Null keeps the policy's default deficit or surplus size.
ALTER TABLE "nutrition_target_settings" ADD COLUMN "energy_rate_percent" real;--> statement-breakpoint
ALTER TABLE "nutrition_target_settings" ADD CONSTRAINT "nutrition_target_settings_rate_check" CHECK ("nutrition_target_settings"."energy_rate_percent" is null or "nutrition_target_settings"."energy_rate_percent" in (0.25, 0.5, 0.75, 1));
