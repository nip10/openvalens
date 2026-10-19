-- Optional, member-private plain-water logging. No default goal or prescription.
CREATE TABLE "plain_water_entry" (
  "id" serial PRIMARY KEY,
  "organization_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "quantity_ml" real NOT NULL,
  "observed_at" timestamp with time zone NOT NULL,
  "time_zone" text NOT NULL,
  "client_mutation_id" text NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plain_water_entry_quantity_check" CHECK ("quantity_ml" > 0 AND "quantity_ml" < 'Infinity'::float8),
  CONSTRAINT "plain_water_entry_mutation_check" CHECK (length("client_mutation_id") BETWEEN 1 AND 64),
  CONSTRAINT "plain_water_entry_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "plain_water_entry_org_user_member_fk" FOREIGN KEY ("organization_id", "user_id") REFERENCES "member"("organization_id", "user_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "plain_water_entry_org_id_key" ON "plain_water_entry" ("organization_id", "id");
CREATE UNIQUE INDEX "plain_water_entry_org_user_mutation_key" ON "plain_water_entry" ("organization_id", "user_id", "client_mutation_id");
CREATE INDEX "plain_water_entry_org_user_observed_idx" ON "plain_water_entry" ("organization_id", "user_id", "observed_at");

CREATE TABLE "plain_water_preference" (
  "id" serial PRIMARY KEY,
  "organization_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "enabled" boolean DEFAULT false NOT NULL,
  "personal_goal_ml" real,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plain_water_preference_goal_check" CHECK ("personal_goal_ml" IS NULL OR ("personal_goal_ml" > 0 AND "personal_goal_ml" < 'Infinity'::float8)),
  CONSTRAINT "plain_water_preference_org_user_member_fk" FOREIGN KEY ("organization_id", "user_id") REFERENCES "member"("organization_id", "user_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "plain_water_preference_org_user_key" ON "plain_water_preference" ("organization_id", "user_id");

CREATE TABLE "plain_water_mutation" (
  "id" serial PRIMARY KEY,
  "organization_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "client_mutation_id" text NOT NULL,
  "kind" text NOT NULL,
  "fingerprint" text NOT NULL,
  "entry_id" integer NOT NULL,
  "outcome" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plain_water_mutation_kind_check" CHECK ("kind" IN ('add', 'edit', 'delete')),
  CONSTRAINT "plain_water_mutation_fingerprint_check" CHECK (length("fingerprint") = 64),
  CONSTRAINT "plain_water_mutation_client_id_check" CHECK (length("client_mutation_id") BETWEEN 1 AND 64),
  CONSTRAINT "plain_water_mutation_org_entry_fk" FOREIGN KEY ("organization_id", "entry_id") REFERENCES "plain_water_entry"("organization_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "plain_water_mutation_org_user_member_fk" FOREIGN KEY ("organization_id", "user_id") REFERENCES "member"("organization_id", "user_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "plain_water_mutation_org_user_client_key" ON "plain_water_mutation" ("organization_id", "user_id", "client_mutation_id");
CREATE INDEX "plain_water_mutation_org_entry_idx" ON "plain_water_mutation" ("organization_id", "entry_id");
