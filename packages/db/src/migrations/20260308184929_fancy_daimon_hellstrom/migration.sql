CREATE TABLE "data_source" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider_connection_id" integer NOT NULL,
	"source_type" text NOT NULL,
	"source_key" text NOT NULL,
	"display_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"data_source_id" integer,
	"ingestion_batch_id" integer,
	"event_type" text NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"title" text,
	"payload_json" jsonb,
	"source_event_id" text,
	"dedupe_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_batch" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"ingestion_job_id" integer NOT NULL,
	"data_source_id" integer,
	"external_batch_id" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"record_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_error" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"ingestion_job_id" integer,
	"ingestion_batch_id" integer,
	"metric_sample_id" integer,
	"error_code" text NOT NULL,
	"severity" text DEFAULT 'error' NOT NULL,
	"message" text NOT NULL,
	"raw_payload_json" jsonb,
	"dedupe_hash" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_job" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider_connection_id" integer,
	"job_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"triggered_by" text DEFAULT 'system' NOT NULL,
	"idempotency_key" text,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_definition" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"category" text,
	"unit" text,
	"value_type" text DEFAULT 'number' NOT NULL,
	"aggregation_default" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_sample" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"data_source_id" integer,
	"metric_definition_id" integer NOT NULL,
	"ingestion_batch_id" integer,
	"sampled_at" timestamp with time zone NOT NULL,
	"numeric_value" real,
	"text_value" text,
	"unit" text,
	"external_sample_id" text,
	"dedupe_hash" text NOT NULL,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provenance_link" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"target_table" text NOT NULL,
	"target_id" integer NOT NULL,
	"source_table" text NOT NULL,
	"source_id" integer NOT NULL,
	"relation" text DEFAULT 'derived_from' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_connection" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"access_scope" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_source" ADD CONSTRAINT "data_source_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source" ADD CONSTRAINT "data_source_provider_connection_id_provider_connection_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_event" ADD CONSTRAINT "health_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_event" ADD CONSTRAINT "health_event_data_source_id_data_source_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_event" ADD CONSTRAINT "health_event_ingestion_batch_id_ingestion_batch_id_fk" FOREIGN KEY ("ingestion_batch_id") REFERENCES "public"."ingestion_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_batch" ADD CONSTRAINT "ingestion_batch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_batch" ADD CONSTRAINT "ingestion_batch_ingestion_job_id_ingestion_job_id_fk" FOREIGN KEY ("ingestion_job_id") REFERENCES "public"."ingestion_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_batch" ADD CONSTRAINT "ingestion_batch_data_source_id_data_source_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_error" ADD CONSTRAINT "ingestion_error_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_error" ADD CONSTRAINT "ingestion_error_ingestion_job_id_ingestion_job_id_fk" FOREIGN KEY ("ingestion_job_id") REFERENCES "public"."ingestion_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_error" ADD CONSTRAINT "ingestion_error_ingestion_batch_id_ingestion_batch_id_fk" FOREIGN KEY ("ingestion_batch_id") REFERENCES "public"."ingestion_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_error" ADD CONSTRAINT "ingestion_error_metric_sample_id_metric_sample_id_fk" FOREIGN KEY ("metric_sample_id") REFERENCES "public"."metric_sample"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_job" ADD CONSTRAINT "ingestion_job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_job" ADD CONSTRAINT "ingestion_job_provider_connection_id_provider_connection_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_definition" ADD CONSTRAINT "metric_definition_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_sample" ADD CONSTRAINT "metric_sample_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_sample" ADD CONSTRAINT "metric_sample_data_source_id_data_source_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_sample" ADD CONSTRAINT "metric_sample_metric_definition_id_metric_definition_id_fk" FOREIGN KEY ("metric_definition_id") REFERENCES "public"."metric_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_sample" ADD CONSTRAINT "metric_sample_ingestion_batch_id_ingestion_batch_id_fk" FOREIGN KEY ("ingestion_batch_id") REFERENCES "public"."ingestion_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance_link" ADD CONSTRAINT "provenance_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connection" ADD CONSTRAINT "provider_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_source_organization_id_idx" ON "data_source" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "data_source_provider_connection_id_idx" ON "data_source" USING btree ("provider_connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "data_source_org_source_key_key" ON "data_source" USING btree ("organization_id","source_key");--> statement-breakpoint
