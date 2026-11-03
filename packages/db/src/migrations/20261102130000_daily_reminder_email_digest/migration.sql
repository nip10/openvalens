CREATE TABLE "daily_reminder_email_digest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"date" text NOT NULL,
	"reminder_ids" integer[] NOT NULL,
	"rendered_email" jsonb NOT NULL,
	"created_at" text DEFAULT now() NOT NULL,
	"delivered_at" text,
	"provider_message_id" text,
	CONSTRAINT "daily_reminder_email_digest_nonempty_reminder_ids" CHECK (cardinality("reminder_ids") > 0),
	CONSTRAINT "daily_reminder_email_digest_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE,
	CONSTRAINT "daily_reminder_email_digest_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE,
	CONSTRAINT "daily_reminder_email_digest_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX "daily_reminder_email_digest_org_user_date_key" ON "daily_reminder_email_digest" USING btree ("organization_id","user_id","date");
--> statement-breakpoint
CREATE INDEX "daily_reminder_email_digest_delivery_idx" ON "daily_reminder_email_digest" USING btree ("delivered_at","created_at");
