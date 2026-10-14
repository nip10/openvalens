CREATE TABLE "product_settings" (
	"id" text PRIMARY KEY,
	"units" text DEFAULT 'metric' NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_settings_id_check" CHECK ("id" = 'instance'),
	CONSTRAINT "product_settings_units_check" CHECK ("units" in ('metric', 'imperial')),
	CONSTRAINT "product_settings_locale_check" CHECK ("locale" in ('en-US', 'en-GB', 'en-CA')),
	CONSTRAINT "product_settings_revision_check" CHECK ("revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_settings_audit" (
	"id" text PRIMARY KEY,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"changed_keys" text NOT NULL,
	"revision" integer NOT NULL,
	CONSTRAINT "product_settings_audit_changed_keys_check" CHECK ("changed_keys" in ('units', 'locale', 'units,locale')),
	CONSTRAINT "product_settings_audit_revision_check" CHECK ("revision" >= 0)
);
--> statement-breakpoint
CREATE INDEX "product_settings_audit_occurred_at_idx" ON "product_settings_audit" ("occurred_at");--> statement-breakpoint
CREATE INDEX "product_settings_audit_actor_user_id_idx" ON "product_settings_audit" ("actor_user_id");--> statement-breakpoint
ALTER TABLE "product_settings_audit" ADD CONSTRAINT "product_settings_audit_actor_user_id_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
-- Seed the singleton product-settings row (Issue #58).
--
-- Defaults to metric / en-US at revision 0. Idempotent: preserves any existing
-- row, so re-running the seed (or applying after a partially-applied state)
-- never resets a value or the revision. No user, role or audit row is created.
INSERT INTO "product_settings" ("id", "units", "locale", "revision")
VALUES ('instance', 'metric', 'en-US', 0)
ON CONFLICT ("id") DO NOTHING;
