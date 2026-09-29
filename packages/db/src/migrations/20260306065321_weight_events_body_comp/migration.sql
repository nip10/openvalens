CREATE TABLE "weight_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"measured_at" text NOT NULL,
	"date" text NOT NULL,
	"weight_kg" real NOT NULL,
	"confidence" real,
	"metadata_json" jsonb,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_weight" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text,
	"user_id" text NOT NULL,
	"date" text NOT NULL,
	"weight_kg" real NOT NULL,
	"source" text NOT NULL,
	"resolved_from_event_id" integer,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_weight_override" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text,
	"user_id" text NOT NULL,
	"date" text NOT NULL,
	"weight_kg" real NOT NULL,
	"reason" text,
	"created_by_user_id" text,
	"created_at" text NOT NULL,
	"revoked_at" text
);
--> statement-breakpoint
CREATE TABLE "body_comp_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"measured_at" text NOT NULL,
	"date" text NOT NULL,
	"confidence" real,
	"weight_kg" real,
	"body_fat_pct" real,
	"fat_mass_kg" real,
	"lean_mass_kg" real,
	"bone_mass_kg" real,
	"metadata_json" jsonb,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "weight_event" ADD CONSTRAINT "weight_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_event" ADD CONSTRAINT "weight_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_weight" ADD CONSTRAINT "daily_weight_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_weight" ADD CONSTRAINT "daily_weight_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_weight" ADD CONSTRAINT "daily_weight_resolved_from_event_id_weight_event_id_fk" FOREIGN KEY ("resolved_from_event_id") REFERENCES "public"."weight_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_weight_override" ADD CONSTRAINT "daily_weight_override_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_weight_override" ADD CONSTRAINT "daily_weight_override_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_weight_override" ADD CONSTRAINT "daily_weight_override_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_comp_event" ADD CONSTRAINT "body_comp_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_comp_event" ADD CONSTRAINT "body_comp_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_event" ADD CONSTRAINT "weight_event_weight_kg_positive_check" CHECK ("weight_event"."weight_kg" > 0);--> statement-breakpoint
ALTER TABLE "weight_event" ADD CONSTRAINT "weight_event_confidence_range_check" CHECK ("weight_event"."confidence" is null or ("weight_event"."confidence" >= 0 and "weight_event"."confidence" <= 1));--> statement-breakpoint
ALTER TABLE "daily_weight" ADD CONSTRAINT "daily_weight_weight_kg_positive_check" CHECK ("daily_weight"."weight_kg" > 0);--> statement-breakpoint
ALTER TABLE "daily_weight_override" ADD CONSTRAINT "daily_weight_override_weight_kg_positive_check" CHECK ("daily_weight_override"."weight_kg" > 0);--> statement-breakpoint
ALTER TABLE "body_comp_event" ADD CONSTRAINT "body_comp_event_body_fat_pct_range_check" CHECK ("body_comp_event"."body_fat_pct" is null or ("body_comp_event"."body_fat_pct" >= 0 and "body_comp_event"."body_fat_pct" <= 100));--> statement-breakpoint
ALTER TABLE "body_comp_event" ADD CONSTRAINT "body_comp_event_weight_kg_positive_check" CHECK ("body_comp_event"."weight_kg" is null or "body_comp_event"."weight_kg" > 0);--> statement-breakpoint
ALTER TABLE "body_comp_event" ADD CONSTRAINT "body_comp_event_fat_mass_kg_positive_check" CHECK ("body_comp_event"."fat_mass_kg" is null or "body_comp_event"."fat_mass_kg" > 0);--> statement-breakpoint
ALTER TABLE "body_comp_event" ADD CONSTRAINT "body_comp_event_lean_mass_kg_positive_check" CHECK ("body_comp_event"."lean_mass_kg" is null or "body_comp_event"."lean_mass_kg" > 0);--> statement-breakpoint
ALTER TABLE "body_comp_event" ADD CONSTRAINT "body_comp_event_bone_mass_kg_positive_check" CHECK ("body_comp_event"."bone_mass_kg" is null or "body_comp_event"."bone_mass_kg" > 0);--> statement-breakpoint
ALTER TABLE "body_comp_event" ADD CONSTRAINT "body_comp_event_confidence_range_check" CHECK ("body_comp_event"."confidence" is null or ("body_comp_event"."confidence" >= 0 and "body_comp_event"."confidence" <= 1));--> statement-breakpoint
ALTER TABLE "body_comp_event" ADD CONSTRAINT "body_comp_event_metric_presence_check" CHECK ("body_comp_event"."weight_kg" is not null or "body_comp_event"."body_fat_pct" is not null or "body_comp_event"."fat_mass_kg" is not null or "body_comp_event"."lean_mass_kg" is not null or "body_comp_event"."bone_mass_kg" is not null);--> statement-breakpoint
CREATE INDEX "weight_event_organization_id_idx" ON "weight_event" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "weight_event_user_id_date_idx" ON "weight_event" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "weight_event_measured_at_idx" ON "weight_event" USING btree ("measured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_weight_org_user_date_key" ON "daily_weight" USING btree ("organization_id","user_id","date");--> statement-breakpoint
CREATE INDEX "daily_weight_organization_id_idx" ON "daily_weight" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "daily_weight_resolved_from_event_id_idx" ON "daily_weight" USING btree ("resolved_from_event_id");--> statement-breakpoint
CREATE INDEX "daily_weight_override_organization_id_idx" ON "daily_weight_override" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "daily_weight_override_org_user_date_idx" ON "daily_weight_override" USING btree ("organization_id","user_id","date");--> statement-breakpoint
CREATE INDEX "daily_weight_override_created_by_user_id_idx" ON "daily_weight_override" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_weight_override_org_user_date_active_key" ON "daily_weight_override" USING btree ("organization_id","user_id","date") WHERE "daily_weight_override"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "body_comp_event_organization_id_idx" ON "body_comp_event" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "body_comp_event_user_id_date_idx" ON "body_comp_event" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "body_comp_event_measured_at_idx" ON "body_comp_event" USING btree ("measured_at");
