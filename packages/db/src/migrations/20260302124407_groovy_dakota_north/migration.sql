CREATE TABLE "coach_profile" (
	"id" serial PRIMARY KEY NOT NULL,
	"tone" text NOT NULL,
	"assertiveness" integer NOT NULL,
	"risk_tolerance" text NOT NULL,
	"medical_disclaimer_mode" text NOT NULL,
	"selected_template_key" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_template" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"instruction_preset" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "coach_template_key_unique" UNIQUE("key")
);
