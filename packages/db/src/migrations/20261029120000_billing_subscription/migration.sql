-- Issue #297 — Stripe subscriptions with a free trial for OpenValens Cloud
-- (`DEPLOYMENT_MODE=cloud`). Self-host never writes these tables.
--
-- `subscription`: one row per workspace owner (the billing unit). The 30-day
-- trial is local (`trial_ends_at`); Stripe ids are set only after Checkout.
-- `customer_ref` is an opaque random reference, the only identifier Stripe
-- metadata holds.
CREATE TABLE "subscription" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL UNIQUE REFERENCES "user"("id") ON DELETE CASCADE,
	"customer_ref" text NOT NULL UNIQUE,
	"stripe_customer_id" text UNIQUE,
	"stripe_subscription_id" text UNIQUE,
	"status" text NOT NULL,
	"price_id" text,
	"trial_ends_at" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"trial_reminder_sent_at" timestamp with time zone,
	"trial_ended_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_status_check" CHECK ("status" in ('trialing', 'active', 'past_due', 'canceled', 'ended'))
);
--> statement-breakpoint
CREATE INDEX "subscription_status_trial_ends_at_idx" ON "subscription" ("status", "trial_ends_at");--> statement-breakpoint
-- Stripe webhook events already applied (idempotency by event id). Never the payload.
CREATE TABLE "billing_webhook_event" (
	"id" text PRIMARY KEY,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "billing_webhook_event_processed_at_idx" ON "billing_webhook_event" ("processed_at");--> statement-breakpoint
-- Stripe customers to cancel and delete after their account was erased. No
-- foreign key on purpose: the account is gone when this is processed.
CREATE TABLE "billing_customer_erasure" (
	"stripe_customer_id" text PRIMARY KEY,
	"stripe_subscription_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone
);
--> statement-breakpoint
-- Whatever removes a subscription row with a Stripe customer (self-service
-- erasure, an administrator, the cascade from `user`, or replaying an erasure
-- after a backup restore) queues that customer, in the same transaction, so
-- the Stripe subscription is always cancelled and the customer deleted.
CREATE FUNCTION "billing_queue_customer_erasure"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD."stripe_customer_id" IS NOT NULL THEN
		INSERT INTO "billing_customer_erasure" ("stripe_customer_id", "stripe_subscription_id")
		VALUES (OLD."stripe_customer_id", OLD."stripe_subscription_id")
		ON CONFLICT ("stripe_customer_id") DO UPDATE
			SET "stripe_subscription_id" = COALESCE(EXCLUDED."stripe_subscription_id", "billing_customer_erasure"."stripe_subscription_id");
	END IF;
	RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "subscription_queue_customer_erasure" AFTER DELETE ON "subscription"
	FOR EACH ROW EXECUTE FUNCTION "billing_queue_customer_erasure"();
