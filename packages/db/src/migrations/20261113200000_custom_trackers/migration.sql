-- Issue #441: custom trackers (mood, sauna, dead hangs, ...). Rows are keyed by
-- the owning member (organization_id, user_id) with a composite foreign key to
-- member, like cycle_period. Private by default. Additive only.
CREATE TABLE "custom_tracker" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"template" text,
	"type" text NOT NULL,
	"unit" text,
	"decimals" integer DEFAULT 0 NOT NULL,
	"aggregation" text NOT NULL,
	"target_value" double precision,
	"target_period" text,
	"shared" boolean DEFAULT false NOT NULL,
	"ai_visible" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_tracker_name_check" CHECK (length(btrim("name")) between 1 and 40),
	CONSTRAINT "custom_tracker_icon_check" CHECK (length("icon") between 1 and 40),
	CONSTRAINT "custom_tracker_type_check" CHECK ("type" in ('number', 'scale', 'yes_no', 'duration')),
	CONSTRAINT "custom_tracker_unit_check" CHECK (("type" = 'number' and "unit" is not null and length(btrim("unit")) between 1 and 12) or ("type" <> 'number' and "unit" is null)),
	CONSTRAINT "custom_tracker_decimals_check" CHECK ("decimals" between 0 and 2),
	CONSTRAINT "custom_tracker_aggregation_check" CHECK (("type" = 'number' and "aggregation" in ('sum', 'average', 'last')) or ("type" = 'duration' and "aggregation" = 'sum') or ("type" = 'scale' and "aggregation" = 'average') or ("type" = 'yes_no' and "aggregation" = 'any')),
	CONSTRAINT "custom_tracker_target_check" CHECK (("target_value" is null and "target_period" is null) or ("target_value" > 0 and "target_period" in ('day', 'week')))
);
--> statement-breakpoint
CREATE TABLE "custom_tracker_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tracker_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"logged_by_user_id" text,
	"value" double precision NOT NULL,
	"logged_at" timestamp with time zone NOT NULL,
	"local_date" text NOT NULL,
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_record_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_tracker_entry_date_check" CHECK ("local_date" ~ '^\d{4}-\d{2}-\d{2}$'),
	CONSTRAINT "custom_tracker_entry_note_check" CHECK ("note" is null or length("note") <= 500),
	CONSTRAINT "custom_tracker_entry_source_check" CHECK (("source" = 'manual' and "source_record_id" is null) or ("source" in ('health_connect', 'healthkit') and "source_record_id" is not null))
);
--> statement-breakpoint
CREATE INDEX "custom_tracker_org_user_idx" ON "custom_tracker" ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "custom_tracker_org_shared_idx" ON "custom_tracker" ("organization_id") WHERE "shared";--> statement-breakpoint
CREATE UNIQUE INDEX "custom_tracker_id_org_user_key" ON "custom_tracker" ("id","organization_id","user_id");--> statement-breakpoint
CREATE INDEX "custom_tracker_entry_tracker_date_idx" ON "custom_tracker_entry" ("tracker_id","local_date");--> statement-breakpoint
CREATE INDEX "custom_tracker_entry_org_user_logged_idx" ON "custom_tracker_entry" ("organization_id","user_id","logged_at");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_tracker_entry_source_record_key" ON "custom_tracker_entry" ("organization_id","user_id","tracker_id","source","source_record_id") WHERE "source_record_id" is not null;--> statement-breakpoint
ALTER TABLE "custom_tracker" ADD CONSTRAINT "custom_tracker_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "custom_tracker" ADD CONSTRAINT "custom_tracker_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "custom_tracker" ADD CONSTRAINT "custom_tracker_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "custom_tracker_entry" ADD CONSTRAINT "custom_tracker_entry_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "custom_tracker_entry" ADD CONSTRAINT "custom_tracker_entry_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "custom_tracker_entry" ADD CONSTRAINT "custom_tracker_entry_logged_by_user_id_user_id_fkey" FOREIGN KEY ("logged_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "custom_tracker_entry" ADD CONSTRAINT "custom_tracker_entry_tracker_fk" FOREIGN KEY ("tracker_id","organization_id","user_id") REFERENCES "custom_tracker"("id","organization_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "custom_tracker_entry" ADD CONSTRAINT "custom_tracker_entry_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE CASCADE;
