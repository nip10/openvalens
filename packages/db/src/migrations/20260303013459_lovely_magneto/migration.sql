ALTER TABLE "telegram_webhook_event" ALTER COLUMN "claimed_at" SET DEFAULT now();--> statement-breakpoint

ALTER TABLE "medication" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "scheduled_event" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "supplement_schedule" ADD COLUMN "user_id" text;--> statement-breakpoint

INSERT INTO "user" ("id", "email")
SELECT '__migration_owner__', '__migration_owner__@local.invalid'
WHERE NOT EXISTS (
  SELECT 1
  FROM "user"
);--> statement-breakpoint

UPDATE "medication"
SET "user_id" = (
  SELECT "id"
  FROM "user"
  ORDER BY "created_at" ASC NULLS LAST, "id" ASC
  LIMIT 1
)
WHERE "user_id" IS NULL;--> statement-breakpoint

UPDATE "scheduled_event"
SET "user_id" = (
  SELECT "id"
  FROM "user"
  ORDER BY "created_at" ASC NULLS LAST, "id" ASC
  LIMIT 1
)
WHERE "user_id" IS NULL;--> statement-breakpoint

UPDATE "supplement_schedule"
SET "user_id" = (
  SELECT "id"
  FROM "user"
  ORDER BY "created_at" ASC NULLS LAST, "id" ASC
  LIMIT 1
)
WHERE "user_id" IS NULL;--> statement-breakpoint

ALTER TABLE "medication" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_event" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "supplement_schedule" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "medication" ADD CONSTRAINT "medication_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_event" ADD CONSTRAINT "scheduled_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplement_schedule" ADD CONSTRAINT "supplement_schedule_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "medication_user_id_status_idx" ON "medication" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "scheduled_event_user_id_start_date_end_date_idx" ON "scheduled_event" USING btree ("user_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "supplement_schedule_user_id_status_idx" ON "supplement_schedule" USING btree ("user_id","status");
