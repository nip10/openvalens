CREATE TABLE "exercise_catalog_mutation" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"client_mutation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"fingerprint" text NOT NULL,
	"target_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_catalog_mutation_kind_check" CHECK ("exercise_catalog_mutation"."kind" in ('create_custom', 'add_from_library')),
	CONSTRAINT "exercise_catalog_mutation_fingerprint_check" CHECK ("exercise_catalog_mutation"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "exercise_catalog_mutation" ADD CONSTRAINT "exercise_catalog_mutation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "exercise_catalog_mutation" ADD CONSTRAINT "exercise_catalog_mutation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_catalog_mutation_org_user_client_key" ON "exercise_catalog_mutation" USING btree ("organization_id","user_id","client_mutation_id");
