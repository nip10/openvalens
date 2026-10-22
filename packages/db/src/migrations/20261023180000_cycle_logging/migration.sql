-- Issue #91: optional, member-private cycle logging under its own consent.
-- Additive only. Imports are grouped so one run can be undone as a whole.
CREATE TABLE "cycle_preference" (
  "user_id" text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "enabled" boolean NOT NULL DEFAULT false,
  "consent_version" text,
  "consented_at" timestamptz,
  "no_natural_cycle" boolean NOT NULL DEFAULT false,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "cycle_import" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "source" text NOT NULL,
  "period_count" integer NOT NULL,
  "imported_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "cycle_import_org_user_member_fk"
    FOREIGN KEY ("organization_id", "user_id")
    REFERENCES "member" ("organization_id", "user_id") ON DELETE CASCADE,
  CONSTRAINT "cycle_import_source_check" CHECK ("source" IN ('health_connect', 'healthkit'))
);

CREATE TABLE "cycle_period" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "start_date" text NOT NULL,
  "end_date" text,
  "flow" text,
  "notes" text,
  "source" text NOT NULL DEFAULT 'manual',
  "source_record_id" text,
  "import_id" uuid REFERENCES "cycle_import"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "cycle_period_org_user_member_fk"
    FOREIGN KEY ("organization_id", "user_id")
    REFERENCES "member" ("organization_id", "user_id") ON DELETE CASCADE,
  CONSTRAINT "cycle_period_dates_check" CHECK (
    "start_date" ~ '^\d{4}-\d{2}-\d{2}$'
    AND ("end_date" IS NULL OR ("end_date" ~ '^\d{4}-\d{2}-\d{2}$' AND "end_date" >= "start_date"))
  ),
  CONSTRAINT "cycle_period_flow_check"
    CHECK ("flow" IS NULL OR "flow" IN ('spotting', 'light', 'medium', 'heavy')),
  CONSTRAINT "cycle_period_notes_check" CHECK ("notes" IS NULL OR length("notes") <= 500),
  CONSTRAINT "cycle_period_source_check" CHECK (
    ("source" = 'manual' AND "import_id" IS NULL AND "source_record_id" IS NULL)
    OR ("source" IN ('health_connect', 'healthkit') AND "import_id" IS NOT NULL AND "source_record_id" IS NOT NULL)
  )
);
CREATE INDEX "cycle_period_org_user_start_idx"
  ON "cycle_period" ("organization_id", "user_id", "start_date");
CREATE UNIQUE INDEX "cycle_period_source_record_key"
  ON "cycle_period" ("organization_id", "user_id", "source", "source_record_id")
  WHERE "source_record_id" IS NOT NULL;
