-- Issue #506: a tombstone for each imported tracker entry the member deleted,
-- keyed like custom_tracker_entry's source-record index. The import treats a
-- tombstoned source record as already seen, so a re-read (Health Connect's
-- 7-day window, HealthKit after sign-out) does not bring it back. Same
-- organization, user, member and tracker foreign keys as the entries, all
-- ON DELETE CASCADE. Additive only.
CREATE TABLE "custom_tracker_entry_tombstone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tracker_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"source_record_id" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_tracker_entry_tombstone_source_check" CHECK ("source" in ('health_connect', 'healthkit'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "custom_tracker_entry_tombstone_source_record_key" ON "custom_tracker_entry_tombstone" ("organization_id","user_id","tracker_id","source","source_record_id");--> statement-breakpoint
ALTER TABLE "custom_tracker_entry_tombstone" ADD CONSTRAINT "custom_tracker_entry_tombstone_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "custom_tracker_entry_tombstone" ADD CONSTRAINT "custom_tracker_entry_tombstone_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "custom_tracker_entry_tombstone" ADD CONSTRAINT "custom_tracker_entry_tombstone_tracker_fk" FOREIGN KEY ("tracker_id","organization_id","user_id") REFERENCES "custom_tracker"("id","organization_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "custom_tracker_entry_tombstone" ADD CONSTRAINT "custom_tracker_entry_tombstone_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE CASCADE;
