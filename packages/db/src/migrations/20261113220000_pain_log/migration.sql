-- Issue #442: pain log on the body map. A record of what the member rated (a
-- region, a 0-10 rating, an optional type and note), private to the member:
-- keyed by (organization_id, user_id) with a composite foreign key to member,
-- like private_body_measurement. Opt-in per user. Additive only.
CREATE TABLE "pain_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"region" text NOT NULL,
	"rating" smallint NOT NULL,
	"type" text,
	"logged_at" timestamp with time zone NOT NULL,
	"local_date" text NOT NULL,
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pain_entry_region_check" CHECK ("region" ~ '^(front|back|joint)\.[a-z_]{2,40}$'),
	CONSTRAINT "pain_entry_rating_check" CHECK ("rating" between 0 and 10),
	CONSTRAINT "pain_entry_type_check" CHECK ("type" is null or "type" in ('ache', 'sharp', 'burning', 'throbbing', 'stiffness', 'tingling')),
	CONSTRAINT "pain_entry_date_check" CHECK ("local_date" ~ '^\d{4}-\d{2}-\d{2}$'),
	CONSTRAINT "pain_entry_note_check" CHECK ("note" is null or length("note") <= 500),
	CONSTRAINT "pain_entry_source_check" CHECK ("source" = 'manual')
);
--> statement-breakpoint
CREATE TABLE "pain_preference" (
	"user_id" text PRIMARY KEY,
	"enabled" boolean DEFAULT false NOT NULL,
	"ai_visible" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pain_entry_org_user_date_idx" ON "pain_entry" ("organization_id","user_id","local_date");--> statement-breakpoint
CREATE INDEX "pain_entry_org_user_region_logged_idx" ON "pain_entry" ("organization_id","user_id","region","logged_at");--> statement-breakpoint
ALTER TABLE "pain_entry" ADD CONSTRAINT "pain_entry_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pain_entry" ADD CONSTRAINT "pain_entry_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pain_entry" ADD CONSTRAINT "pain_entry_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pain_preference" ADD CONSTRAINT "pain_preference_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
