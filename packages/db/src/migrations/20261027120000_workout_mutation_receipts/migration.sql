CREATE TABLE "workout_mutation" (
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "client_mutation_id" uuid NOT NULL,
  "fingerprint" text NOT NULL CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
  "workout_id" integer NOT NULL,
  "exercise_count" integer NOT NULL,
  "set_count" integer NOT NULL,
  CONSTRAINT "workout_mutation_org_client_key" UNIQUE ("organization_id", "client_mutation_id")
);
