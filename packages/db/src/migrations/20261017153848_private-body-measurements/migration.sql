-- Issue #85: additive, member-private manual measurements and opt-in.
CREATE TABLE "private_body_measurement" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "value" real NOT NULL,
  "unit" text NOT NULL,
  "measured_at" timestamptz NOT NULL,
  "source" text NOT NULL DEFAULT 'manual',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "private_body_measurement_org_user_member_fk"
    FOREIGN KEY ("organization_id", "user_id")
    REFERENCES "member" ("organization_id", "user_id") ON DELETE CASCADE,
  CONSTRAINT "private_body_measurement_value_technical_range_check"
    CHECK ("value" > 0 AND "value" <= 1000),
  CONSTRAINT "private_body_measurement_kind_check"
    CHECK ("kind" IN ('weight', 'waist', 'hip', 'neck', 'chest', 'upper_arm', 'thigh')),
  CONSTRAINT "private_body_measurement_unit_check"
    CHECK (("kind" = 'weight' AND "unit" IN ('kg', 'lb'))
      OR ("kind" <> 'weight' AND "unit" IN ('cm', 'in'))),
  CONSTRAINT "private_body_measurement_source_check" CHECK ("source" = 'manual')
);
CREATE INDEX "private_body_measurement_org_user_measured_idx"
  ON "private_body_measurement" ("organization_id", "user_id", "measured_at" DESC);

CREATE TABLE "private_body_measurement_preference" (
  "user_id" text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "enabled" boolean NOT NULL DEFAULT false,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
