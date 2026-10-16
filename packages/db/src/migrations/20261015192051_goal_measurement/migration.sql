-- Issue #95 — goal measurement contract for goal progress.
--
-- Adds which way counts as progress (`direction`), the starting point progress
-- is measured from (`baseline_value`) and the person's own weighting
-- (`priority`) to `goal`. Without a direction a goal such as "weigh 70 kg"
-- (currently 80 kg) cannot be scored honestly, so goal progress treats a goal
-- with no direction (and no baseline to infer one from) as unscored rather
-- than "achieved".
-- Generated with drizzle-kit and reduced to this change's statements. Additive
-- only: nullable columns, no data movement; existing rows satisfy both checks.

ALTER TABLE "goal" ADD COLUMN "direction" text;--> statement-breakpoint
ALTER TABLE "goal" ADD COLUMN "baseline_value" text;--> statement-breakpoint
ALTER TABLE "goal" ADD COLUMN "priority" text;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_direction_check" CHECK ("direction" is null or "direction" in ('increase', 'decrease'));--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_priority_check" CHECK ("priority" is null or "priority" in ('low', 'normal', 'high'));
