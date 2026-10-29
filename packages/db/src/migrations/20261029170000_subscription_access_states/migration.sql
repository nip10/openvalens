-- Issue #298 — subscription states for OpenValens Cloud. Self-host never
-- writes these columns.
--
-- `past_due_since`: when the subscription went past due, so write access
--   continues for a grace period (BILLING_PAST_DUE_GRACE_DAYS) from then.
-- `ended_at`: when the plan or trial ended (read-only from then on), the
--   start of the retention clock (CLOUD_ENDED_RETENTION_MONTHS).
-- `retention_warning_sent_at`: when the "your records will be deleted"
--   email was claimed (sent once; cleared when the owner subscribes again).
ALTER TABLE "subscription" ADD COLUMN "past_due_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "retention_warning_sent_at" timestamp with time zone;--> statement-breakpoint
-- Rows already past due or ended before this migration: the last state change
-- is the best record of when that happened (a lapsed trial ended at its end).
UPDATE "subscription" SET "past_due_since" = "updated_at" WHERE "status" = 'past_due';--> statement-breakpoint
UPDATE "subscription" SET "ended_at" = CASE
		WHEN "stripe_subscription_id" IS NULL THEN "trial_ends_at"
		ELSE COALESCE("current_period_end", "updated_at")
	END
	WHERE "status" IN ('canceled', 'ended');--> statement-breakpoint
CREATE INDEX "subscription_status_ended_at_idx" ON "subscription" ("status", "ended_at");
