ALTER TABLE "mobile_device_session" ADD COLUMN "device_renew_token_hash" text;
--> statement-breakpoint
ALTER TABLE "mobile_device_session" ADD COLUMN "device_renew_expires_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_device_session_device_renew_token_hash_key" ON "mobile_device_session" USING btree ("device_renew_token_hash");
