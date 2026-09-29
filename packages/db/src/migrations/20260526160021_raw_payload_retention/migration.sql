-- Migration 0031 is reserved for issue #15.
-- Open PR migrations already reserved: 0029 (#16) and 0030 (#17).
ALTER TABLE "ingestion_raw_artifact" ADD COLUMN "retention_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "ingestion_raw_artifact" ADD COLUMN "purged_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "ingestion_raw_artifact" ADD COLUMN "payload_hash" text;
--> statement-breakpoint
ALTER TABLE "ingestion_raw_artifact" ADD COLUMN "retention_class" text;
--> statement-breakpoint
ALTER TABLE "mobile_sync_session_chunk" ADD COLUMN "retention_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "mobile_sync_session_chunk" ADD COLUMN "purged_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "mobile_sync_session_chunk" ADD COLUMN "payload_hash" text;
--> statement-breakpoint
UPDATE "ingestion_raw_artifact"
SET "retention_class" = COALESCE("retention_class", 'legacy'),
    "retention_until" = COALESCE("retention_until", "created_at" + INTERVAL '365 days'),
    "payload_hash" = COALESCE("payload_hash", NULL)
WHERE "purged_at" IS NULL;
--> statement-breakpoint
UPDATE "mobile_sync_session_chunk"
SET "retention_until" = COALESCE("retention_until", "received_at" + INTERVAL '30 days'),
    "payload_hash" = COALESCE("payload_hash", "chunk_hash")
WHERE "purged_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "ingestion_raw_artifact_retention_until_purged_idx" ON "ingestion_raw_artifact" USING btree ("retention_until","purged_at") WHERE "purged_at" IS NULL;--> statement-breakpoint
CREATE INDEX "mobile_sync_session_chunk_retention_until_purged_idx" ON "mobile_sync_session_chunk" USING btree ("retention_until","purged_at") WHERE "purged_at" IS NULL;
