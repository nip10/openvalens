CREATE TABLE "workout_exercise" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text,
	"workout_id" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "workout_set" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text,
	"exercise_id" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"reps" integer,
	"weight_kg" real,
	"rpe" real,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "workout_exercise" ADD CONSTRAINT "workout_exercise_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_exercise" ADD CONSTRAINT "workout_exercise_workout_id_workout_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workout"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_set" ADD CONSTRAINT "workout_set_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_set" ADD CONSTRAINT "workout_set_exercise_id_workout_exercise_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."workout_exercise"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workout_exercise_organization_id_idx" ON "workout_exercise" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workout_exercise_workout_id_idx" ON "workout_exercise" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX "workout_exercise_workout_id_sort_order_idx" ON "workout_exercise" USING btree ("workout_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_exercise_workout_id_sort_order_key" ON "workout_exercise" USING btree ("workout_id","sort_order");--> statement-breakpoint
CREATE INDEX "workout_set_organization_id_idx" ON "workout_set" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workout_set_exercise_id_idx" ON "workout_set" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "workout_set_exercise_id_sort_order_idx" ON "workout_set" USING btree ("exercise_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_set_exercise_id_sort_order_key" ON "workout_set" USING btree ("exercise_id","sort_order");
