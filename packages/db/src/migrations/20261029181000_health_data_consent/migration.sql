-- Issue #322 — record explicit, versioned consent to health-data processing.
-- Existing users and already-pending sign-up links are deliberately not backfilled.
ALTER TABLE "sign_up_request"
  ADD COLUMN "health_data_consent_version" text,
  ADD COLUMN "health_data_consent_accepted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "legal_acceptance" DROP CONSTRAINT "legal_acceptance_document_check";
--> statement-breakpoint
ALTER TABLE "legal_acceptance" ADD CONSTRAINT "legal_acceptance_document_check"
  CHECK ("document" in ('terms', 'privacy', 'health_data_consent'));
--> statement-breakpoint
ALTER TABLE "legal_acceptance" DROP CONSTRAINT "legal_acceptance_source_check";
--> statement-breakpoint
ALTER TABLE "legal_acceptance" ADD CONSTRAINT "legal_acceptance_source_check"
  CHECK ("source" in ('sign_up', 're_consent'));
