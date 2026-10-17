-- Issue #86 — per-member consent to include a sanitized nutrition summary in
-- the AI Coach conversation.
--
-- `nutrition_coach_consent` is one row per (workspace, member): explicit,
-- revocable, and versioned (a new disclosure version fails closed until the
-- member re-consents). It is separate from the org + per-user AI consent
-- (#13/#123) and from the administrator-configured provider credentials
-- (#57/#59). `include_numbers` is the member's own hide-numbers choice; when
-- false only coverage/completeness is shared with the provider.
--
-- Additive only: one new, empty, org-scoped table; no existing row, column,
-- constraint or index is altered or removed, so no preflight, quarantine or
-- NOT VALID phase is needed.

CREATE TABLE "nutrition_coach_consent" (
	"id" serial PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"granted" boolean DEFAULT false NOT NULL,
	"include_numbers" boolean DEFAULT false NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"consent_version" text DEFAULT 'v1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_coach_consent_revoked_after_granted_check" CHECK ("revoked_at" is null or "revoked_at" >= "granted_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_coach_consent_org_user_key" ON "nutrition_coach_consent" ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "nutrition_coach_consent_user_id_idx" ON "nutrition_coach_consent" ("user_id");--> statement-breakpoint
ALTER TABLE "nutrition_coach_consent" ADD CONSTRAINT "nutrition_coach_consent_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "nutrition_coach_consent" ADD CONSTRAINT "nutrition_coach_consent_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "nutrition_coach_consent" ADD CONSTRAINT "nutrition_coach_consent_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE restrict;
