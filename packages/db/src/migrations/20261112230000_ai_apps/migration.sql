CREATE TABLE "ai_app_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"scopes" text[] NOT NULL,
	"consent_version" text NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"oauth_client_id" text,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_app_grant_kind_check" CHECK ("kind" in ('personal_key', 'oauth')),
	CONSTRAINT "ai_app_grant_label_check" CHECK (length("label") between 1 and 80),
	CONSTRAINT "ai_app_grant_scopes_check" CHECK ('records:read' = any("scopes")),
	CONSTRAINT "ai_app_grant_revoked_reason_check" CHECK (("revoked_at" is null and "revoked_reason" is null) or ("revoked_at" is not null and "revoked_reason" in ('revoked', 'expired')))
);
--> statement-breakpoint
CREATE TABLE "ai_app_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"grant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"display_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_app_call" (
	"id" bigserial PRIMARY KEY,
	"grant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"tool" text NOT NULL,
	"transport" text NOT NULL,
	"status" text NOT NULL,
	"row_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_app_call_transport_check" CHECK ("transport" in ('mcp', 'rest'))
);
--> statement-breakpoint
CREATE INDEX "ai_app_grant_user_id_organization_id_idx" ON "ai_app_grant" ("user_id","organization_id");
--> statement-breakpoint
CREATE INDEX "ai_app_grant_organization_id_idx" ON "ai_app_grant" ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_app_key_key_hash_key" ON "ai_app_key" ("key_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_app_key_grant_id_key" ON "ai_app_key" ("grant_id");
--> statement-breakpoint
CREATE INDEX "ai_app_key_user_id_idx" ON "ai_app_key" ("user_id");
--> statement-breakpoint
CREATE INDEX "ai_app_call_grant_id_created_at_idx" ON "ai_app_call" ("grant_id","created_at");
--> statement-breakpoint
CREATE INDEX "ai_app_call_created_at_idx" ON "ai_app_call" ("created_at");
--> statement-breakpoint
CREATE INDEX "ai_app_call_user_id_idx" ON "ai_app_call" ("user_id");
--> statement-breakpoint
ALTER TABLE "ai_app_grant" ADD CONSTRAINT "ai_app_grant_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "ai_app_grant" ADD CONSTRAINT "ai_app_grant_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "ai_app_grant" ADD CONSTRAINT "ai_app_grant_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "ai_app_key" ADD CONSTRAINT "ai_app_key_grant_id_ai_app_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "ai_app_grant"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "ai_app_key" ADD CONSTRAINT "ai_app_key_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "ai_app_call" ADD CONSTRAINT "ai_app_call_grant_id_ai_app_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "ai_app_grant"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "ai_app_call" ADD CONSTRAINT "ai_app_call_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
