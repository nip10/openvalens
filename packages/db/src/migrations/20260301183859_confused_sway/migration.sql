CREATE TABLE "ai_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"reference_id" integer,
	"rating" text NOT NULL,
	"comment" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blood_marker" (
	"id" serial PRIMARY KEY NOT NULL,
	"panel_id" integer NOT NULL,
	"category" text NOT NULL,
	"subcategory" text,
	"test_name" text NOT NULL,
	"test_key" text NOT NULL,
	"value_numeric" real,
	"value_text" text,
	"unit" text,
	"ref_range_low" real,
	"ref_range_high" real,
	"ref_range_text" text,
	"flag" text
);
--> statement-breakpoint
CREATE TABLE "blood_marker_info" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_key" text NOT NULL,
	"display_name" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"why_it_matters" text,
	"higher_means" text,
	"lower_means" text,
	"related_markers" text,
	CONSTRAINT "blood_marker_info_test_key_unique" UNIQUE("test_key")
);
--> statement-breakpoint
CREATE TABLE "blood_panel" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"context" text,
	"facility" text,
	"physician" text,
	"source_file" text,
	"pdf_path" text,
	"notes" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"type" text NOT NULL,
	"category" text,
	"title" text NOT NULL,
	"reference_table" text,
	"reference_id" integer
);
--> statement-breakpoint
CREATE TABLE "cardiac_exam" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"type" text NOT NULL,
	"facility" text,
	"physician" text,
	"reason" text,
	"report" text,
	"conclusion" text,
	"source_file" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cardiac_measurement" (
	"id" serial PRIMARY KEY NOT NULL,
	"exam_id" integer NOT NULL,
	"name" text NOT NULL,
	"value" real,
	"value_text" text,
	"unit" text
);
--> statement-breakpoint
CREATE TABLE "chat_message" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consultation" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"type" text NOT NULL,
	"facility" text,
	"physician" text,
	"diagnosis" text,
	"report" text,
	"source_file" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dexa_regional" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_id" integer NOT NULL,
	"measurement_type" text NOT NULL,
	"region" text NOT NULL,
	"value" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dexa_scan" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"height" real,
	"weight" real,
	"age" real,
	"total_mass" real,
	"fat_mass" real,
	"lean_mass" real,
	"bone_mineral_content" real,
	"body_fat_pct" real,
	"lean_tissue_pct" real,
	"bmi" real,
	"android_fat_pct" real,
	"gynoid_fat_pct" real,
	"ag_ratio" real,
	"rmr" real,
	"rsmi" real,
	"bmd_total" real,
	"t_score" real,
	"z_score" real,
	"bmd_percentile" integer,
	"source_file" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "family_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"relation" text NOT NULL,
	"condition" text NOT NULL,
	"age_of_onset" integer,
	"notes" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"horizon" text,
	"status" text DEFAULT 'not_started' NOT NULL,
	"current_value" text,
	"target_value" text,
	"target_date" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "goal_checkin" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_id" integer NOT NULL,
	"date" text NOT NULL,
	"value" text,
	"notes" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imaging_study" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"type" text NOT NULL,
	"body_part" text NOT NULL,
	"facility" text,
	"physician" text,
	"technique" text,
	"findings" text,
	"conclusion" text,
	"source_file" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_path" text,
	"source_type" text,
	"status" text NOT NULL,
	"extracted_data" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insight" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"severity" text,
	"title" text NOT NULL,
	"body" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medication" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"dose" text,
	"route" text,
	"protocol" text,
	"frequency" text,
	"status" text DEFAULT 'active' NOT NULL,
	"interactions" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "optimal_range" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_key" text NOT NULL,
	"source" text NOT NULL,
	"range_low" real,
	"range_high" real,
	"classification" text NOT NULL,
	"explanation" text
);
--> statement-breakpoint
CREATE TABLE "scheduled_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"frequency" text NOT NULL,
	"interval" integer DEFAULT 1,
	"notes" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplement" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"dose" text,
	"form" text,
	"category" text
);
--> statement-breakpoint
CREATE TABLE "supplement_change" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"supplement_id" integer,
	"change_type" text NOT NULL,
	"reason" text,
	"details" text
);
--> statement-breakpoint
CREATE TABLE "supplement_schedule" (
	"id" serial PRIMARY KEY NOT NULL,
	"supplement_id" integer NOT NULL,
	"time_of_day" text NOT NULL,
	"quantity" text,
	"frequency" text,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_review" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_start" text NOT NULL,
	"adherence" integer,
	"energy" integer,
	"sleep" integer,
	"notes" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weight_checkin" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"weight_kg" real NOT NULL,
	"body_fat_pct" real,
	"notes" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"type" text NOT NULL,
	"duration" integer,
	"exercises" text,
	"notes" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blood_marker" ADD CONSTRAINT "blood_marker_panel_id_blood_panel_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."blood_panel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cardiac_measurement" ADD CONSTRAINT "cardiac_measurement_exam_id_cardiac_exam_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."cardiac_exam"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dexa_regional" ADD CONSTRAINT "dexa_regional_scan_id_dexa_scan_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."dexa_scan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_checkin" ADD CONSTRAINT "goal_checkin_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplement_change" ADD CONSTRAINT "supplement_change_supplement_id_supplement_id_fk" FOREIGN KEY ("supplement_id") REFERENCES "public"."supplement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplement_schedule" ADD CONSTRAINT "supplement_schedule_supplement_id_supplement_id_fk" FOREIGN KEY ("supplement_id") REFERENCES "public"."supplement"("id") ON DELETE no action ON UPDATE no action;