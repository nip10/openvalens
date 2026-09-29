CREATE TABLE "mobile_pairing_rate_limit" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mobile_pairing_rate_limit_blocked_until_idx" ON "mobile_pairing_rate_limit" USING btree ("blocked_until");--> statement-breakpoint
CREATE INDEX "mobile_pairing_rate_limit_window_started_at_idx" ON "mobile_pairing_rate_limit" USING btree ("window_started_at");