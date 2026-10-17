-- Issue #97 — preventive care by region: the person's self-declared criteria,
-- their own dates and decisions per guideline item, and the evidence-check
-- library opt-in. The guideline items themselves are versioned data in the
-- repo (packages/api/src/preventive-care-pack.ts) and are never stored.
--
-- `preventive_care_setting`     one row per (workspace, person); library off by default.
-- `preventive_care_declaration` self-declared criteria; clearing deletes the row.
-- `preventive_care_item_state`  last done / next date / reminder / plan per item;
--                               a reminder needs a date and is never on for "decided: no".
--
-- Also widens `insight_preference_disabled_channels_check` with the #92
-- `reminder` kind (reminder:in_app|push|email), so reminders share the
-- insight opt-in, per-kind toggles and one-push-a-day claim.
--
-- Generated with drizzle-kit and reduced to this change's statements. Additive
-- only: new tables and a widened check constraint, no data movement.

CREATE TABLE "preventive_care_declaration" (
	"organization_id" text,
	"user_id" text,
	"criterion_id" text,
	"answer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preventive_care_declaration_pkey" PRIMARY KEY("organization_id","user_id","criterion_id"),
	CONSTRAINT "preventive_care_declaration_answer_check" CHECK ("answer" in ('yes', 'no', 'prefer_not_to_say'))
);
--> statement-breakpoint
CREATE TABLE "preventive_care_item_state" (
	"organization_id" text,
	"user_id" text,
	"item_id" text,
	"item_version" integer NOT NULL,
	"plan" text DEFAULT 'none' NOT NULL,
	"last_done_on" date,
	"next_on" date,
	"remind" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preventive_care_item_state_pkey" PRIMARY KEY("organization_id","user_id","item_id"),
	CONSTRAINT "preventive_care_item_state_plan_check" CHECK ("plan" in ('none', 'expect_invitation', 'decided_yes', 'decided_no', 'decided_later')),
	CONSTRAINT "preventive_care_item_state_remind_check" CHECK ("remind" = false or ("next_on" is not null and "plan" <> 'decided_no'))
);
--> statement-breakpoint
CREATE TABLE "preventive_care_setting" (
	"organization_id" text,
	"user_id" text,
	"library_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preventive_care_setting_pkey" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "insight_preference" DROP CONSTRAINT "insight_preference_disabled_channels_check";
--> statement-breakpoint
ALTER TABLE "insight_preference" ADD CONSTRAINT "insight_preference_disabled_channels_check" CHECK ("disabled_channels" <@ array[
        'change:in_app', 'change:push', 'change:email',
        'goal_milestone:in_app', 'goal_milestone:push', 'goal_milestone:email',
        'data_quality:in_app', 'data_quality:push', 'data_quality:email',
        'streak:in_app', 'streak:push', 'streak:email',
        'reminder:in_app', 'reminder:push', 'reminder:email'
      ]::text[]);
--> statement-breakpoint
CREATE INDEX "preventive_care_declaration_user_id_idx" ON "preventive_care_declaration" ("user_id");--> statement-breakpoint
CREATE INDEX "preventive_care_item_state_user_id_idx" ON "preventive_care_item_state" ("user_id");--> statement-breakpoint
CREATE INDEX "preventive_care_item_state_remind_idx" ON "preventive_care_item_state" ("next_on") WHERE "remind";--> statement-breakpoint
CREATE INDEX "preventive_care_setting_user_id_idx" ON "preventive_care_setting" ("user_id");--> statement-breakpoint
ALTER TABLE "preventive_care_declaration" ADD CONSTRAINT "preventive_care_declaration_2J5T8i0u279T_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "preventive_care_declaration" ADD CONSTRAINT "preventive_care_declaration_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "preventive_care_declaration" ADD CONSTRAINT "preventive_care_declaration_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "preventive_care_item_state" ADD CONSTRAINT "preventive_care_item_state_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "preventive_care_item_state" ADD CONSTRAINT "preventive_care_item_state_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "preventive_care_item_state" ADD CONSTRAINT "preventive_care_item_state_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "preventive_care_setting" ADD CONSTRAINT "preventive_care_setting_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "preventive_care_setting" ADD CONSTRAINT "preventive_care_setting_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "preventive_care_setting" ADD CONSTRAINT "preventive_care_setting_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE CASCADE;