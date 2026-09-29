CREATE TABLE "metric_source_preference" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"metric_code" text NOT NULL,
	"preferred_sources" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "metric_source_preference" ADD CONSTRAINT "metric_source_preference_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_source_preference" ADD CONSTRAINT "metric_source_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_source_preference" ADD CONSTRAINT "metric_source_preference_org_metric_code_fk" FOREIGN KEY ("organization_id","metric_code") REFERENCES "public"."metric_definition"("organization_id","code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "metric_source_preference_organization_id_idx" ON "metric_source_preference" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "metric_source_preference_user_id_idx" ON "metric_source_preference" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_source_preference_org_metric_code_key" ON "metric_source_preference" USING btree ("organization_id","metric_code") WHERE "user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "metric_source_preference_org_user_metric_code_key" ON "metric_source_preference" USING btree ("organization_id","user_id","metric_code") WHERE "user_id" is not null;
