-- Issue #452: phone feeds for custom trackers. Which tracker a feed from the
-- member's phone fills (HealthKit mindful sessions or Health Connect
-- mindfulness into a duration tracker, HealthKit State of Mind into a 1-5
-- scale tracker). One tracker per feed per member, stored on the server so
-- every phone of the member knows the link. Imported entries use the
-- existing custom_tracker_entry.source / source_record_id columns and their
-- partial unique index. Additive only.
CREATE TABLE "custom_tracker_feed" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"feed" text NOT NULL,
	"tracker_id" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_tracker_feed_feed_check" CHECK ("feed" in ('healthkit_mindful_sessions', 'health_connect_mindfulness', 'healthkit_state_of_mind'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "custom_tracker_feed_org_user_feed_key" ON "custom_tracker_feed" ("organization_id","user_id","feed");--> statement-breakpoint
CREATE INDEX "custom_tracker_feed_tracker_idx" ON "custom_tracker_feed" ("tracker_id");--> statement-breakpoint
ALTER TABLE "custom_tracker_feed" ADD CONSTRAINT "custom_tracker_feed_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "custom_tracker_feed" ADD CONSTRAINT "custom_tracker_feed_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "custom_tracker_feed" ADD CONSTRAINT "custom_tracker_feed_tracker_fk" FOREIGN KEY ("tracker_id","organization_id","user_id") REFERENCES "custom_tracker"("id","organization_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "custom_tracker_feed" ADD CONSTRAINT "custom_tracker_feed_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE CASCADE;
