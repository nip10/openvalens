-- Onboarding stage 1: the modules a person switched on. NULL = never chosen,
-- which the app reads as every module on, so existing rows keep everything.
ALTER TABLE "wellness_profile" ADD COLUMN "enabled_modules" text[];
--> statement-breakpoint
ALTER TABLE "wellness_profile" ADD CONSTRAINT "wellness_profile_enabled_modules_check" CHECK ("wellness_profile"."enabled_modules" is null or "wellness_profile"."enabled_modules" <@ array['sleep', 'activity', 'heart', 'body', 'food', 'supplements', 'labs', 'cycle', 'coach', 'care']::text[]);
