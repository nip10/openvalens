CREATE TYPE "public"."ingestion_batch_status" AS ENUM('processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ingestion_error_severity" AS ENUM('info', 'warning', 'error');--> statement-breakpoint
CREATE TYPE "public"."ingestion_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."metric_definition_value_type" AS ENUM('number', 'text', 'boolean', 'json');--> statement-breakpoint
CREATE TYPE "public"."provider_connection_status" AS ENUM('active', 'revoked', 'disconnected');--> statement-breakpoint
UPDATE "ingestion_batch"
SET "status" = 'processing'
WHERE "status" IS NULL
   OR "status" NOT IN ('processing', 'completed', 'failed');--> statement-breakpoint
ALTER TABLE "ingestion_batch" ALTER COLUMN "status" SET DEFAULT 'processing'::"public"."ingestion_batch_status";--> statement-breakpoint
ALTER TABLE "ingestion_batch" ALTER COLUMN "status" SET DATA TYPE "public"."ingestion_batch_status" USING "status"::"public"."ingestion_batch_status";--> statement-breakpoint
UPDATE "ingestion_error"
SET "severity" = 'error'
WHERE "severity" IS NULL
   OR "severity" NOT IN ('info', 'warning', 'error');--> statement-breakpoint
ALTER TABLE "ingestion_error" ALTER COLUMN "severity" SET DEFAULT 'error'::"public"."ingestion_error_severity";--> statement-breakpoint
ALTER TABLE "ingestion_error" ALTER COLUMN "severity" SET DATA TYPE "public"."ingestion_error_severity" USING "severity"::"public"."ingestion_error_severity";--> statement-breakpoint
UPDATE "ingestion_job"
SET "status" = 'queued'
WHERE "status" IS NULL
   OR "status" NOT IN ('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
ALTER TABLE "ingestion_job" ALTER COLUMN "status" SET DEFAULT 'queued'::"public"."ingestion_job_status";--> statement-breakpoint
ALTER TABLE "ingestion_job" ALTER COLUMN "status" SET DATA TYPE "public"."ingestion_job_status" USING "status"::"public"."ingestion_job_status";--> statement-breakpoint
UPDATE "metric_definition"
SET "value_type" = 'number'
WHERE "value_type" IS NULL
   OR "value_type" NOT IN ('number', 'text', 'boolean', 'json');--> statement-breakpoint
ALTER TABLE "metric_definition" ALTER COLUMN "value_type" SET DEFAULT 'number'::"public"."metric_definition_value_type";--> statement-breakpoint
ALTER TABLE "metric_definition" ALTER COLUMN "value_type" SET DATA TYPE "public"."metric_definition_value_type" USING "value_type"::"public"."metric_definition_value_type";--> statement-breakpoint
UPDATE "provider_connection"
SET "status" = 'active'
WHERE "status" IS NULL
   OR "status" NOT IN ('active', 'revoked', 'disconnected');--> statement-breakpoint
ALTER TABLE "provider_connection" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."provider_connection_status";--> statement-breakpoint
ALTER TABLE "provider_connection" ALTER COLUMN "status" SET DATA TYPE "public"."provider_connection_status" USING "status"::"public"."provider_connection_status";
