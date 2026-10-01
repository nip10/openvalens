-- Mobile weights feed the body domain: a device connection records its owner,
-- and weight_event rows can be superseded like canonical rows (#44).
-- Additive only: nullable columns, no backfill.
ALTER TABLE "provider_connection" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "provider_connection" ADD CONSTRAINT "provider_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "weight_event" ADD COLUMN IF NOT EXISTS "superseded_at" text;
