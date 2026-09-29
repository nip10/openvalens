ALTER TABLE "mobile_device_session" ADD COLUMN "previous_refresh_token_hash" text;
--> statement-breakpoint
ALTER TABLE "mobile_device_session" ADD COLUMN "previous_device_renew_token_hash" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_device_session_previous_refresh_token_hash_key" ON "mobile_device_session" USING btree ("previous_refresh_token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_device_session_previous_device_renew_token_hash_key" ON "mobile_device_session" USING btree ("previous_device_renew_token_hash");
