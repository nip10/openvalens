-- Issue #125 — Enforce tenant isolation in scheduled reminders.
--
-- `daily_reminder` previously had a per-user unique constraint on
-- (user_id, date, source_type, source_id). A user can be a member of multiple
-- organizations (see member.organization_id_user_id_key uniqueness), so that
-- constraint is NOT tenant-safe by transitivity: the same slot identity could
-- collide across orgs.
--
-- This migration:
--   * drops the per-user unique and replaces it with a per-(org, user, slot)
--     unique so two orgs can each hold their own reminder for the same
--     user/date/source without conflict;
--   * adds a partial index over pending, undelivered reminders to support the
--     daily cron selection in O(log n) per organization.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_reminder_user_id_date_source_type_source_id_key'
  ) THEN
    ALTER TABLE "daily_reminder"
      DROP CONSTRAINT "daily_reminder_user_id_date_source_type_source_id_key";
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_reminder_organization_id_user_id_date_source_type_source_id_key'
  ) THEN
    ALTER TABLE "daily_reminder"
      ADD CONSTRAINT "daily_reminder_organization_id_user_id_date_source_type_source_id_key"
      UNIQUE ("organization_id", "user_id", "date", "source_type", "source_id");
  END IF;
END $$;
--> statement-breakpoint

-- Backs the daily cron's pending-reminder selection per organization/date.
-- A partial index keeps the working set tight to the rows the cron's WHERE
-- predicate can actually touch (status = 'pending' AND telegram_message_id IS NULL).
CREATE INDEX IF NOT EXISTS "daily_reminder_organization_id_date_pending_idx"
  ON "daily_reminder" ("organization_id", "date")
  WHERE "status" = 'pending' AND "telegram_message_id" IS NULL;
