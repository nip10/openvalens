CREATE TABLE "mobile_device_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_name" text NOT NULL,
	"platform" text NOT NULL,
	"access_token_hash" text NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mobile_pairing_code" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mobile_device_session" ADD CONSTRAINT "mobile_device_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_pairing_code" ADD CONSTRAINT "mobile_pairing_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_device_session_access_token_hash_key" ON "mobile_device_session" USING btree ("access_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_device_session_refresh_token_hash_key" ON "mobile_device_session" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "mobile_device_session_user_id_idx" ON "mobile_device_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mobile_device_session_revoked_at_idx" ON "mobile_device_session" USING btree ("revoked_at");--> statement-breakpoint
CREATE INDEX "mobile_device_session_access_expires_at_idx" ON "mobile_device_session" USING btree ("access_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_pairing_code_code_hash_key" ON "mobile_pairing_code" USING btree ("code_hash") WHERE "mobile_pairing_code"."used_at" is null;--> statement-breakpoint
CREATE INDEX "mobile_pairing_code_user_id_idx" ON "mobile_pairing_code" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mobile_pairing_code_expires_at_idx" ON "mobile_pairing_code" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "mobile_pairing_code_used_at_idx" ON "mobile_pairing_code" USING btree ("used_at");--> statement-breakpoint
