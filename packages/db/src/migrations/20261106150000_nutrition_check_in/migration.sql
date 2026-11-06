-- Issue #397 — collaborative weekly check-in: the member's day and the last finished check-in.
ALTER TABLE "nutrition_target_settings" ADD COLUMN "check_in_day" integer;--> statement-breakpoint
ALTER TABLE "nutrition_target_settings" ADD COLUMN "last_check_in_on" text;--> statement-breakpoint
ALTER TABLE "nutrition_target_settings" ADD CONSTRAINT "nutrition_target_settings_check_in_day_check" CHECK ("nutrition_target_settings"."check_in_day" is null or "nutrition_target_settings"."check_in_day" between 1 and 7);--> statement-breakpoint
ALTER TABLE "nutrition_target_settings" ADD CONSTRAINT "nutrition_target_settings_last_check_in_check" CHECK ("nutrition_target_settings"."last_check_in_on" is null or "nutrition_target_settings"."last_check_in_on" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
