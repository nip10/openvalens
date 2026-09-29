CREATE TYPE "public"."health_connect_sync_status" AS ENUM('running', 'success', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "health_connect_record" (
	"id" serial PRIMARY KEY NOT NULL,
	"sync_id" integer NOT NULL,
	"record_type" text NOT NULL,
	"external_record_id" text,
	"start_time" text NOT NULL,
	"end_time" text,
	"value_json" jsonb NOT NULL,
	"source_app" text,
	"hash" text NOT NULL,
	"ingested_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_connect_sync" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'android_health_connect' NOT NULL,
	"status" "health_connect_sync_status" DEFAULT 'running' NOT NULL,
	"payload_version" text NOT NULL,
	"window_start" text NOT NULL,
	"window_end" text NOT NULL,
	"started_at" text NOT NULL,
	"completed_at" text,
	"error_summary" text,
	"record_counts_json" jsonb,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "health_connect_record" ADD CONSTRAINT "health_connect_record_sync_id_health_connect_sync_id_fk" FOREIGN KEY ("sync_id") REFERENCES "public"."health_connect_sync"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "health_connect_record_type_external_id_key" ON "health_connect_record" USING btree ("record_type","external_record_id") WHERE "health_connect_record"."external_record_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "health_connect_record_type_hash_key" ON "health_connect_record" USING btree ("record_type","hash");--> statement-breakpoint
CREATE INDEX "health_connect_record_sync_id_idx" ON "health_connect_record" USING btree ("sync_id");--> statement-breakpoint
CREATE INDEX "health_connect_record_start_time_idx" ON "health_connect_record" USING btree ("start_time");