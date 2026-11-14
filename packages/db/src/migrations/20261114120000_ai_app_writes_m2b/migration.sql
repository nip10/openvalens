-- Issue #439 (M2b): AI app writes for workouts, sleep, custom trackers and the
-- pain log. An `ai_app_entry` can now point at a workout, a manual sleep night
-- (`health_event`), a custom tracker entry or a pain entry. Tracker and pain
-- entries are keyed by UUID, so they go in the new `target_uuids` column
-- (empty for the integer-keyed domains). Additive only.
ALTER TABLE "ai_app_entry" ADD COLUMN "target_uuids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_app_entry" DROP CONSTRAINT "ai_app_entry_target_table_check";
--> statement-breakpoint
ALTER TABLE "ai_app_entry" ADD CONSTRAINT "ai_app_entry_target_table_check" CHECK ("target_table" in ('metric_sample', 'plain_water_entry', 'supplement_intake', 'workout', 'health_event', 'custom_tracker_entry', 'pain_entry'));