CREATE INDEX "health_event_organization_id_idx" ON "health_event" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "health_event_event_type_event_at_idx" ON "health_event" USING btree ("event_type","event_at");--> statement-breakpoint
CREATE INDEX "health_event_data_source_id_idx" ON "health_event" USING btree ("data_source_id");--> statement-breakpoint
CREATE INDEX "health_event_ingestion_batch_id_idx" ON "health_event" USING btree ("ingestion_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "health_event_org_dedupe_hash_key" ON "health_event" USING btree ("organization_id","dedupe_hash");--> statement-breakpoint
CREATE INDEX "ingestion_batch_organization_id_idx" ON "ingestion_batch" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ingestion_batch_ingestion_job_id_idx" ON "ingestion_batch" USING btree ("ingestion_job_id");--> statement-breakpoint
CREATE INDEX "ingestion_batch_status_idx" ON "ingestion_batch" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_batch_org_job_external_batch_key" ON "ingestion_batch" USING btree ("organization_id","ingestion_job_id","external_batch_id");--> statement-breakpoint
CREATE INDEX "ingestion_error_organization_id_idx" ON "ingestion_error" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ingestion_error_ingestion_job_id_idx" ON "ingestion_error" USING btree ("ingestion_job_id");--> statement-breakpoint
CREATE INDEX "ingestion_error_ingestion_batch_id_idx" ON "ingestion_error" USING btree ("ingestion_batch_id");--> statement-breakpoint
CREATE INDEX "ingestion_error_severity_idx" ON "ingestion_error" USING btree ("severity");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_error_org_dedupe_hash_key" ON "ingestion_error" USING btree ("organization_id","dedupe_hash");--> statement-breakpoint
CREATE INDEX "ingestion_job_organization_id_idx" ON "ingestion_job" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ingestion_job_status_idx" ON "ingestion_job" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ingestion_job_provider_connection_id_idx" ON "ingestion_job" USING btree ("provider_connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_job_org_idempotency_key" ON "ingestion_job" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "metric_definition_organization_id_idx" ON "metric_definition" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "metric_definition_category_idx" ON "metric_definition" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_definition_org_code_key" ON "metric_definition" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "metric_sample_organization_id_idx" ON "metric_sample" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "metric_sample_metric_definition_id_sampled_at_idx" ON "metric_sample" USING btree ("metric_definition_id","sampled_at");--> statement-breakpoint
CREATE INDEX "metric_sample_data_source_id_idx" ON "metric_sample" USING btree ("data_source_id");--> statement-breakpoint
CREATE INDEX "metric_sample_ingestion_batch_id_idx" ON "metric_sample" USING btree ("ingestion_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_sample_org_dedupe_hash_key" ON "metric_sample" USING btree ("organization_id","dedupe_hash");--> statement-breakpoint
CREATE INDEX "provenance_link_organization_id_idx" ON "provenance_link" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "provenance_link_target_table_target_id_idx" ON "provenance_link" USING btree ("target_table","target_id");--> statement-breakpoint
CREATE INDEX "provenance_link_source_table_source_id_idx" ON "provenance_link" USING btree ("source_table","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provenance_link_org_target_source_relation_key" ON "provenance_link" USING btree ("organization_id","target_table","target_id","source_table","source_id","relation");--> statement-breakpoint
CREATE INDEX "provider_connection_organization_id_idx" ON "provider_connection" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "provider_connection_status_idx" ON "provider_connection" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_connection_org_provider_user_key" ON "provider_connection" USING btree ("organization_id","provider","external_user_id");