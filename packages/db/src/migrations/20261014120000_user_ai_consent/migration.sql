-- Issue #123 — per-user AI consent.
--
-- One row per user recording whether that individual has personally granted AI
-- processing. Independent of `organization.metadata.aiConsent` (#13): the
-- org-level gate keeps working and both must pass before any AI call runs.
-- Metadata-only (no health values), additive only.

CREATE TABLE IF NOT EXISTS "user_ai_consent" (
	"user_id" text NOT NULL,
	"granted" boolean DEFAULT false NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"consent_version" text DEFAULT 'v1' NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_ai_consent_revoked_after_granted_check" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "granted_at")
);--> statement-breakpoint
ALTER TABLE "user_ai_consent" ADD CONSTRAINT "user_ai_consent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_ai_consent_user_id_key" ON "user_ai_consent" ("user_id");
