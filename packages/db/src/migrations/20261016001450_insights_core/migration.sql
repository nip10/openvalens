-- Issue #92 — insights core: feedback, delivery preferences, push devices and
-- delivery history. Insights themselves are recomputed on request and never
-- stored; none of these tables holds a health value.
--
-- `insight_preference`  one row per (workspace, person); push and email off by
--                       default; the email digest needs an acknowledged
--                       disclosure version (check constraint).
-- `insight_feedback`    dismiss / "not useful" per insight id (rule + window).
-- `push_device`         Expo push tokens, keyed by user.
-- `insight_delivery`    one row per (workspace, person, channel, period): the
--                       idempotency claim and the value-free audit record.
--
-- Generated with drizzle-kit and reduced to this change's statements. Additive
-- only: new tables, no data movement.

CREATE TABLE "insight_delivery" (
	"id" serial PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"period_key" text NOT NULL,
	"insight_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"rule_versions" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'claimed' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"error_code" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "insight_delivery_channel_check" CHECK ("channel" in ('push', 'email')),
	CONSTRAINT "insight_delivery_status_check" CHECK ("status" in ('claimed', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "insight_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"insight_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"rule_version" text NOT NULL,
	"action" text NOT NULL,
	"muted_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insight_feedback_action_check" CHECK ("action" in ('dismiss', 'not_useful'))
);
--> statement-breakpoint
CREATE TABLE "insight_preference" (
	"organization_id" text,
	"user_id" text,
	"push_enabled" boolean DEFAULT false NOT NULL,
	"push_show_topic" boolean DEFAULT false NOT NULL,
	"push_offer_state" text DEFAULT 'not_offered' NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"email_acknowledged_version" text,
	"email_acknowledged_at" timestamp with time zone,
	"email_unsubscribe_token_hash" text,
	"delivery_hour" integer DEFAULT 9 NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"disabled_channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insight_preference_pkey" PRIMARY KEY("organization_id","user_id"),
	CONSTRAINT "insight_preference_push_offer_state_check" CHECK ("push_offer_state" in ('not_offered', 'accepted', 'declined')),
	CONSTRAINT "insight_preference_email_ack_check" CHECK ("email_enabled" = false or "email_acknowledged_version" is not null),
	CONSTRAINT "insight_preference_delivery_hour_check" CHECK ("delivery_hour" between 0 and 23),
	CONSTRAINT "insight_preference_disabled_channels_check" CHECK ("disabled_channels" <@ array[
        'change:in_app', 'change:push', 'change:email',
        'goal_milestone:in_app', 'goal_milestone:push', 'goal_milestone:email',
        'data_quality:in_app', 'data_quality:push', 'data_quality:email',
        'streak:in_app', 'streak:push', 'streak:email'
      ]::text[])
);
--> statement-breakpoint
CREATE TABLE "push_device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"expo_push_token" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_device_platform_check" CHECK ("platform" in ('ios', 'android'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "insight_delivery_org_user_channel_period_key" ON "insight_delivery" ("organization_id","user_id","channel","period_key");
--> statement-breakpoint
CREATE INDEX "insight_delivery_user_id_idx" ON "insight_delivery" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "insight_feedback_org_user_insight_key" ON "insight_feedback" ("organization_id","user_id","insight_id");
--> statement-breakpoint
CREATE INDEX "insight_feedback_user_id_idx" ON "insight_feedback" ("user_id");
--> statement-breakpoint
CREATE INDEX "insight_preference_user_id_idx" ON "insight_preference" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "insight_preference_email_unsubscribe_token_hash_key" ON "insight_preference" ("email_unsubscribe_token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "push_device_expo_push_token_key" ON "push_device" ("expo_push_token");
--> statement-breakpoint
CREATE INDEX "push_device_user_id_idx" ON "push_device" ("user_id");
--> statement-breakpoint
ALTER TABLE "insight_delivery" ADD CONSTRAINT "insight_delivery_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "insight_delivery" ADD CONSTRAINT "insight_delivery_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "insight_delivery" ADD CONSTRAINT "insight_delivery_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "insight_feedback" ADD CONSTRAINT "insight_feedback_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "insight_feedback" ADD CONSTRAINT "insight_feedback_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "insight_feedback" ADD CONSTRAINT "insight_feedback_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "insight_preference" ADD CONSTRAINT "insight_preference_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "insight_preference" ADD CONSTRAINT "insight_preference_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "insight_preference" ADD CONSTRAINT "insight_preference_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "push_device" ADD CONSTRAINT "push_device_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
