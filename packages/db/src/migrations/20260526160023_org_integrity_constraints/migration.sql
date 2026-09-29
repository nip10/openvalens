-- 0033 reserved for issue #8/#9/#10; earlier numbers are reserved by open PRs.

DO $$
DECLARE
  r record;
  has_null boolean;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('blood_panel', 'organization_id'),
      ('blood_marker', 'organization_id'),
      ('dexa_scan', 'organization_id'),
      ('dexa_regional', 'organization_id'),
      ('cardiac_exam', 'organization_id'),
      ('cardiac_measurement', 'organization_id'),
      ('consultation', 'organization_id'),
      ('supplement_schedule', 'organization_id'),
      ('supplement_change', 'organization_id'),
      ('medication', 'organization_id'),
      ('telegram_account', 'organization_id'),
      ('telegram_connect_token', 'organization_id'),
      ('daily_reminder', 'organization_id'),
      ('goal', 'organization_id'),
      ('goal_checkin', 'organization_id'),
      ('weight_event', 'organization_id'),
      ('daily_weight', 'organization_id'),
      ('daily_weight_override', 'organization_id'),
      ('body_comp_event', 'organization_id'),
      ('weight_checkin', 'organization_id'),
      ('workout', 'organization_id'),
      ('workout_exercise', 'organization_id'),
      ('workout_set', 'organization_id'),
      ('weekly_review', 'organization_id'),
      ('health_connect_sync', 'organization_id'),
      ('health_connect_record', 'organization_id'),
      ('family_history', 'organization_id'),
      ('ai_feedback', 'organization_id'),
      ('coach_profile', 'organization_id'),
      ('calendar_event', 'organization_id'),
      ('insight', 'organization_id'),
      ('provider_connection', 'organization_id'),
      ('data_source', 'organization_id'),
      ('metric_definition', 'organization_id'),
      ('metric_source_preference', 'organization_id'),
      ('ingestion_job', 'organization_id'),
      ('ingestion_batch', 'organization_id'),
      ('metric_sample', 'organization_id'),
      ('health_event', 'organization_id'),
      ('ingestion_error', 'organization_id'),
      ('ingestion_raw_artifact', 'organization_id'),
      ('imaging_study', 'organization_id'),
      ('scheduled_event', 'organization_id'),
      ('chat_message', 'organization_id'),
      ('ingestion_log', 'organization_id')
    ) AS t(table_name, column_name)
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE %I IS NULL)', r.table_name, r.column_name) INTO has_null;
    IF has_null THEN
      RAISE EXCEPTION 'preflight failed: %.% contains NULL organization_id rows', r.table_name, r.column_name;
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM blood_marker bm LEFT JOIN blood_panel bp ON bp.organization_id = bm.organization_id AND bp.id = bm.panel_id WHERE bp.id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: blood_marker has cross-org or missing panel rows';
  END IF;
  IF EXISTS (SELECT 1 FROM supplement_schedule ss LEFT JOIN member m ON m.organization_id = ss.organization_id AND m.user_id = ss.user_id WHERE m.user_id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: supplement_schedule has cross-org or missing member rows';
  END IF;
  IF EXISTS (SELECT 1 FROM medication m2 LEFT JOIN member m ON m.organization_id = m2.organization_id AND m.user_id = m2.user_id WHERE m.user_id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: medication has cross-org or missing member rows';
  END IF;
  IF EXISTS (SELECT 1 FROM telegram_account ta LEFT JOIN member m ON m.organization_id = ta.organization_id AND m.user_id = ta.user_id WHERE m.user_id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: telegram_account has cross-org or missing member rows';
  END IF;
  IF EXISTS (SELECT 1 FROM telegram_connect_token tct LEFT JOIN member m ON m.organization_id = tct.organization_id AND m.user_id = tct.user_id WHERE m.user_id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: telegram_connect_token has cross-org or missing member rows';
  END IF;
  IF EXISTS (SELECT 1 FROM daily_reminder dr LEFT JOIN member m ON m.organization_id = dr.organization_id AND m.user_id = dr.user_id WHERE m.user_id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: daily_reminder has cross-org or missing member rows';
  END IF;
  IF EXISTS (SELECT 1 FROM weight_event we LEFT JOIN member m ON m.organization_id = we.organization_id AND m.user_id = we.user_id WHERE m.user_id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: weight_event has cross-org or missing member rows';
  END IF;
  IF EXISTS (SELECT 1 FROM dexa_regional dr LEFT JOIN dexa_scan ds ON ds.organization_id = dr.organization_id AND ds.id = dr.scan_id WHERE ds.id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: dexa_regional has cross-org or missing scan rows';
  END IF;
  IF EXISTS (SELECT 1 FROM cardiac_measurement cm LEFT JOIN cardiac_exam ce ON ce.organization_id = cm.organization_id AND ce.id = cm.exam_id WHERE ce.id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: cardiac_measurement has cross-org or missing exam rows';
  END IF;
  IF EXISTS (SELECT 1 FROM goal_checkin gc LEFT JOIN goal g ON g.organization_id = gc.organization_id AND g.id = gc.goal_id WHERE g.id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: goal_checkin has cross-org or missing goal rows';
  END IF;
  IF EXISTS (SELECT 1 FROM workout_exercise we LEFT JOIN workout w ON w.organization_id = we.organization_id AND w.id = we.workout_id WHERE w.id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: workout_exercise has cross-org or missing workout rows';
  END IF;
  IF EXISTS (SELECT 1 FROM workout_set ws LEFT JOIN workout_exercise we ON we.organization_id = ws.organization_id AND we.id = ws.exercise_id WHERE we.id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: workout_set has cross-org or missing exercise rows';
  END IF;
  IF EXISTS (SELECT 1 FROM daily_weight dw LEFT JOIN weight_event we ON we.organization_id = dw.organization_id AND we.id = dw.resolved_from_event_id WHERE dw.resolved_from_event_id IS NOT NULL AND we.id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: daily_weight has cross-org or missing resolved_from_event rows';
  END IF;
  IF EXISTS (SELECT 1 FROM daily_weight dw LEFT JOIN member m ON m.organization_id = dw.organization_id AND m.user_id = dw.user_id WHERE m.user_id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: daily_weight has cross-org or missing member rows';
  END IF;
  IF EXISTS (SELECT 1 FROM daily_weight_override dwo LEFT JOIN member m ON m.organization_id = dwo.organization_id AND m.user_id = dwo.user_id WHERE m.user_id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: daily_weight_override has cross-org or missing member rows';
  END IF;
  IF EXISTS (SELECT 1 FROM body_comp_event bce LEFT JOIN member m ON m.organization_id = bce.organization_id AND m.user_id = bce.user_id WHERE m.user_id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: body_comp_event has cross-org or missing member rows';
  END IF;
  IF EXISTS (SELECT 1 FROM scheduled_event se LEFT JOIN member m ON m.organization_id = se.organization_id AND m.user_id = se.user_id WHERE m.user_id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: scheduled_event has cross-org or missing member rows';
  END IF;
  IF EXISTS (SELECT 1 FROM mobile_sync_session mss LEFT JOIN member m ON m.organization_id = mss.organization_id AND m.user_id = mss.user_id WHERE m.user_id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: mobile_sync_session has cross-org or missing member rows';
  END IF;
  IF EXISTS (SELECT 1 FROM metric_source_preference msp LEFT JOIN member m ON m.organization_id = msp.organization_id AND m.user_id = msp.user_id WHERE msp.user_id IS NOT NULL AND m.user_id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: metric_source_preference has cross-org or missing member rows';
  END IF;
  IF EXISTS (SELECT 1 FROM health_connect_record hcr LEFT JOIN health_connect_sync hcs ON hcs.organization_id = hcr.organization_id AND hcs.id = hcr.sync_id WHERE hcs.id IS NULL) THEN
    RAISE EXCEPTION 'preflight failed: health_connect_record has cross-org or missing sync rows';
  END IF;
END $$;

ALTER TABLE blood_panel ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE blood_marker ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE dexa_scan ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE dexa_regional ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE cardiac_exam ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE cardiac_measurement ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE consultation ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE supplement_schedule ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE supplement_change ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE medication ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE telegram_account ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE telegram_connect_token ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE daily_reminder ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE goal ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE goal_checkin ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE weight_event ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE daily_weight ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE daily_weight_override ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE body_comp_event ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE weight_checkin ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE workout ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE workout_exercise ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE workout_set ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE weekly_review ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE health_connect_sync ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE health_connect_record ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE family_history ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE ai_feedback ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE coach_profile ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE calendar_event ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE insight ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE provider_connection ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE data_source ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE metric_definition ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE metric_source_preference ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE ingestion_job ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE ingestion_batch ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE metric_sample ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE health_event ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE ingestion_error ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE ingestion_raw_artifact ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE imaging_study ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE scheduled_event ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE chat_message ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE ingestion_log ALTER COLUMN organization_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS blood_panel_org_id_key ON blood_panel (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS dexa_scan_org_id_key ON dexa_scan (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS cardiac_exam_org_id_key ON cardiac_exam (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS goal_org_id_key ON goal (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS workout_org_id_key ON workout (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS weight_event_org_id_key ON weight_event (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS workout_exercise_org_id_key ON workout_exercise (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS health_connect_sync_org_id_key ON health_connect_sync (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS imaging_study_org_id_key ON imaging_study (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_event_org_id_key ON scheduled_event (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS chat_message_org_id_key ON chat_message (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_log_org_id_key ON ingestion_log (organization_id, id);

ALTER TABLE blood_marker
  ADD CONSTRAINT blood_marker_org_panel_fk FOREIGN KEY (organization_id, panel_id) REFERENCES blood_panel (organization_id, id) ON DELETE CASCADE;
ALTER TABLE dexa_regional
  ADD CONSTRAINT dexa_regional_org_scan_fk FOREIGN KEY (organization_id, scan_id) REFERENCES dexa_scan (organization_id, id) ON DELETE CASCADE;
ALTER TABLE cardiac_measurement
  ADD CONSTRAINT cardiac_measurement_org_exam_fk FOREIGN KEY (organization_id, exam_id) REFERENCES cardiac_exam (organization_id, id) ON DELETE CASCADE;
ALTER TABLE goal_checkin
  ADD CONSTRAINT goal_checkin_org_goal_fk FOREIGN KEY (organization_id, goal_id) REFERENCES goal (organization_id, id) ON DELETE CASCADE;
ALTER TABLE workout_exercise
  ADD CONSTRAINT workout_exercise_org_workout_fk FOREIGN KEY (organization_id, workout_id) REFERENCES workout (organization_id, id) ON DELETE CASCADE;
ALTER TABLE workout_set
  ADD CONSTRAINT workout_set_org_exercise_fk FOREIGN KEY (organization_id, exercise_id) REFERENCES workout_exercise (organization_id, id) ON DELETE CASCADE;
ALTER TABLE daily_weight
  ADD CONSTRAINT daily_weight_org_resolved_from_event_fk FOREIGN KEY (organization_id, resolved_from_event_id) REFERENCES weight_event (organization_id, id) ON DELETE RESTRICT;
ALTER TABLE daily_weight
  ADD CONSTRAINT daily_weight_org_user_member_fk FOREIGN KEY (organization_id, user_id) REFERENCES member (organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE health_connect_record
  ADD CONSTRAINT health_connect_record_org_sync_fk FOREIGN KEY (organization_id, sync_id) REFERENCES health_connect_sync (organization_id, id) ON DELETE RESTRICT;

ALTER TABLE daily_weight_override
  ADD CONSTRAINT daily_weight_override_org_user_member_fk FOREIGN KEY (organization_id, user_id) REFERENCES member (organization_id, user_id) ON DELETE RESTRICT;

ALTER TABLE body_comp_event
  ADD CONSTRAINT body_comp_event_org_user_member_fk FOREIGN KEY (organization_id, user_id) REFERENCES member (organization_id, user_id) ON DELETE RESTRICT;

ALTER TABLE supplement_schedule
  ADD CONSTRAINT supplement_schedule_org_user_member_fk FOREIGN KEY (organization_id, user_id) REFERENCES member (organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE medication
  ADD CONSTRAINT medication_org_user_member_fk FOREIGN KEY (organization_id, user_id) REFERENCES member (organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE telegram_account
  ADD CONSTRAINT telegram_account_org_user_member_fk FOREIGN KEY (organization_id, user_id) REFERENCES member (organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE telegram_connect_token
  ADD CONSTRAINT telegram_connect_token_org_user_member_fk FOREIGN KEY (organization_id, user_id) REFERENCES member (organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE daily_reminder
  ADD CONSTRAINT daily_reminder_org_user_member_fk FOREIGN KEY (organization_id, user_id) REFERENCES member (organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE weight_event
  ADD CONSTRAINT weight_event_org_user_member_fk FOREIGN KEY (organization_id, user_id) REFERENCES member (organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE scheduled_event
  ADD CONSTRAINT scheduled_event_org_user_member_fk FOREIGN KEY (organization_id, user_id) REFERENCES member (organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE mobile_sync_session
  ADD CONSTRAINT mobile_sync_session_org_user_member_fk FOREIGN KEY (organization_id, user_id) REFERENCES member (organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE metric_source_preference
  ADD CONSTRAINT metric_source_preference_org_user_member_fk FOREIGN KEY (organization_id, user_id) REFERENCES member (organization_id, user_id) ON DELETE RESTRICT;
