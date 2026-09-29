-- Migration 0032 for #18/#19. Earlier open migrations are reserved as 0029 (#16), 0030 (#17), and 0031 (#15).
ALTER TABLE "health_connect_sync" ADD COLUMN IF NOT EXISTS "started_at_ts" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "health_connect_record" ADD COLUMN IF NOT EXISTS "start_time_ts" timestamp with time zone;
--> statement-breakpoint
UPDATE "health_connect_sync" SET "started_at_ts" = "started_at"::timestamptz WHERE "started_at_ts" IS NULL;
--> statement-breakpoint
UPDATE "health_connect_record" SET "start_time_ts" = "start_time"::timestamptz WHERE "start_time_ts" IS NULL;
--> statement-breakpoint
ALTER TABLE "health_connect_sync" ALTER COLUMN "started_at_ts" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "health_connect_record" ALTER COLUMN "start_time_ts" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blood_panel_organization_id_date_idx" ON "blood_panel" USING btree ("organization_id", "date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blood_marker_organization_id_panel_id_idx" ON "blood_marker" USING btree ("organization_id", "panel_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blood_marker_organization_id_test_key_idx" ON "blood_marker" USING btree ("organization_id", "test_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blood_marker_organization_id_test_key_panel_id_idx" ON "blood_marker" USING btree ("organization_id", "test_key", "panel_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "body_comp_event_user_id_date_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "body_comp_event_measured_at_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dexa_scan_organization_id_date_idx" ON "dexa_scan" USING btree ("organization_id", "date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cardiac_exam_organization_id_date_idx" ON "cardiac_exam" USING btree ("organization_id", "date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_weight_organization_id_date_idx" ON "daily_weight" USING btree ("organization_id", "date" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_weight_organization_id_user_id_date_idx" ON "daily_weight" USING btree ("organization_id", "user_id", "date" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "body_comp_event_organization_id_date_idx" ON "body_comp_event" USING btree ("organization_id", "date" DESC, "measured_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "body_comp_event_organization_id_user_id_date_idx" ON "body_comp_event" USING btree ("organization_id", "user_id", "date" DESC, "measured_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "weight_checkin_organization_id_date_idx" ON "weight_checkin" USING btree ("organization_id", "date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_event_organization_id_date_idx" ON "calendar_event" USING btree ("organization_id", "date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insight_organization_id_created_at_idx" ON "insight" USING btree ("organization_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "health_connect_sync_organization_id_started_at_ts_idx" ON "health_connect_sync" USING btree ("organization_id", "started_at_ts" DESC NULLS LAST, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "health_connect_sync_organization_id_started_at_ts_failed_partial_idx" ON "health_connect_sync" USING btree ("organization_id", "started_at_ts" DESC NULLS LAST, "id" DESC) WHERE "status" in ('failed', 'partial');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "health_connect_sync_organization_id_status_started_at_ts_idx" ON "health_connect_sync" USING btree ("organization_id", "status", "started_at_ts" DESC NULLS LAST, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "health_connect_record_start_time_ts_idx" ON "health_connect_record" USING btree ("start_time_ts");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "health_connect_record_organization_id_start_time_ts_idx" ON "health_connect_record" USING btree ("organization_id", "start_time_ts");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "health_connect_record_organization_id_record_type_start_time_ts_idx" ON "health_connect_record" USING btree ("organization_id", "record_type", "start_time_ts" DESC NULLS LAST, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "body_comp_event_user_id_date_idx" ON "body_comp_event" USING btree ("user_id", "date" DESC, "measured_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "body_comp_event_measured_at_idx" ON "body_comp_event" USING btree ("measured_at" DESC, "id" DESC);
