ALTER TABLE "goal"
  ADD COLUMN "user_id" text,
  ADD COLUMN "version" integer NOT NULL DEFAULT 1,
  ADD COLUMN "source" text,
  ADD COLUMN "ever_had_evidence" boolean NOT NULL DEFAULT false,
  ADD COLUMN "definition" jsonb,
  ADD COLUMN "timezone" text,
  ADD COLUMN "start_date" text,
  ADD COLUMN "cutoff_time" text,
  ADD COLUMN "deleted_at" text;
--> statement-breakpoint
ALTER TABLE "goal"
  ADD CONSTRAINT "goal_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "goal_org_user_member_fk" FOREIGN KEY ("organization_id", "user_id") REFERENCES "member"("organization_id", "user_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "goal_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "goal_source_check" CHECK ("source" IS NULL OR "source" IN ('manual', 'water', 'supplement', 'workout', 'sleep'));
--> statement-breakpoint
CREATE UNIQUE INDEX "goal_org_user_id_key" ON "goal" ("organization_id", "user_id", "id");
--> statement-breakpoint
CREATE INDEX "goal_org_user_status_idx" ON "goal" ("organization_id", "user_id", "status");
--> statement-breakpoint
ALTER TABLE "goal_checkin"
  ADD COLUMN "user_id" text,
  ADD COLUMN "version" integer NOT NULL DEFAULT 1,
  ADD COLUMN "corrected_from_id" integer,
  ADD COLUMN "deleted_at" text;
--> statement-breakpoint
ALTER TABLE "goal_checkin"
  ADD CONSTRAINT "goal_checkin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "goal_checkin_org_user_goal_fk" FOREIGN KEY ("organization_id", "user_id", "goal_id") REFERENCES "goal"("organization_id", "user_id", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "goal_checkin_org_user_member_fk" FOREIGN KEY ("organization_id", "user_id") REFERENCES "member"("organization_id", "user_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "goal_checkin_org_user_id_key" UNIQUE ("organization_id", "user_id", "id"),
  ADD CONSTRAINT "goal_checkin_version_check" CHECK ("version" > 0);
