-- Issue #60 — optional cloud wearable adapters (Oura, Whoop, Polar, Withings,
-- Google Health). Phone-first ingestion is unchanged and needs none of this.
--
-- `wearable_connection`   one person's OAuth link to one vendor in a workspace:
--                         AES-256-GCM token ciphertext (bound to the row),
--                         sync cursor and value-free status. Ingested rows
--                         live in the normal metric_sample / health_event
--                         tables via provider_connection -> data_source.
-- `wearable_oauth_state`  SHA-256 of a single-use OAuth `state` (10 minutes).
--
-- Generated with drizzle-kit and reduced to this change's statements. Additive
-- only: new tables, no data movement.

CREATE TABLE "wearable_connection" (
	"id" serial PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider_connection_id" integer NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"access_token_ciphertext" text,
	"refresh_token_ciphertext" text,
	"access_token_expires_at" timestamp with time zone,
	"scope" text,
	"token_version" integer DEFAULT 0 NOT NULL,
	"synced_through" timestamp with time zone,
	"sync_requested_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error_code" text,
	"quarantined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wearable_connection_status_check" CHECK ("status" in ('active', 'reconnect_needed', 'quarantined'))
);
--> statement-breakpoint
CREATE TABLE "wearable_oauth_state" (
	"state_hash" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "wearable_connection_provider_connection_id_key" ON "wearable_connection" ("provider_connection_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "wearable_connection_org_user_provider_key" ON "wearable_connection" ("organization_id","user_id","provider");
--> statement-breakpoint
CREATE INDEX "wearable_connection_status_idx" ON "wearable_connection" ("status","sync_requested_at");
--> statement-breakpoint
CREATE INDEX "wearable_oauth_state_expires_at_idx" ON "wearable_oauth_state" ("expires_at");
--> statement-breakpoint
ALTER TABLE "wearable_connection" ADD CONSTRAINT "wearable_connection_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "wearable_connection" ADD CONSTRAINT "wearable_connection_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "wearable_connection" ADD CONSTRAINT "wearable_connection_org_provider_connection_fk" FOREIGN KEY ("organization_id","provider_connection_id") REFERENCES "provider_connection"("organization_id","id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "wearable_connection" ADD CONSTRAINT "wearable_connection_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "wearable_oauth_state" ADD CONSTRAINT "wearable_oauth_state_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "wearable_oauth_state" ADD CONSTRAINT "wearable_oauth_state_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "wearable_oauth_state" ADD CONSTRAINT "wearable_oauth_state_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE CASCADE;
