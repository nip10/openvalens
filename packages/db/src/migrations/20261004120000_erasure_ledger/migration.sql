-- Issue #89 — erasure ledger.
--
-- Records each completed "delete everything" request (subject user id,
-- erased organization ids, per-table row counts). Additive only. No foreign
-- keys on purpose: the ledger must survive the erased rows so a restore from
-- an older backup can be re-erased (#64). No health values are stored.

CREATE TABLE IF NOT EXISTS "erasure_ledger" (
	"id" serial PRIMARY KEY,
	"subject_user_id" text NOT NULL,
	"organization_ids" jsonb NOT NULL,
	"row_counts" jsonb NOT NULL,
	"erased_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "erasure_ledger_subject_user_id_idx" ON "erasure_ledger" ("subject_user_id");
