-- goals#2: a personal goal can read the member's own canonical daily weigh-ins
-- (`daily_weight`, metric `weight_kg`) instead of manual check-ins. The check
-- is widened, so every existing row still passes; nothing is migrated.
ALTER TABLE "goal" DROP CONSTRAINT "goal_source_check";
--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_source_check" CHECK ("goal"."source" is null or "goal"."source" in ('manual', 'water', 'supplement', 'workout', 'sleep', 'tracker', 'weight'));
