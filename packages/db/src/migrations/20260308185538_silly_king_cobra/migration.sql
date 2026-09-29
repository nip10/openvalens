DELETE FROM "data_source" ds
WHERE NOT EXISTS (
  SELECT 1
  FROM "provider_connection" pc
  WHERE pc."organization_id" = ds."organization_id"
    AND pc."id" = ds."provider_connection_id"
);--> statement-breakpoint
UPDATE "ingestion_job" ij
SET "provider_connection_id" = null
WHERE ij."provider_connection_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "provider_connection" pc
    WHERE pc."organization_id" = ij."organization_id"
      AND pc."id" = ij."provider_connection_id"
  );--> statement-breakpoint
DELETE FROM "ingestion_batch" ib
WHERE NOT EXISTS (
  SELECT 1
  FROM "ingestion_job" ij
  WHERE ij."organization_id" = ib."organization_id"
    AND ij."id" = ib."ingestion_job_id"
);--> statement-breakpoint
UPDATE "ingestion_batch" ib
SET "data_source_id" = null
WHERE ib."data_source_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "data_source" ds
    WHERE ds."organization_id" = ib."organization_id"
      AND ds."id" = ib."data_source_id"
  );--> statement-breakpoint
DELETE FROM "metric_sample" ms
WHERE NOT EXISTS (
  SELECT 1
  FROM "metric_definition" md
  WHERE md."organization_id" = ms."organization_id"
    AND md."id" = ms."metric_definition_id"
);--> statement-breakpoint
UPDATE "metric_sample" ms
SET "data_source_id" = null
WHERE ms."data_source_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "data_source" ds
    WHERE ds."organization_id" = ms."organization_id"
      AND ds."id" = ms."data_source_id"
  );--> statement-breakpoint
UPDATE "metric_sample" ms
SET "ingestion_batch_id" = null
WHERE ms."ingestion_batch_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "ingestion_batch" ib
    WHERE ib."organization_id" = ms."organization_id"
      AND ib."id" = ms."ingestion_batch_id"
  );--> statement-breakpoint
UPDATE "health_event" he
SET "data_source_id" = null
WHERE he."data_source_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "data_source" ds
    WHERE ds."organization_id" = he."organization_id"
      AND ds."id" = he."data_source_id"
  );--> statement-breakpoint
UPDATE "health_event" he
SET "ingestion_batch_id" = null
WHERE he."ingestion_batch_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "ingestion_batch" ib
    WHERE ib."organization_id" = he."organization_id"
      AND ib."id" = he."ingestion_batch_id"
  );--> statement-breakpoint
UPDATE "ingestion_error" ie
SET "ingestion_job_id" = null
WHERE ie."ingestion_job_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "ingestion_job" ij
    WHERE ij."organization_id" = ie."organization_id"
      AND ij."id" = ie."ingestion_job_id"
  );--> statement-breakpoint
UPDATE "ingestion_error" ie
SET "ingestion_batch_id" = null
WHERE ie."ingestion_batch_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "ingestion_batch" ib
    WHERE ib."organization_id" = ie."organization_id"
      AND ib."id" = ie."ingestion_batch_id"
  );--> statement-breakpoint
UPDATE "ingestion_error" ie
SET "metric_sample_id" = null
WHERE ie."metric_sample_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "metric_sample" ms
    WHERE ms."organization_id" = ie."organization_id"
      AND ms."id" = ie."metric_sample_id"
  );--> statement-breakpoint
