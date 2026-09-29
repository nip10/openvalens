CREATE TABLE "ingestion_raw_artifact" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider_connection_id" integer,
	"ingestion_job_id" integer,
	"ingestion_batch_id" integer,
	"artifact_type" text NOT NULL,
	"trace_id" text,
	"payload_json" jsonb NOT NULL,
	"size_bytes" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingestion_raw_artifact_size_bytes_non_negative_check" CHECK ("ingestion_raw_artifact"."size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ingestion_raw_artifact" ADD CONSTRAINT "ingestion_raw_artifact_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_raw_artifact" ADD CONSTRAINT "ingestion_raw_artifact_provider_connection_id_provider_connection_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_raw_artifact" ADD CONSTRAINT "ingestion_raw_artifact_ingestion_job_id_ingestion_job_id_fk" FOREIGN KEY ("ingestion_job_id") REFERENCES "public"."ingestion_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_raw_artifact" ADD CONSTRAINT "ingestion_raw_artifact_ingestion_batch_id_ingestion_batch_id_fk" FOREIGN KEY ("ingestion_batch_id") REFERENCES "public"."ingestion_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_raw_artifact" ADD CONSTRAINT "ingestion_raw_artifact_org_provider_connection_fk" FOREIGN KEY ("organization_id","provider_connection_id") REFERENCES "public"."provider_connection"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_raw_artifact" ADD CONSTRAINT "ingestion_raw_artifact_org_ingestion_job_fk" FOREIGN KEY ("organization_id","ingestion_job_id") REFERENCES "public"."ingestion_job"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_raw_artifact" ADD CONSTRAINT "ingestion_raw_artifact_org_ingestion_batch_fk" FOREIGN KEY ("organization_id","ingestion_batch_id") REFERENCES "public"."ingestion_batch"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestion_raw_artifact_organization_id_idx" ON "ingestion_raw_artifact" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ingestion_raw_artifact_provider_connection_id_idx" ON "ingestion_raw_artifact" USING btree ("provider_connection_id");--> statement-breakpoint
CREATE INDEX "ingestion_raw_artifact_ingestion_job_id_idx" ON "ingestion_raw_artifact" USING btree ("ingestion_job_id");--> statement-breakpoint
CREATE INDEX "ingestion_raw_artifact_ingestion_batch_id_idx" ON "ingestion_raw_artifact" USING btree ("ingestion_batch_id");--> statement-breakpoint
CREATE INDEX "ingestion_raw_artifact_trace_id_idx" ON "ingestion_raw_artifact" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "ingestion_raw_artifact_captured_at_idx" ON "ingestion_raw_artifact" USING btree ("captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_raw_artifact_org_id_key" ON "ingestion_raw_artifact" USING btree ("organization_id","id");
