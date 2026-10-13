CREATE TABLE "admission_grant" (
	"id" text PRIMARY KEY,
	"kind" text NOT NULL,
	"generation" integer,
	"canonical_email" text NOT NULL,
	"target_user_id" text,
	"inviter_user_id" text,
	"invitation_token_hash" text UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"verification_code_hash" text,
	"verification_expires_at" timestamp with time zone,
	"verification_attempts" integer DEFAULT 0 NOT NULL,
	"send_count" integer DEFAULT 0 NOT NULL,
	"send_window_started_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_grant_kind_check" CHECK ("kind" in ('setup', 'invitation')),
	CONSTRAINT "admission_grant_setup_shape_check" CHECK ("kind" <> 'setup' or ("generation" is not null and "inviter_user_id" is null and "invitation_token_hash" is null)),
	CONSTRAINT "admission_grant_invitation_shape_check" CHECK ("kind" <> 'invitation' or ("generation" is null and "inviter_user_id" is not null and "invitation_token_hash" is not null)),
	CONSTRAINT "admission_grant_verification_pair_check" CHECK (("verification_code_hash" is null and "verification_expires_at" is null) or ("verification_code_hash" is not null and "verification_expires_at" is not null)),
	CONSTRAINT "admission_grant_verification_attempts_check" CHECK ("verification_attempts" >= 0 and "verification_attempts" <= 5),
	CONSTRAINT "admission_grant_send_count_check" CHECK ("send_count" >= 0 and "send_count" <= 3),
	CONSTRAINT "admission_grant_canonical_email_check" CHECK ("canonical_email" = lower("canonical_email"))
);
--> statement-breakpoint
CREATE TABLE "global_security_event" (
	"id" text PRIMARY KEY,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" text,
	"target_user_id" text,
	"grant_id" text,
	CONSTRAINT "global_security_event_type_check" CHECK ("event_type" in ('setup_token_minted', 'setup_completed', 'admission_invitation_issued', 'admission_invitation_revoked', 'admission_completed'))
);
--> statement-breakpoint
CREATE TABLE "instance_admission" (
	"id" text PRIMARY KEY,
	"state" text NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"setup_token_hash" text,
	"setup_expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "instance_admission_id_check" CHECK ("id" = 'instance'),
	CONSTRAINT "instance_admission_state_check" CHECK ("state" in ('pending', 'invite_only')),
	CONSTRAINT "instance_admission_token_pair_check" CHECK (("setup_token_hash" is null and "setup_expires_at" is null) or ("setup_token_hash" is not null and "setup_expires_at" is not null)),
	CONSTRAINT "instance_admission_invite_only_check" CHECK ("state" <> 'invite_only' or ("setup_token_hash" is null and "setup_expires_at" is null))
);
--> statement-breakpoint
CREATE INDEX "admission_grant_target_user_id_idx" ON "admission_grant" ("target_user_id");--> statement-breakpoint
CREATE INDEX "admission_grant_inviter_user_id_idx" ON "admission_grant" ("inviter_user_id");--> statement-breakpoint
CREATE INDEX "admission_grant_canonical_email_idx" ON "admission_grant" ("canonical_email");--> statement-breakpoint
CREATE INDEX "admission_grant_expires_at_idx" ON "admission_grant" ("expires_at");--> statement-breakpoint
CREATE INDEX "admission_grant_verification_expires_at_idx" ON "admission_grant" ("verification_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admission_grant_setup_generation_key" ON "admission_grant" ("generation") WHERE "kind" = 'setup';--> statement-breakpoint
CREATE INDEX "global_security_event_occurred_at_idx" ON "global_security_event" ("occurred_at");--> statement-breakpoint
CREATE INDEX "global_security_event_actor_user_id_idx" ON "global_security_event" ("actor_user_id");--> statement-breakpoint
CREATE INDEX "global_security_event_target_user_id_idx" ON "global_security_event" ("target_user_id");--> statement-breakpoint
ALTER TABLE "admission_grant" ADD CONSTRAINT "admission_grant_target_user_id_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "admission_grant" ADD CONSTRAINT "admission_grant_inviter_user_id_user_id_fkey" FOREIGN KEY ("inviter_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "global_security_event" ADD CONSTRAINT "global_security_event_actor_user_id_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "global_security_event" ADD CONSTRAINT "global_security_event_target_user_id_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
-- Bootstrap the singleton admission row (Issue #63).
--
-- `invite_only` when an instance administrator already exists: the exact CSV
-- token `admin` in `user.role`, no trimming, banned admins included as a
-- takeover-safety measure. Otherwise the installation stays `pending` until a
-- one-time setup token is minted. `generation` starts at 0 with no hash/expiry,
-- and no role is ever granted here. Preserves all existing rows.
INSERT INTO "instance_admission" ("id", "state", "generation", "setup_token_hash", "setup_expires_at", "completed_at")
SELECT
	'instance',
	CASE WHEN EXISTS (SELECT 1 FROM "user" WHERE 'admin' = ANY(string_to_array("role", ','))) THEN 'invite_only' ELSE 'pending' END,
	0,
	NULL,
	NULL,
	CASE WHEN EXISTS (SELECT 1 FROM "user" WHERE 'admin' = ANY(string_to_array("role", ','))) THEN now() ELSE NULL END
ON CONFLICT ("id") DO NOTHING;
