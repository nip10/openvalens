-- Issue #439 (M2a): AI app writes. `ai_app_write` is the receipt of one write
-- call (grant + mutation id, a fingerprint of the request, entry ids in the
-- outcome; never the request's values), so a retry never duplicates. It also
-- carries the call's entry count for the per-grant daily limit.
-- `ai_app_entry` is each entry an AI app wrote: its source tag (the grant) and
-- the domain rows it made, so the app can delete only its own entries and the
-- member can delete everything one app wrote. Additive only.
CREATE TABLE "ai_app_write" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"grant_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"mutation_id" text NOT NULL,
	"tool" text NOT NULL,
	"fingerprint" text NOT NULL,
	"entry_count" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"outcome" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ai_app_write_mutation_id_check" CHECK (length("mutation_id") between 1 and 64),
	CONSTRAINT "ai_app_write_status_check" CHECK ("status" in ('pending', 'done')),
	CONSTRAINT "ai_app_write_entry_count_check" CHECK ("entry_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_app_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"grant_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"write_id" uuid NOT NULL,
	"item_index" integer NOT NULL,
	"kind" text NOT NULL,
	"target_table" text NOT NULL,
	"target_ids" integer[] NOT NULL,
	"possible_duplicate" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_app_entry_target_table_check" CHECK ("target_table" in ('metric_sample', 'plain_water_entry', 'supplement_intake'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_app_write_grant_id_mutation_id_key" ON "ai_app_write" ("grant_id","mutation_id");
--> statement-breakpoint
CREATE INDEX "ai_app_write_grant_id_created_at_idx" ON "ai_app_write" ("grant_id","created_at");
--> statement-breakpoint
CREATE INDEX "ai_app_write_user_id_idx" ON "ai_app_write" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_app_entry_write_id_item_index_key" ON "ai_app_entry" ("write_id","item_index");
--> statement-breakpoint
CREATE INDEX "ai_app_entry_grant_id_created_at_idx" ON "ai_app_entry" ("grant_id","created_at");
--> statement-breakpoint
CREATE INDEX "ai_app_entry_user_id_idx" ON "ai_app_entry" ("user_id");
--> statement-breakpoint
CREATE INDEX "ai_app_entry_organization_id_target_table_idx" ON "ai_app_entry" ("organization_id","target_table");
--> statement-breakpoint
ALTER TABLE "ai_app_write" ADD CONSTRAINT "ai_app_write_grant_id_ai_app_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "ai_app_grant"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "ai_app_write" ADD CONSTRAINT "ai_app_write_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "ai_app_write" ADD CONSTRAINT "ai_app_write_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "ai_app_entry" ADD CONSTRAINT "ai_app_entry_grant_id_ai_app_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "ai_app_grant"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "ai_app_entry" ADD CONSTRAINT "ai_app_entry_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "ai_app_entry" ADD CONSTRAINT "ai_app_entry_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "ai_app_entry" ADD CONSTRAINT "ai_app_entry_write_id_ai_app_write_id_fkey" FOREIGN KEY ("write_id") REFERENCES "ai_app_write"("id") ON DELETE CASCADE;
