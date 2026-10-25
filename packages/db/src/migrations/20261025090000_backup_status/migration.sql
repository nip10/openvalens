-- Issue #64 — backup status, written by the self-host backup service.
--
-- `backup_run` is an append-only log of backup, verify and restore runs
-- (deploy/backup/openvalens-backup.sh writes it with psql). The server only
-- reads it, for the readiness probe and the admin backup panel. `detail` is a
-- short, value-free failure reason (a step name such as "pg_dump" or
-- "checksum"), never a path, key or database content.
--
-- `backup_schedule` is a singleton row the scheduler upserts with its next
-- planned run, so the admin panel can show it.
--
-- Additive only. No personal data.

CREATE TABLE IF NOT EXISTS "backup_run" (
	"id" serial PRIMARY KEY,
	"operation" text NOT NULL,
	"trigger" text NOT NULL,
	"outcome" text NOT NULL,
	"backup_id" text,
	"size_bytes" bigint,
	"detail" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_run_operation_check" CHECK ("operation" in ('backup', 'verify', 'restore')),
	CONSTRAINT "backup_run_trigger_check" CHECK ("trigger" in ('daily', 'pre-migrate', 'manual')),
	CONSTRAINT "backup_run_outcome_check" CHECK ("outcome" in ('ok', 'failed')),
	CONSTRAINT "backup_run_detail_length_check" CHECK ("detail" is null or char_length("detail") <= 200)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_run_operation_finished_at_idx" ON "backup_run" ("operation", "finished_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backup_schedule" (
	"id" text PRIMARY KEY,
	"next_run_at" timestamp with time zone,
	"hour_utc" integer NOT NULL,
	"daily_retain" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_schedule_id_check" CHECK ("id" = 'instance'),
	CONSTRAINT "backup_schedule_hour_utc_check" CHECK ("hour_utc" between 0 and 23),
	CONSTRAINT "backup_schedule_daily_retain_check" CHECK ("daily_retain" >= 0)
);
