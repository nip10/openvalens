-- Issue #443 (part b): the caffeine and alcohol day totals are opt-in, off by
-- default, and can be turned off again. Turning one off hides the total and
-- deletes nothing.
ALTER TABLE "nutrition_target_settings" ADD COLUMN "caffeine_totals_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "nutrition_target_settings" ADD COLUMN "alcohol_totals_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- A drink preset saves a normal diary entry; `preset` records how it was
-- logged. The check is widened, so every existing row still passes.
ALTER TABLE "nutrition_meal_entry" DROP CONSTRAINT "nutrition_meal_entry_method_check";
--> statement-breakpoint
ALTER TABLE "nutrition_meal_entry" ADD CONSTRAINT "nutrition_meal_entry_method_check" CHECK ("nutrition_meal_entry"."method" in ('manual', 'search', 'barcode', 'quick_add', 'copied', 'preset'));
