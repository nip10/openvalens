-- Issue #323: explicit, versioned checkout acknowledgements. Never backfill
-- acceptance; only the signed-in owner can create these records.
CREATE TABLE "billing_checkout_acknowledgement" (
	"id" uuid PRIMARY KEY,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"immediate_start_requested" boolean NOT NULL,
	"withdrawal_acknowledged" boolean NOT NULL,
	"stripe_checkout_session_id" text UNIQUE,
	CONSTRAINT "billing_checkout_acknowledgement_true_only" CHECK ("immediate_start_requested" = true AND "withdrawal_acknowledged" = true)
);
--> statement-breakpoint
CREATE INDEX "billing_checkout_acknowledgement_user_id_idx" ON "billing_checkout_acknowledgement" ("user_id");
