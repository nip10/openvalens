-- Issue #85 P2 foundation. NULL means legacy/unmanaged; do not infer a
-- provider/store for pre-existing objects.
ALTER TABLE "stored_object"
  ADD COLUMN "storage_provider" text,
  ADD COLUMN "storage_store_id" text,
  ADD COLUMN "photo_state" text,
  ADD COLUMN "photo_write_state" text;

ALTER TABLE "stored_object"
  ADD CONSTRAINT "stored_object_photo_state_check" CHECK (
    ("photo_state" IS NULL AND "photo_write_state" IS NULL AND "storage_provider" IS NULL AND "storage_store_id" IS NULL)
    OR
    ("purpose" = 'progress_photo' AND "photo_state" IS NOT NULL AND "photo_state" IN ('pending', 'ready', 'deleting')
      AND "photo_write_state" IS NOT NULL AND "photo_write_state" IN ('not_started', 'uncertain', 'settled')
      AND "storage_provider" IS NOT NULL AND "storage_store_id" IS NOT NULL
      AND "created_by_user_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "stored_object_ready_settled_check" CHECK (
    "photo_state" IS DISTINCT FROM 'ready' OR "photo_write_state" = 'settled'
  );

-- No foreign keys by design: cascades cannot erase pending physical cleanup.
CREATE TABLE "photo_cleanup_intent" (
  "id" text PRIMARY KEY,
  "storage_key" text NOT NULL,
  "storage_provider" text NOT NULL,
  "storage_store_id" text NOT NULL,
  "subject_user_id" text NOT NULL,
  "organization_id" text NOT NULL,
  "write_state" text NOT NULL CHECK ("write_state" IN ('not_started', 'uncertain', 'settled')),
  "attempts" integer NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "last_attempt_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "photo_cleanup_intent_due_idx" ON "photo_cleanup_intent" ("next_attempt_at");
