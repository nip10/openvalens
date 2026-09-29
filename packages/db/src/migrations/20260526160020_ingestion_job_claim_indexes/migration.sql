-- Intentionally numbered 0030 because 0029 is reserved on the sibling migration branch (#34).
CREATE INDEX "ingestion_job_queued_claim_idx" ON "ingestion_job" USING btree ("created_at","id") WHERE "status" = 'queued';--> statement-breakpoint
CREATE INDEX "ingestion_job_running_reclaim_idx" ON "ingestion_job" USING btree ("updated_at","created_at","id") WHERE "status" = 'running';
