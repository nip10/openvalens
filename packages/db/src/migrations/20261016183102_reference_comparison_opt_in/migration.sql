-- Issue #96 — per-metric opt-in for reference comparisons.
--
-- `reference_comparison_opt_in` is user-owned (keyed by `user_id`, never by
-- organization), like the wellness profile whose age band and sex it relies
-- on. A row exists exactly while one metric's comparison is on; turning it off
-- deletes the row. `reference_version` records which reference-data version
-- (sources and limits) was shown when it was turned on. No health value.
-- Generated with drizzle-kit and reduced to this change's statements. Additive
-- only: one new table, no data movement.

CREATE TABLE "reference_comparison_opt_in" (
	"user_id" text,
	"metric" text,
	"reference_version" text NOT NULL,
	"enabled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_comparison_opt_in_pkey" PRIMARY KEY("user_id","metric"),
	CONSTRAINT "reference_comparison_opt_in_metric_check" CHECK ("metric" in ('resting_heart_rate', 'sleep_duration', 'active_minutes'))
);--> statement-breakpoint
ALTER TABLE "reference_comparison_opt_in" ADD CONSTRAINT "reference_comparison_opt_in_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
