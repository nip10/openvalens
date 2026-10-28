ALTER TABLE "workout" ADD COLUMN "user_id" text;
ALTER TABLE "workout" ADD COLUMN "version" integer NOT NULL DEFAULT 1;
ALTER TABLE "workout" ADD COLUMN "routine_id" integer;
ALTER TABLE "workout" ADD COLUMN "routine_snapshot" jsonb;
ALTER TABLE "workout" ADD CONSTRAINT "workout_org_user_member_fk"
  FOREIGN KEY ("organization_id", "user_id") REFERENCES "member"("organization_id", "user_id") ON DELETE RESTRICT;
CREATE INDEX "workout_org_user_date_id_idx" ON "workout" ("organization_id", "user_id", "date", "id");

ALTER TABLE "workout_mutation" ADD COLUMN "user_id" text;
ALTER TABLE "workout_mutation" ADD COLUMN "version" integer NOT NULL DEFAULT 1;
ALTER TABLE "workout_mutation" ADD CONSTRAINT "workout_mutation_user_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT;

CREATE TABLE "workout_routine" (
  "id" serial PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "name" text NOT NULL,
  "notes" text,
  "created_at" text NOT NULL DEFAULT now()::text,
  "updated_at" text NOT NULL DEFAULT now()::text,
  CONSTRAINT "workout_routine_org_id_key" UNIQUE ("organization_id", "id"),
  CONSTRAINT "workout_routine_org_user_member_fk" FOREIGN KEY ("organization_id", "user_id") REFERENCES "member"("organization_id", "user_id") ON DELETE RESTRICT
);
CREATE INDEX "workout_routine_org_user_idx" ON "workout_routine" ("organization_id", "user_id");
ALTER TABLE "workout_routine" ADD CONSTRAINT "workout_routine_org_user_id_key" UNIQUE ("organization_id", "user_id", "id");
ALTER TABLE "workout" ADD CONSTRAINT "workout_org_user_routine_fk"
  FOREIGN KEY ("organization_id", "user_id", "routine_id")
  REFERENCES "workout_routine" ("organization_id", "user_id", "id") ON DELETE RESTRICT;

CREATE TABLE "workout_routine_exercise" (
  "id" serial PRIMARY KEY,
  "key" uuid NOT NULL,
  "routine_id" integer NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "sort_order" integer NOT NULL,
  "exercise_id" integer REFERENCES "exercise"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "target_sets" integer NOT NULL,
  "reps_min" integer NOT NULL,
  "reps_max" integer NOT NULL,
  "target_weight_kg" real,
  "rest_seconds" integer NOT NULL DEFAULT 90,
  "progression" jsonb NOT NULL DEFAULT '{"kind":"none"}'::jsonb,
  CONSTRAINT "workout_routine_exercise_order_key" UNIQUE ("routine_id", "sort_order"),
  CONSTRAINT "workout_routine_exercise_org_parent_fk" FOREIGN KEY ("organization_id", "routine_id") REFERENCES "workout_routine"("organization_id", "id") ON DELETE CASCADE
);

CREATE TABLE "workout_operation" (
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "client_mutation_id" uuid NOT NULL,
  "operation" text NOT NULL,
  "target_id" integer,
  "fingerprint" text NOT NULL CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
  "result" jsonb NOT NULL,
  CONSTRAINT "workout_operation_org_user_client_key" UNIQUE ("organization_id", "user_id", "client_mutation_id"),
  CONSTRAINT "workout_operation_org_user_member_fk" FOREIGN KEY ("organization_id", "user_id") REFERENCES "member"("organization_id", "user_id") ON DELETE RESTRICT
);
