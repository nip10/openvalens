CREATE TABLE "telegram_webhook_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_update_id" bigint NOT NULL,
	"processed_at" text DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_webhook_event_telegram_update_id_key" ON "telegram_webhook_event" USING btree ("telegram_update_id");