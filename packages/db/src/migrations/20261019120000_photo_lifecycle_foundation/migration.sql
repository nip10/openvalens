-- Issue #85 P2 foundation. NULL means legacy/unmanaged; do not infer a
-- provider/store for pre-existing objects.
ALTER TABLE "stored_object"
  ADD COLUMN "storage_provider" text,
  ADD COLUMN "storage_store_id" text,
  ADD COLUMN "photo_state" text,
  ADD COLUMN "photo_write_state" text,
  ADD COLUMN "photo_deletion_requested_at" timestamptz;

ALTER TABLE "stored_object"
  ADD CONSTRAINT "stored_object_photo_state_check" CHECK (
    ("photo_state" IS NULL AND "photo_write_state" IS NULL AND "storage_provider" IS NULL AND "storage_store_id" IS NULL)
    OR
    ("purpose" = 'progress_photo' AND "photo_state" IS NOT NULL AND "photo_state" IN ('pending', 'ready', 'deleting')
      AND "photo_write_state" IS NOT NULL AND "photo_write_state" IN ('not_started', 'uncertain', 'settled')
      AND "storage_provider" IS NOT NULL AND "storage_store_id" IS NOT NULL
      AND "storage_provider" IN ('local', 's3')
      AND "created_by_user_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "stored_object_storage_identity_pair_check" CHECK (
    ("storage_provider" IS NULL) = ("storage_store_id" IS NULL)
  ),
  ADD CONSTRAINT "stored_object_ready_settled_check" CHECK (
    "photo_state" IS DISTINCT FROM 'ready' OR "photo_write_state" = 'settled'
  );

-- No foreign keys by design: cascades cannot erase pending physical cleanup.
CREATE TABLE "photo_cleanup_intent" (
  "id" text PRIMARY KEY,
  "storage_key" text NOT NULL,
  "storage_provider" text,
  "storage_store_id" text,
  "subject_id" text,
  "org_id" text NOT NULL,
  "write_state" text NOT NULL CHECK ("write_state" IN ('not_started', 'uncertain', 'settled')),
  "attempts" integer NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "last_attempt_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "photo_cleanup_identity_pair_check" CHECK (("storage_provider" IS NULL) = ("storage_store_id" IS NULL)),
  CONSTRAINT "photo_cleanup_provider_check" CHECK ("storage_provider" IS NULL OR "storage_provider" IN ('local', 's3'))
);
CREATE INDEX "photo_cleanup_intent_due_idx" ON "photo_cleanup_intent" ("next_attempt_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "photo_cleanup_intent_storage_key_key" ON "photo_cleanup_intent" ("storage_key");
--> statement-breakpoint

CREATE FUNCTION capture_photo_cleanup_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.purpose = 'progress_photo' THEN
    INSERT INTO photo_cleanup_intent
      (id, storage_key, storage_provider, storage_store_id, subject_id, org_id, write_state)
    VALUES
      (OLD.id, OLD.storage_key,
       OLD.storage_provider, OLD.storage_store_id, OLD.created_by_user_id,
       OLD.organization_id, coalesce(OLD.photo_write_state, 'uncertain'))
    ON CONFLICT (storage_key) DO UPDATE SET write_state =
      CASE WHEN photo_cleanup_intent.write_state = 'uncertain' OR EXCLUDED.write_state = 'uncertain' THEN 'uncertain'
           WHEN photo_cleanup_intent.write_state = 'settled' OR EXCLUDED.write_state = 'settled' THEN 'settled'
           ELSE 'not_started' END;
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER stored_object_photo_cleanup_after_delete
  AFTER DELETE ON stored_object FOR EACH ROW EXECUTE FUNCTION capture_photo_cleanup_intent();
--> statement-breakpoint

CREATE FUNCTION erase_user_progress_photos_before_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM stored_object WHERE purpose = 'progress_photo' AND created_by_user_id = OLD.id;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER user_progress_photo_cleanup_before_delete
  BEFORE DELETE ON "user" FOR EACH ROW EXECUTE FUNCTION erase_user_progress_photos_before_delete();
--> statement-breakpoint

CREATE FUNCTION prevent_managed_photo_reassignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.purpose = 'progress_photo' AND OLD.photo_state IS NOT NULL
     AND NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id THEN
    RAISE EXCEPTION 'managed photo owner cannot be reassigned';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER stored_object_photo_owner_immutable
  BEFORE UPDATE OF created_by_user_id ON stored_object FOR EACH ROW EXECUTE FUNCTION prevent_managed_photo_reassignment();
