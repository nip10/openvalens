ALTER TABLE "telegram_webhook_event" ALTER COLUMN "processed_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "telegram_webhook_event" ALTER COLUMN "processed_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_webhook_event" ADD COLUMN "status" text DEFAULT 'processing' NOT NULL;