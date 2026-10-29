CREATE TYPE "public"."data_export_job_state" AS ENUM ('queued', 'running', 'ready', 'failed', 'cancelled', 'expired');
CREATE TYPE "public"."data_export_failure" AS ENUM ('LIMIT_EXCEEDED', 'ATTACHMENT_UNAVAILABLE', 'STORAGE_UNAVAILABLE', 'INTERRUPTED', 'INTERNAL');
CREATE TABLE "data_export_job" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subject_user_id" text,
  "state" "data_export_job_state" DEFAULT 'queued' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "lease_until" timestamp with time zone,
  "attempt_id" uuid,
  "organization_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "bytes" bigint,
  "checksum" text,
  "failure" "data_export_failure",
  "cleanup_pending" text
);
ALTER TABLE "data_export_job" ADD CONSTRAINT "data_export_job_subject_user_id_user_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
CREATE INDEX "data_export_job_owner_state_idx" ON "data_export_job" USING btree ("subject_user_id", "state", "created_at");
CREATE INDEX "data_export_job_state_created_idx" ON "data_export_job" USING btree ("state", "created_at");
