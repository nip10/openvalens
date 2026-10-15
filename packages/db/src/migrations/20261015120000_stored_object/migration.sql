-- Issue #62 — object storage metadata.
--
-- One row per object kept in object storage (local disk or S3-compatible).
-- The bytes live in the storage backend; this table is their only index, so
-- data-rights export and delete (#89) cover every stored object. Storage keys
-- are opaque (`org/<organization id>/<object id>`) and carry no health detail.
-- Additive only.

CREATE TABLE IF NOT EXISTS "stored_object" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"created_by_user_id" text,
	"purpose" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_object_purpose_check" CHECK ("purpose" in ('progress_photo', 'clinical_export', 'lab_document', 'export_bundle')),
	CONSTRAINT "stored_object_size_bytes_check" CHECK ("size_bytes" >= 0),
	CONSTRAINT "stored_object_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint
ALTER TABLE "stored_object" ADD CONSTRAINT "stored_object_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_object" ADD CONSTRAINT "stored_object_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stored_object_storage_key_key" ON "stored_object" ("storage_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stored_object_organization_id_purpose_idx" ON "stored_object" ("organization_id","purpose","created_at");
