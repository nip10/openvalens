CREATE TABLE "onboarding_state" (
	"organization_id" text NOT NULL,
	"current_step" text NOT NULL,
	"completed_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_state" ADD CONSTRAINT "onboarding_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_state_organization_id_key" ON "onboarding_state" USING btree ("organization_id");