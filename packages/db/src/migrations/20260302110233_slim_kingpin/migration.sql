ALTER TABLE "health_connect_sync" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "health_connect_sync" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "health_connect_sync" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "health_connect_sync" ADD COLUMN "failure_stage" text;--> statement-breakpoint
ALTER TABLE "health_connect_sync" ADD COLUMN "conflict_counts_json" jsonb;