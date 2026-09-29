CREATE TYPE "public"."daily_reminder_source_type" AS ENUM('supplement', 'medication', 'activity');--> statement-breakpoint
CREATE TYPE "public"."daily_reminder_status" AS ENUM('pending', 'done', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."telegram_account_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "daily_reminder" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" text NOT NULL,
	"source_type" "daily_reminder_source_type" NOT NULL,
	"source_id" integer NOT NULL,
	"label" text NOT NULL,
	"status" "daily_reminder_status" DEFAULT 'pending' NOT NULL,
	"telegram_message_id" integer,
	"acted_at" text,
	"acted_via" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_account" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"telegram_user_id" text NOT NULL,
	"status" "telegram_account_status" DEFAULT 'active' NOT NULL,
	"connected_at" text NOT NULL,
	"last_webhook_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_connect_token" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"used_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_reminder" ADD CONSTRAINT "daily_reminder_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_account" ADD CONSTRAINT "telegram_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_connect_token" ADD CONSTRAINT "telegram_connect_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_reminder_user_id_date_source_type_source_id_key" ON "daily_reminder" USING btree ("user_id","date","source_type","source_id");--> statement-breakpoint
CREATE INDEX "daily_reminder_user_id_date_status_idx" ON "daily_reminder" USING btree ("user_id","date","status");--> statement-breakpoint
CREATE INDEX "daily_reminder_telegram_message_id_idx" ON "daily_reminder" USING btree ("telegram_message_id");--> statement-breakpoint
CREATE INDEX "telegram_account_user_id_idx" ON "telegram_account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_account_telegram_chat_id_key" ON "telegram_account" USING btree ("telegram_chat_id");--> statement-breakpoint
CREATE INDEX "telegram_account_status_idx" ON "telegram_account" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_connect_token_token_hash_key" ON "telegram_connect_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "telegram_connect_token_user_id_idx" ON "telegram_connect_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "telegram_connect_token_expires_at_idx" ON "telegram_connect_token" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "telegram_connect_token_used_at_idx" ON "telegram_connect_token" USING btree ("used_at");