-- Additive ownership for new person-attributed sleep evidence. Existing rows
-- remain NULL: no historical owner is inferred from organization or creator.
ALTER TABLE "health_event" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "health_event" ADD CONSTRAINT "health_event_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "health_event" ADD CONSTRAINT "health_event_org_user_member_fk"
    FOREIGN KEY ("organization_id", "user_id") REFERENCES "public"."member"("organization_id", "user_id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "health_event_owner_type_time_idx"
  ON "health_event" USING btree ("organization_id", "user_id", "event_type", "event_at");
