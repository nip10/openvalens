CREATE TYPE "public"."mobile_sync_session_status" AS ENUM('running', 'finalized', 'expired');--> statement-breakpoint
CREATE TABLE "mobile_sync_session" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"payload_version" text NOT NULL,
	"timezone" text NOT NULL,
	"window_start" text NOT NULL,
	"window_end" text NOT NULL,
	"expected_chunk_count" integer NOT NULL,
	"status" "mobile_sync_session_status" DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mobile_sync_session_chunk" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_count" integer NOT NULL,
	"chunk_hash" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mobile_sync_session" ADD CONSTRAINT "mobile_sync_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_sync_session" ADD CONSTRAINT "mobile_sync_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_sync_session_chunk" ADD CONSTRAINT "mobile_sync_session_chunk_session_id_mobile_sync_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."mobile_sync_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mobile_sync_session_status_idx" ON "mobile_sync_session" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mobile_sync_session_expires_at_idx" ON "mobile_sync_session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "mobile_sync_session_organization_id_user_id_device_id_idx" ON "mobile_sync_session" USING btree ("organization_id","user_id","device_id");--> statement-breakpoint
CREATE INDEX "mobile_sync_session_chunk_session_id_idx" ON "mobile_sync_session_chunk" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_sync_session_chunk_session_id_chunk_index_key" ON "mobile_sync_session_chunk" USING btree ("session_id","chunk_index");
