ALTER TABLE "telegram_webhook_event" ADD COLUMN "claimed_at" text DEFAULT now() NOT NULL;
