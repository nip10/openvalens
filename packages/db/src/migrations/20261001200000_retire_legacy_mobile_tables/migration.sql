-- Issue #46 — Retire legacy mobile tables.
--
-- The byte-level sync path (Issue #27, pre #40) used these tables. They have
-- been superseded by the cursor + ingest pipeline (Issue #7) and the
-- Better Auth Expo session (Issue #29). They are no longer read by the
-- server, and only dead code in tests references them.
--
-- Migration-safety rules followed (docs/migration-safety.md):
--   - Quarantine-over-DELETE: the tables are renamed with a `_quarantine_`
--     prefix rather than dropped. The data is preserved for the audit
--     retention window (90 days), so a rollback can read it back.
--   - No destructive statement runs in the same migration as the rename —
--     a follow-up migration can drop the renamed tables after the
--     retention window expires.
--   - The renames are gated by IF EXISTS guards so re-running the
--     migration is a no-op.

ALTER TABLE IF EXISTS "mobile_sync_session" RENAME TO "_quarantine_legacy_mobile_sync_session";--> statement-breakpoint
ALTER TABLE IF EXISTS "mobile_sync_session_chunk" RENAME TO "_quarantine_legacy_mobile_sync_session_chunk";--> statement-breakpoint
ALTER TABLE IF EXISTS "mobile_pairing_code" RENAME TO "_quarantine_legacy_mobile_pairing_code";--> statement-breakpoint
ALTER TABLE IF EXISTS "mobile_pairing_rate_limit" RENAME TO "_quarantine_legacy_mobile_pairing_rate_limit";--> statement-breakpoint
ALTER TABLE IF EXISTS "mobile_device_session" RENAME TO "_quarantine_legacy_mobile_device_session";