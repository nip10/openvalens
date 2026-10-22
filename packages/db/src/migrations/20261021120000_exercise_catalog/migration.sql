CREATE TABLE "exercise" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text,
	"source" text NOT NULL,
	"external_id" text,
	"name" text NOT NULL,
	"category" text,
	"license_code" text,
	"license_url" text,
	"author" text,
	"raw_attribution" text,
	"source_license_metadata" text,
	"source_record_url" text,
	"snapshot_version" text,
	"snapshot_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_source_ownership_check" CHECK (("exercise"."source" = 'wger' and "exercise"."organization_id" is null and "exercise"."external_id" is not null) or ("exercise"."source" = 'user' and "exercise"."organization_id" is not null)),
	CONSTRAINT "exercise_text_check" CHECK (length("exercise"."name") > 0 and ("exercise"."external_id" is null or length("exercise"."external_id") > 0)),
	CONSTRAINT "exercise_wger_provenance_check" CHECK ("exercise"."source" <> 'wger' or ("exercise"."source_record_url" is not null and length("exercise"."source_record_url") > 0 and "exercise"."snapshot_version" is not null and length("exercise"."snapshot_version") > 0 and "exercise"."snapshot_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "exercise" ADD CONSTRAINT "exercise_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "exercise_organization_id_idx" ON "exercise" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "exercise_name_idx" ON "exercise" USING btree ("name");
--> statement-breakpoint
CREATE INDEX "exercise_source_idx" ON "exercise" USING btree ("source");
--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_source_external_id_key" ON "exercise" USING btree ("source","external_id") WHERE "exercise"."external_id" is not null;
--> statement-breakpoint
CREATE TABLE "exercise_translation" (
	"id" serial PRIMARY KEY NOT NULL,
	"exercise_id" integer NOT NULL,
	"language_code" text NOT NULL,
	"name" text NOT NULL,
	"instructions" text,
	"license_code" text,
	"license_url" text,
	"author" text,
	"source_url" text,
	"raw_attribution" text,
	CONSTRAINT "exercise_translation_text_check" CHECK (length("exercise_translation"."language_code") > 0 and length("exercise_translation"."name") > 0)
);
--> statement-breakpoint
ALTER TABLE "exercise_translation" ADD CONSTRAINT "exercise_translation_exercise_id_exercise_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_translation_exercise_language_key" ON "exercise_translation" USING btree ("exercise_id","language_code");
--> statement-breakpoint
CREATE INDEX "exercise_translation_exercise_id_idx" ON "exercise_translation" USING btree ("exercise_id");
--> statement-breakpoint
CREATE TABLE "exercise_muscle" (
	"id" serial PRIMARY KEY NOT NULL,
	"exercise_id" integer NOT NULL,
	"external_muscle_id" text,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"location" text,
	CONSTRAINT "exercise_muscle_role_check" CHECK ("exercise_muscle"."role" in ('primary', 'secondary') and ("exercise_muscle"."location" is null or "exercise_muscle"."location" in ('front', 'back')))
);
--> statement-breakpoint
ALTER TABLE "exercise_muscle" ADD CONSTRAINT "exercise_muscle_exercise_id_exercise_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_muscle_exercise_muscle_role_key" ON "exercise_muscle" USING btree ("exercise_id","external_muscle_id","name","role");
--> statement-breakpoint
CREATE INDEX "exercise_muscle_exercise_id_idx" ON "exercise_muscle" USING btree ("exercise_id");
--> statement-breakpoint
CREATE TABLE "exercise_equipment" (
	"id" serial PRIMARY KEY NOT NULL,
	"exercise_id" integer NOT NULL,
	"external_equipment_id" text,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercise_equipment" ADD CONSTRAINT "exercise_equipment_exercise_id_exercise_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_equipment_exercise_equipment_key" ON "exercise_equipment" USING btree ("exercise_id","external_equipment_id","name");
--> statement-breakpoint
CREATE INDEX "exercise_equipment_exercise_id_idx" ON "exercise_equipment" USING btree ("exercise_id");
--> statement-breakpoint
CREATE TABLE "exercise_media" (
	"id" serial PRIMARY KEY NOT NULL,
	"exercise_id" integer NOT NULL,
	"source_external_media_id" text NOT NULL,
	"kind" text NOT NULL,
	"license_code" text,
	"license_url" text,
	"author" text,
	"raw_attribution" text,
	"source_media_url" text,
	"snapshot_version" text,
	"snapshot_at" timestamp with time zone,
	"stored_object_id" text,
	CONSTRAINT "exercise_media_kind_check" CHECK ("exercise_media"."kind" in ('image', 'video') and length("exercise_media"."source_external_media_id") > 0)
);
--> statement-breakpoint
ALTER TABLE "exercise_media" ADD CONSTRAINT "exercise_media_exercise_id_exercise_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "exercise_media" ADD CONSTRAINT "exercise_media_stored_object_id_stored_object_id_fk" FOREIGN KEY ("stored_object_id") REFERENCES "public"."stored_object"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_media_exercise_source_id_key" ON "exercise_media" USING btree ("exercise_id","source_external_media_id");
--> statement-breakpoint
CREATE INDEX "exercise_media_exercise_id_idx" ON "exercise_media" USING btree ("exercise_id");
--> statement-breakpoint
ALTER TABLE "workout_exercise" ADD COLUMN "exercise_id" integer;
--> statement-breakpoint
ALTER TABLE "workout_exercise" ADD CONSTRAINT "workout_exercise_exercise_id_exercise_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workout_exercise_exercise_id_idx" ON "workout_exercise" USING btree ("exercise_id");
--> statement-breakpoint
CREATE TABLE "exercise_catalog_asset" (
	"id" uuid PRIMARY KEY NOT NULL,
	"exercise_media_id" integer NOT NULL,
	"storage_provider" text NOT NULL,
	"storage_store_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"original_file_sha256" text NOT NULL,
	"source_exercise_id" integer NOT NULL,
	"source_external_exercise_id" text NOT NULL,
	"source_external_media_id" text NOT NULL,
	"snapshot_version" text NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	"license_code" text NOT NULL,
	"license_url" text NOT NULL,
	"author" text,
	"attribution" text,
	"source_url" text NOT NULL,
	"transformation_notice" text NOT NULL,
	"binding_fingerprint" text NOT NULL,
	"state" text NOT NULL,
	"write_state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_catalog_asset_identity_check" CHECK ("exercise_catalog_asset"."storage_provider" in ('local', 's3') and length("exercise_catalog_asset"."storage_store_id") > 0 and "exercise_catalog_asset"."storage_key" = 'catalog/exercise/' || "exercise_catalog_asset"."id"::text),
	CONSTRAINT "exercise_catalog_asset_state_check" CHECK ("exercise_catalog_asset"."state" in ('pending', 'ready', 'withdrawn') and "exercise_catalog_asset"."write_state" in ('not_started', 'uncertain', 'settled') and ("exercise_catalog_asset"."state" <> 'ready' or "exercise_catalog_asset"."write_state" = 'settled')),
	CONSTRAINT "exercise_catalog_asset_content_check" CHECK ("exercise_catalog_asset"."content_type" in ('image/jpeg', 'image/png') and "exercise_catalog_asset"."size_bytes" > 0 and "exercise_catalog_asset"."width" > 0 and "exercise_catalog_asset"."height" > 0 and "exercise_catalog_asset"."sha256" ~ '^[0-9a-f]{64}$' and "exercise_catalog_asset"."original_file_sha256" ~ '^[0-9a-f]{64}$' and "exercise_catalog_asset"."binding_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "exercise_catalog_asset" ADD CONSTRAINT "exercise_catalog_asset_exercise_media_id_exercise_media_id_fk" FOREIGN KEY ("exercise_media_id") REFERENCES "public"."exercise_media"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_catalog_asset_storage_key_key" ON "exercise_catalog_asset" USING btree ("storage_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_catalog_asset_media_fingerprint_key" ON "exercise_catalog_asset" USING btree ("exercise_media_id","binding_fingerprint");
--> statement-breakpoint
CREATE INDEX "exercise_catalog_asset_media_id_idx" ON "exercise_catalog_asset" USING btree ("exercise_media_id");
