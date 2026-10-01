-- #44: mobile deletions and edited records supersede canonical rows instead
-- of deleting them. Additive only: nullable columns (no rewrite, no backfill)
-- and lookup indexes for supersession by source record id.
ALTER TABLE "metric_sample" ADD COLUMN IF NOT EXISTS "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "health_event" ADD COLUMN IF NOT EXISTS "superseded_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metric_sample_organization_id_external_sample_id_idx" ON "metric_sample" ("organization_id", "external_sample_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "health_event_organization_id_source_event_id_idx" ON "health_event" ("organization_id", "source_event_id");