--> statement-breakpoint
ALTER TABLE "goal_checkin"
  ADD CONSTRAINT "goal_checkin_correction_owner_fk" FOREIGN KEY ("organization_id", "user_id", "corrected_from_id") REFERENCES "goal_checkin"("organization_id", "user_id", "id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE TABLE "goal_definition" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "goal_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "revision" integer NOT NULL CHECK ("revision" > 0),
  "definition" jsonb NOT NULL,
  "effective_from" text NOT NULL,
  "effective_until" text,
  "created_at" text NOT NULL DEFAULT now()::text,
  CONSTRAINT "goal_definition_org_user_goal_fk" FOREIGN KEY ("organization_id", "user_id", "goal_id") REFERENCES "goal"("organization_id", "user_id", "id") ON DELETE CASCADE,
  CONSTRAINT "goal_definition_goal_revision_key" UNIQUE ("goal_id", "revision")
);
--> statement-breakpoint
CREATE INDEX "goal_definition_goal_effective_idx" ON "goal_definition" ("organization_id", "user_id", "goal_id", "effective_from");
--> statement-breakpoint
CREATE TABLE "goal_milestone" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "goal_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "value" text NOT NULL,
  "target_date" text NOT NULL,
  "achieved_at" text,
  "created_at" text NOT NULL DEFAULT now()::text,
  CONSTRAINT "goal_milestone_org_user_goal_fk" FOREIGN KEY ("organization_id", "user_id", "goal_id") REFERENCES "goal"("organization_id", "user_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "goal_milestone_org_user_date_idx" ON "goal_milestone" ("organization_id", "user_id", "target_date");
--> statement-breakpoint
CREATE TABLE "goal_lifecycle" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "goal_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "event" text NOT NULL CHECK ("event" IN ('created', 'paused', 'resumed', 'completed', 'cancelled', 'deleted', 'reopened')),
  "occurred_at" text NOT NULL,
  "effective_date" text,
  "details" jsonb,
  CONSTRAINT "goal_lifecycle_org_user_goal_fk" FOREIGN KEY ("organization_id", "user_id", "goal_id") REFERENCES "goal"("organization_id", "user_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "goal_lifecycle_history_idx" ON "goal_lifecycle" ("organization_id", "user_id", "goal_id", "occurred_at");
--> statement-breakpoint
CREATE TABLE "goal_mutation" (
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "client_mutation_id" uuid NOT NULL,
  "operation" text NOT NULL,
  "target_id" integer,
  "fingerprint" text NOT NULL CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
  "result" jsonb NOT NULL,
  "created_at" text NOT NULL DEFAULT now()::text,
  CONSTRAINT "goal_mutation_org_user_member_fk" FOREIGN KEY ("organization_id", "user_id") REFERENCES "member"("organization_id", "user_id") ON DELETE RESTRICT,
  CONSTRAINT "goal_mutation_org_user_client_key" UNIQUE ("organization_id", "user_id", "client_mutation_id")
);
--> statement-breakpoint
CREATE TABLE "goal_ownership_assignment" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "goal_id" integer NOT NULL,
  "assigned_user_id" text NOT NULL,
  "assigned_by_user_id" text NOT NULL,
  "reason" text NOT NULL,
  "assigned_at" text NOT NULL DEFAULT now()::text,
  CONSTRAINT "goal_ownership_assignment_org_goal_fk" FOREIGN KEY ("organization_id", "goal_id") REFERENCES "goal"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "goal_ownership_assignment_assignee_member_fk" FOREIGN KEY ("organization_id", "assigned_user_id") REFERENCES "member"("organization_id", "user_id") ON DELETE RESTRICT,
  CONSTRAINT "goal_ownership_assignment_assigner_member_fk" FOREIGN KEY ("organization_id", "assigned_by_user_id") REFERENCES "member"("organization_id", "user_id") ON DELETE RESTRICT,
  CONSTRAINT "goal_ownership_assignment_goal_key" UNIQUE ("goal_id")
);
--> statement-breakpoint
CREATE TABLE "supplement_intake" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "supplement_id" integer NOT NULL REFERENCES "supplement"("id") ON DELETE RESTRICT,
  "occurred_at" timestamptz NOT NULL,
  "timezone" text NOT NULL,
  "dose" text NOT NULL,
  "note" text,
  "version" integer NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "corrected_from_id" integer,
  "deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "supplement_intake_org_user_member_fk" FOREIGN KEY ("organization_id", "user_id") REFERENCES "member"("organization_id", "user_id") ON DELETE RESTRICT,
  CONSTRAINT "supplement_intake_org_user_id_key" UNIQUE ("organization_id", "user_id", "id"),
  CONSTRAINT "supplement_intake_correction_owner_fk" FOREIGN KEY ("organization_id", "user_id", "corrected_from_id") REFERENCES "supplement_intake"("organization_id", "user_id", "id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX "supplement_intake_owner_time_idx" ON "supplement_intake" ("organization_id", "user_id", "occurred_at");
--> statement-breakpoint
CREATE TABLE "goal_water_link" (
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "goal_id" integer NOT NULL,
  "linked_at" text NOT NULL DEFAULT now()::text,
  "ended_at" text,
  CONSTRAINT "goal_water_link_org_user_goal_fk" FOREIGN KEY ("organization_id", "user_id", "goal_id") REFERENCES "goal"("organization_id", "user_id", "id") ON DELETE CASCADE,
  CONSTRAINT "goal_water_link_goal_key" UNIQUE ("goal_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "goal_water_link_active_owner_key" ON "goal_water_link" ("organization_id", "user_id") WHERE "ended_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "goal_water_cutover" (
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "cutover_at" text NOT NULL DEFAULT now()::text,
  CONSTRAINT "goal_water_cutover_owner_key" UNIQUE ("organization_id", "user_id"),
  CONSTRAINT "goal_water_cutover_org_user_member_fk" FOREIGN KEY ("organization_id", "user_id") REFERENCES "member"("organization_id", "user_id") ON DELETE RESTRICT
);
