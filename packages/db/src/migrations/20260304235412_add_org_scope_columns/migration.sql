DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'blood_panel',
    'blood_marker',
    'dexa_scan',
    'dexa_regional',
    'cardiac_exam',
    'cardiac_measurement',
    'imaging_study',
    'consultation',
    'supplement_schedule',
    'supplement_change',
    'medication',
    'telegram_account',
    'telegram_connect_token',
    'daily_reminder',
    'goal',
    'goal_checkin',
    'weight_checkin',
    'workout',
    'weekly_review',
    'health_connect_sync',
    'health_connect_record',
    'family_history',
    'ai_feedback',
    'coach_profile',
    'calendar_event',
    'insight',
    'scheduled_event',
    'chat_message',
    'ingestion_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS "organization_id" text', table_name);
  END LOOP;
END $$;
--> statement-breakpoint

DO $$
DECLARE
  target_org text;
  table_name text;
BEGIN
  SELECT "id"
  INTO target_org
  FROM "organization"
  ORDER BY "created_at" ASC NULLS LAST, "id" ASC
  LIMIT 1;

  IF target_org IS NULL THEN
    RETURN;
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'blood_panel',
    'blood_marker',
    'dexa_scan',
    'dexa_regional',
    'cardiac_exam',
    'cardiac_measurement',
    'imaging_study',
    'consultation',
    'supplement_schedule',
    'supplement_change',
    'medication',
    'telegram_account',
    'telegram_connect_token',
    'daily_reminder',
    'goal',
    'goal_checkin',
    'weight_checkin',
    'workout',
    'weekly_review',
    'health_connect_sync',
    'health_connect_record',
    'family_history',
    'ai_feedback',
    'coach_profile',
    'calendar_event',
    'insight',
    'scheduled_event',
    'chat_message',
    'ingestion_log'
  ] LOOP
    EXECUTE format('UPDATE %I SET "organization_id" = $1 WHERE "organization_id" IS NULL', table_name)
      USING target_org;
  END LOOP;
END $$;
--> statement-breakpoint

DO $$
DECLARE
  table_name text;
  index_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'blood_panel',
    'blood_marker',
    'dexa_scan',
    'dexa_regional',
    'cardiac_exam',
    'cardiac_measurement',
    'imaging_study',
    'consultation',
    'supplement_schedule',
    'supplement_change',
    'medication',
    'telegram_account',
    'telegram_connect_token',
    'daily_reminder',
    'goal',
    'goal_checkin',
    'weight_checkin',
    'workout',
    'weekly_review',
    'health_connect_sync',
    'health_connect_record',
    'family_history',
    'ai_feedback',
    'coach_profile',
    'calendar_event',
    'insight',
    'scheduled_event',
    'chat_message',
    'ingestion_log'
  ] LOOP
    index_name := format('%s_organization_id_idx', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING btree ("organization_id")', index_name, table_name);
  END LOOP;
END $$;
--> statement-breakpoint

DO $$
DECLARE
  table_name text;
  constraint_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'blood_panel',
    'blood_marker',
    'dexa_scan',
    'dexa_regional',
    'cardiac_exam',
    'cardiac_measurement',
    'imaging_study',
    'consultation',
    'supplement_schedule',
    'supplement_change',
    'medication',
    'telegram_account',
    'telegram_connect_token',
    'daily_reminder',
    'goal',
    'goal_checkin',
    'weight_checkin',
    'workout',
    'weekly_review',
    'health_connect_sync',
    'health_connect_record',
    'family_history',
    'ai_feedback',
    'coach_profile',
    'calendar_event',
    'insight',
    'scheduled_event',
    'chat_message',
    'ingestion_log'
  ] LOOP
    constraint_name := format('%s_organization_id_organization_id_fk', table_name);

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = constraint_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action',
        table_name,
        constraint_name
      );
    END IF;
  END LOOP;
END $$;
