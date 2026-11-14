-- Issue #439 (M2c): entries an AI app wrote that wait for the member's review
-- (a meal draft, a lab result, a workout with an exercise not in the catalog).
-- Nothing lands in the member's records until they confirm one in the app.
-- An `ai_app_entry` can now point at a pending draft. Additive only.
CREATE TABLE "ai_app_draft" (
	"id" uuid PRIMARY KEY,
	"grant_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_app_draft_kind_check" CHECK ("kind" in ('food', 'lab', 'workout'))
);
--> statement-breakpoint
CREATE INDEX "ai_app_draft_organization_id_user_id_kind_idx" ON "ai_app_draft" ("organization_id","user_id","kind");
--> statement-breakpoint
CREATE INDEX "ai_app_draft_grant_id_idx" ON "ai_app_draft" ("grant_id");
--> statement-breakpoint
CREATE INDEX "ai_app_draft_user_id_idx" ON "ai_app_draft" ("user_id");
--> statement-breakpoint
ALTER TABLE "ai_app_draft" ADD CONSTRAINT "ai_app_draft_grant_id_ai_app_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "ai_app_grant"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "ai_app_draft" ADD CONSTRAINT "ai_app_draft_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "ai_app_draft" ADD CONSTRAINT "ai_app_draft_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "ai_app_entry" DROP CONSTRAINT "ai_app_entry_target_table_check";
--> statement-breakpoint
ALTER TABLE "ai_app_entry" ADD CONSTRAINT "ai_app_entry_target_table_check" CHECK ("target_table" in ('metric_sample', 'plain_water_entry', 'supplement_intake', 'workout', 'health_event', 'custom_tracker_entry', 'pain_entry', 'ai_app_draft'));
