-- Issue #451: a personal goal can point at one of the member's custom
-- trackers (`metric` is `tracker:<tracker id>`). The check is widened, so
-- every existing row still passes; nothing is migrated.
ALTER TABLE "goal" DROP CONSTRAINT "goal_source_check";
--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_source_check" CHECK ("goal"."source" is null or "goal"."source" in ('manual', 'water', 'supplement', 'workout', 'sleep', 'tracker'));
