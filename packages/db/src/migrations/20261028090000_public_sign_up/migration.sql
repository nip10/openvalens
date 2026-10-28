-- Issue #294 — public sign-up for OpenValens Cloud (`DEPLOYMENT_MODE=cloud`).
-- A pending, single-use sign-up link (token digest only) and the record of the
-- legal documents an account accepted. Self-host never writes either table.
CREATE TABLE "sign_up_request" (
	"id" text PRIMARY KEY,
	"canonical_email" text NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"locale" text,
	"terms_version" text NOT NULL,
	"privacy_version" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"user_id" text REFERENCES "user"("id") ON DELETE CASCADE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sign_up_request_canonical_email_check" CHECK ("canonical_email" = lower("canonical_email")),
	CONSTRAINT "sign_up_request_consumed_shape_check" CHECK ("user_id" is null or "consumed_at" is not null)
);
--> statement-breakpoint
CREATE INDEX "sign_up_request_canonical_email_idx" ON "sign_up_request" ("canonical_email");--> statement-breakpoint
CREATE INDEX "sign_up_request_expires_at_idx" ON "sign_up_request" ("expires_at");--> statement-breakpoint
CREATE INDEX "sign_up_request_user_id_idx" ON "sign_up_request" ("user_id");--> statement-breakpoint
CREATE TABLE "legal_acceptance" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"document" text NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_acceptance_document_check" CHECK ("document" in ('terms', 'privacy')),
	CONSTRAINT "legal_acceptance_source_check" CHECK ("source" in ('sign_up'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "legal_acceptance_user_document_version_key" ON "legal_acceptance" ("user_id", "document", "version");--> statement-breakpoint
ALTER TABLE "global_security_event" DROP CONSTRAINT "global_security_event_type_check";--> statement-breakpoint
ALTER TABLE "global_security_event" ADD CONSTRAINT "global_security_event_type_check" CHECK ("event_type" in ('setup_token_minted', 'setup_completed', 'admission_invitation_issued', 'admission_invitation_revoked', 'admission_completed', 'public_sign_up_completed'));
