-- Issue #509: sleep and weight are private per member, like workouts. A member
-- reads their own rows plus legacy rows with no author.
--
-- `health_event.user_id`, `daily_weight`, `weight_event`, `daily_weight_override`
-- and `body_comp_event` already carry an author. Two tables that hold weigh-ins
-- did not: `metric_sample` (typed-in, AI-app and device weight and body
-- composition readings) and `weight_checkin` (the manual weight form). Both get
-- a nullable `user_id`. Additive only.
--
-- Backfill only where the author is unambiguous; every other row stays NULL and
-- is shared with the workspace as before, as legacy workouts are:
-- * a check-in written by the weight form, through the `weight_event` it wrote
--   in the same transaction (`metadata_json.weightCheckinId`);
-- * a typed-in or AI-app reading (no data source), through the
--   `ingestedByUserId` the server stamped on it;
-- * a phone weight, through the `weight_event` the body bridge wrote for the
--   device owner (`metadata_json.metricSampleId`);
-- * a sleep night saved by `sleep.recordFromHealthConnect`, through its single
--   RECORD_CREATED audit row.
-- No owner is inferred from the workspace, its owner or a device connection's
-- current member: a connection can move between members.
ALTER TABLE "metric_sample" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "metric_sample" ADD CONSTRAINT "metric_sample_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "metric_sample" ADD CONSTRAINT "metric_sample_org_user_member_fk"
    FOREIGN KEY ("organization_id", "user_id") REFERENCES "public"."member"("organization_id", "user_id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metric_sample_org_user_sampled_at_idx"
  ON "metric_sample" USING btree ("organization_id", "user_id", "sampled_at");
--> statement-breakpoint
ALTER TABLE "weight_checkin" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "weight_checkin" ADD CONSTRAINT "weight_checkin_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "weight_checkin" ADD CONSTRAINT "weight_checkin_org_user_member_fk"
    FOREIGN KEY ("organization_id", "user_id") REFERENCES "public"."member"("organization_id", "user_id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "weight_checkin_org_user_date_idx"
  ON "weight_checkin" USING btree ("organization_id", "user_id", "date");
--> statement-breakpoint
UPDATE "weight_checkin" c SET "user_id" = owner.user_id
FROM (
  SELECT e.organization_id, (e.metadata_json ->> 'weightCheckinId') AS checkin_id,
    min(e.user_id) AS user_id
  FROM "weight_event" e
  WHERE e.metadata_json ->> 'from' = 'api.weight.manual'
    AND (e.metadata_json ->> 'weightCheckinId') ~ '^[0-9]+$'
  GROUP BY 1, 2
  HAVING count(DISTINCT e.user_id) = 1
) owner
WHERE c.user_id IS NULL
  AND c.organization_id = owner.organization_id
  AND c.id::text = owner.checkin_id
  AND EXISTS (SELECT 1 FROM "member" m
    WHERE m.organization_id = c.organization_id AND m.user_id = owner.user_id);
--> statement-breakpoint
UPDATE "metric_sample" s SET "user_id" = s.metadata_json ->> 'ingestedByUserId'
FROM "metric_definition" d
WHERE s.user_id IS NULL
  AND s.data_source_id IS NULL
  AND d.id = s.metric_definition_id
  AND d.organization_id = s.organization_id
  AND d.code IN ('weight', 'body_fat', 'muscle_mass', 'bone_mass', 'body_water', 'sleep_duration')
  AND EXISTS (SELECT 1 FROM "member" m
    WHERE m.organization_id = s.organization_id
      AND m.user_id = s.metadata_json ->> 'ingestedByUserId');
--> statement-breakpoint
UPDATE "metric_sample" s SET "user_id" = owner.user_id
FROM (
  SELECT e.organization_id, (e.metadata_json ->> 'metricSampleId') AS sample_id,
    min(e.user_id) AS user_id
  FROM "weight_event" e
  WHERE (e.metadata_json ->> 'metricSampleId') ~ '^[0-9]+$'
  GROUP BY 1, 2
  HAVING count(DISTINCT e.user_id) = 1
) owner, "metric_definition" d
WHERE s.user_id IS NULL
  AND s.organization_id = owner.organization_id
  AND s.id::text = owner.sample_id
  AND d.id = s.metric_definition_id
  AND d.organization_id = s.organization_id
  AND d.code = 'weight'
  AND EXISTS (SELECT 1 FROM "member" m
    WHERE m.organization_id = s.organization_id AND m.user_id = owner.user_id);
--> statement-breakpoint
UPDATE "health_event" h SET "user_id" = owner.user_id
FROM (
  SELECT a.organization_id, a.target_id, min(a.actor_user_id) AS user_id
  FROM "access_audit_log" a
  WHERE a.event_type = 'RECORD_CREATED'
    AND a.target_type = 'health_event'
    AND a.after_json -> 'metadata' ->> 'source' = 'health_connect'
    AND a.after_json -> 'metadata' ->> 'eventType' = 'sleep_session'
    AND a.actor_user_id IS NOT NULL
  GROUP BY 1, 2
  HAVING count(*) = 1
) owner
WHERE h.user_id IS NULL
  AND h.event_type = 'sleep_session'
  AND h.data_source_id IS NULL
  AND h.organization_id = owner.organization_id
  AND h.id::text = owner.target_id
  AND EXISTS (SELECT 1 FROM "member" m
    WHERE m.organization_id = h.organization_id AND m.user_id = owner.user_id);
