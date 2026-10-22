-- Issue #90: the logging streak is opt-in. Turning it off keeps nothing to
-- lose: the streak is derived from the diary on every read.
ALTER TABLE "nutrition_target_settings" ADD COLUMN "streaks_enabled" boolean DEFAULT false NOT NULL;
