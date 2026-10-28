ALTER TABLE "nutrition_meal_entry" ADD COLUMN "time_zone" text;--> statement-breakpoint
CREATE TABLE "nutrition_template" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"current_revision" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_template_kind_check" CHECK ("kind" in ('meal', 'recipe')),
	CONSTRAINT "nutrition_template_revision_check" CHECK ("current_revision" > 0)
);--> statement-breakpoint
ALTER TABLE "nutrition_template" ADD CONSTRAINT "nutrition_template_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_template_org_id_key" ON "nutrition_template" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "nutrition_template_org_user_idx" ON "nutrition_template" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE TABLE "nutrition_template_revision" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"template_id" integer NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"yield_servings" real,
	"ingredients" jsonb NOT NULL,
	"client_mutation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_template_revision_positive_check" CHECK ("revision" > 0)
);--> statement-breakpoint
ALTER TABLE "nutrition_template_revision" ADD CONSTRAINT "nutrition_template_revision_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "nutrition_template_revision" ADD CONSTRAINT "nutrition_template_revision_template_fk" FOREIGN KEY ("organization_id","template_id") REFERENCES "nutrition_template"("organization_id","id") ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_template_revision_key" ON "nutrition_template_revision" USING btree ("organization_id","template_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_template_revision_mutation_key" ON "nutrition_template_revision" USING btree ("organization_id","user_id","client_mutation_id");--> statement-breakpoint
CREATE TABLE "nutrition_diary_batch" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"client_mutation_id" text NOT NULL,
	"operation" text NOT NULL,
	"fingerprint" text NOT NULL,
	"entry_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "nutrition_diary_batch" ADD CONSTRAINT "nutrition_diary_batch_org_user_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "member"("organization_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_diary_batch_mutation_key" ON "nutrition_diary_batch" USING btree ("organization_id","user_id","client_mutation_id");