CREATE UNIQUE INDEX "data_source_org_id_key" ON "data_source" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_batch_org_id_key" ON "ingestion_batch" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_job_org_id_key" ON "ingestion_job" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_definition_org_id_key" ON "metric_definition" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_sample_org_id_key" ON "metric_sample" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_connection_org_id_key" ON "provider_connection" USING btree ("organization_id","id");
ALTER TABLE "data_source" ADD CONSTRAINT "data_source_org_provider_connection_fk" FOREIGN KEY ("organization_id","provider_connection_id") REFERENCES "public"."provider_connection"("organization_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "health_event" ADD CONSTRAINT "health_event_org_data_source_fk" FOREIGN KEY ("organization_id","data_source_id") REFERENCES "public"."data_source"("organization_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "health_event" ADD CONSTRAINT "health_event_org_ingestion_batch_fk" FOREIGN KEY ("organization_id","ingestion_batch_id") REFERENCES "public"."ingestion_batch"("organization_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "ingestion_batch" ADD CONSTRAINT "ingestion_batch_org_ingestion_job_fk" FOREIGN KEY ("organization_id","ingestion_job_id") REFERENCES "public"."ingestion_job"("organization_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "ingestion_batch" ADD CONSTRAINT "ingestion_batch_org_data_source_fk" FOREIGN KEY ("organization_id","data_source_id") REFERENCES "public"."data_source"("organization_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "ingestion_error" ADD CONSTRAINT "ingestion_error_org_ingestion_job_fk" FOREIGN KEY ("organization_id","ingestion_job_id") REFERENCES "public"."ingestion_job"("organization_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "ingestion_error" ADD CONSTRAINT "ingestion_error_org_ingestion_batch_fk" FOREIGN KEY ("organization_id","ingestion_batch_id") REFERENCES "public"."ingestion_batch"("organization_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "ingestion_error" ADD CONSTRAINT "ingestion_error_org_metric_sample_fk" FOREIGN KEY ("organization_id","metric_sample_id") REFERENCES "public"."metric_sample"("organization_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "ingestion_job" ADD CONSTRAINT "ingestion_job_org_provider_connection_fk" FOREIGN KEY ("organization_id","provider_connection_id") REFERENCES "public"."provider_connection"("organization_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "metric_sample" ADD CONSTRAINT "metric_sample_org_metric_definition_fk" FOREIGN KEY ("organization_id","metric_definition_id") REFERENCES "public"."metric_definition"("organization_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "metric_sample" ADD CONSTRAINT "metric_sample_org_data_source_fk" FOREIGN KEY ("organization_id","data_source_id") REFERENCES "public"."data_source"("organization_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "metric_sample" ADD CONSTRAINT "metric_sample_org_ingestion_batch_fk" FOREIGN KEY ("organization_id","ingestion_batch_id") REFERENCES "public"."ingestion_batch"("organization_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "data_source" VALIDATE CONSTRAINT "data_source_org_provider_connection_fk";--> statement-breakpoint
ALTER TABLE "ingestion_job" VALIDATE CONSTRAINT "ingestion_job_org_provider_connection_fk";--> statement-breakpoint
ALTER TABLE "ingestion_batch" VALIDATE CONSTRAINT "ingestion_batch_org_ingestion_job_fk";--> statement-breakpoint
ALTER TABLE "ingestion_batch" VALIDATE CONSTRAINT "ingestion_batch_org_data_source_fk";--> statement-breakpoint
ALTER TABLE "metric_sample" VALIDATE CONSTRAINT "metric_sample_org_metric_definition_fk";--> statement-breakpoint
ALTER TABLE "metric_sample" VALIDATE CONSTRAINT "metric_sample_org_data_source_fk";--> statement-breakpoint
ALTER TABLE "metric_sample" VALIDATE CONSTRAINT "metric_sample_org_ingestion_batch_fk";--> statement-breakpoint
ALTER TABLE "health_event" VALIDATE CONSTRAINT "health_event_org_data_source_fk";--> statement-breakpoint
ALTER TABLE "health_event" VALIDATE CONSTRAINT "health_event_org_ingestion_batch_fk";--> statement-breakpoint
ALTER TABLE "ingestion_error" VALIDATE CONSTRAINT "ingestion_error_org_ingestion_job_fk";--> statement-breakpoint
ALTER TABLE "ingestion_error" VALIDATE CONSTRAINT "ingestion_error_org_ingestion_batch_fk";--> statement-breakpoint
ALTER TABLE "ingestion_error" VALIDATE CONSTRAINT "ingestion_error_org_metric_sample_fk";--> statement-breakpoint
