import { readdir } from "node:fs/promises";

import { sql, type Database } from "@openvalens/db";

/**
 * Test-only helpers for the data-rights integration suites: apply every
 * migration to an empty disposable database, and seed one synthetic account
 * (user + owned organization) across the tables export and delete must cover.
 */

export function assertDisposable(url: string | undefined, database: string): void {
  if (!url) return;
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== `/${database}`)
    throw new Error(`Empty disposable loopback ${database} database required.`);
}

const MIGRATIONS_ROOT = new URL("../../db/src/migrations/", import.meta.url);

/** Tracked migration directories (timestamp-prefixed), in application order. */
async function migrationDirectories(): Promise<string[]> {
  return (await readdir(MIGRATIONS_ROOT)).filter((name) => /^\d/.test(name)).sort();
}

/** Applies one tracked migration folder's `migration.sql`. */
export async function applyMigration(db: Database, directory: string): Promise<void> {
  const text = await Bun.file(new URL(`${directory}/migration.sql`, MIGRATIONS_ROOT)).text();
  for (const statement of text.split("--> statement-breakpoint"))
    if (statement.trim()) await db.execute(sql.raw(statement));
}

/**
 * Applies every tracked migration to an empty disposable database. Pass
 * `stopBefore` to apply only the migrations that sort before it (used to seed
 * pre-existing rows, then apply a migration whose data-bootstrap depends on
 * them).
 */
export async function migrateEmptyDatabase(
  db: Database,
  options: { stopBefore?: string } = {},
): Promise<void> {
  const tables = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
  if (tables.rows.length) throw new Error("Integration database must be empty.");
  for (const directory of await migrationDirectories()) {
    if (options.stopBefore && directory >= options.stopBefore) break;
    await applyMigration(db, directory);
  }
}

/** Seeds account `who` (user-<who>, org-<who>) with `samples` metric samples. */
export async function seedAccount(db: Database, who: string, samples: number): Promise<void> {
  await db.execute(
    sql.raw(`
    insert into "user" (id, email) values ('user-${who}', '${who}@example.test');
    insert into organization (id, name, slug) values ('org-${who}', 'Record ${who}', 'record-${who}');
    insert into member (id, organization_id, user_id, role) values ('m-${who}', 'org-${who}', 'user-${who}', 'owner');
    insert into session (id, user_id, token, expires_at) values ('s-${who}', 'user-${who}', 'session-secret-${who}', now() + interval '1 day');
    insert into account (id, account_id, provider_id, user_id, password) values ('acc-${who}', 'acct-${who}', 'credential', 'user-${who}', 'password-hash-${who}');
    insert into metric_definition (organization_id, code, display_name) values ('org-${who}', 'weight', 'Weight');
    insert into telegram_connect_token (organization_id, user_id, token_hash, expires_at, created_at) values ('org-${who}', 'user-${who}', 'tg-hash-${who}', '2099-01-01', '2026-10-01');
    insert into supplement (name, dose) values ('Supplement ${who}', '1 cap');
    insert into access_request (organization_id, requester_user_id, target_domain, requested_actions, created_at) values ('org-${who}', 'user-${who}', 'labs', '["read"]', '2026-10-01');
    insert into stored_object (id, organization_id, created_by_user_id, purpose, storage_key, content_type, size_bytes, sha256)
      values (gen_random_uuid()::text, 'org-${who}', 'user-${who}', 'progress_photo', 'org/org-${who}/' || gen_random_uuid()::text, 'image/jpeg', 12, '${"0".repeat(64)}');
  `),
  );
  await db.execute(
    sql.raw(`
    insert into metric_sample (organization_id, metric_definition_id, sampled_at, dedupe_hash, numeric_value)
      select 'org-${who}', id, now(), 'dh-${who}-' || g, 70 + g
      from metric_definition, generate_series(1, ${samples}) g
      where organization_id = 'org-${who}';
    insert into supplement_schedule (organization_id, user_id, supplement_id, time_of_day)
      select 'org-${who}', 'user-${who}', id, 'morning' from supplement where name = 'Supplement ${who}';
    insert into access_request_decision (request_id, decision, created_at)
      select id, 'approved', '2026-10-01' from access_request where organization_id = 'org-${who}';
    insert into insight_preference (organization_id, user_id, push_enabled, email_enabled, email_acknowledged_version, email_unsubscribe_token_hash)
      values ('org-${who}', 'user-${who}', true, true, '2026-10-16', 'unsub-hash-${who}');
    insert into insight_feedback (organization_id, user_id, insight_id, rule_id, rule_version, action)
      values ('org-${who}', 'user-${who}', 'change.steps:2026-W41', 'change.steps', '1', 'dismiss');
    insert into insight_delivery (organization_id, user_id, channel, period_key, insight_ids, rule_versions, status)
      values ('org-${who}', 'user-${who}', 'push', '2026-10-01', '{change.steps:2026-W41}', '{change.steps@1}', 'sent');
    insert into push_device (user_id, expo_push_token, platform) values ('user-${who}', 'ExponentPushToken[seed-${who}-0000]', 'ios');
    insert into preventive_care_setting (organization_id, user_id, library_enabled) values ('org-${who}', 'user-${who}', true);
    insert into preventive_care_declaration (organization_id, user_id, criterion_id, answer) values ('org-${who}', 'user-${who}', 'ever_smoked', 'prefer_not_to_say');
    insert into preventive_care_item_state (organization_id, user_id, item_id, item_version, plan, last_done_on, next_on, remind)
      values ('org-${who}', 'user-${who}', 'uk.bowel_screening', 1, 'expect_invitation', '2025-01-10', '2027-01-10', true);
    insert into reference_comparison_opt_in (user_id, metric, reference_version) values ('user-${who}', 'resting_heart_rate', 'reference-data-2026-10-16');
  `),
  );
}

/**
 * Seeds one row in every module table `seedAccount` leaves empty (#89), so
 * erasure tests prove each module is actually removed, not just vacuously
 * empty. Account `who` must already exist (see `seedAccount`).
 */
export async function seedEveryModule(db: Database, who: string): Promise<void> {
  const org = `org-${who}`;
  const user = `user-${who}`;
  const statements = [
    // Identity and administration
    `insert into analytics_consent (user_id, enabled) values ('${user}', true)`,
    `insert into user_preference (user_id, locale) values ('${user}', 'pt-PT')`,
    // Cloud public sign-up (#294)
    `insert into sign_up_request (id, canonical_email, token_hash, terms_version, privacy_version, accepted_at, expires_at, consumed_at, user_id) values ('sur-${who}', 'signup-${who}@example.test', 'signup-token-hash-${who}', 't-1', 'p-1', now(), now() + interval '1 hour', now(), '${user}')`,
    `insert into legal_acceptance (id, user_id, document, version, accepted_at, source) values ('legal-${who}', '${user}', 'terms', 't-1', now(), 'sign_up')`,
    // Cloud billing (#297): a subscribed owner, so erasure must queue Stripe.
    `insert into subscription (id, user_id, customer_ref, stripe_customer_id, stripe_subscription_id, status, price_id, trial_ends_at) values ('sub-row-${who}', '${user}', 'ovc_seed_${who}', 'cus_seed_${who}', 'sub_seed_${who}', 'active', 'price_seed', now())`,
    `insert into invitation (id, organization_id, email, role, expires_at) values ('inv-${who}', '${org}', 'invitee-${who}@example.test', 'collaborator', now() + interval '1 day')`,
    `insert into organization_role (id, organization_id, role, permission) values ('role-${who}', '${org}', 'reviewer', '{"records":["read"]}')`,
    `insert into admin_notification (organization_id, type, created_at) values ('${org}', 'seed', '2026-10-01')`,
    `insert into access_audit_log (organization_id, actor_user_id, event_type, created_at) values ('${org}', '${user}', 'seed', '2026-10-01')`,
    `insert into onboarding_state (organization_id, current_step) values ('${org}', 'done')`,
    `insert into user_ai_consent (user_id, granted) values ('${user}', true)`,
    // AI usage per month (#299): counts only.
    `insert into ai_usage_month (user_id, month, input_tokens, output_tokens, cost_micros, call_count) values ('${user}', '2026-10-01', 1200, 300, 5400, 2)`,
    // Connected AI apps (#439): one personal-key grant, its key and one call.
    `with grant_row as (insert into ai_app_grant (organization_id, user_id, kind, label, scopes, consent_version, consented_at) values ('${org}', '${user}', 'personal_key', 'Seeded key ${who}', '{records:read}', 'mcp-v1', now()) returning id),
          key_row as (insert into ai_app_key (grant_id, user_id, key_hash, display_prefix) select id, '${user}', 'seed-key-hash-${who}', 'ov_seed00' from grant_row)
       insert into ai_app_call (grant_id, user_id, tool, transport, status, row_count) select id, '${user}', 'labs', 'mcp', 'ok', 3 from grant_row`,
    // AI app writes (#439, M2): one write receipt and the entry it made.
    `with write_row as (insert into ai_app_write (grant_id, organization_id, user_id, mutation_id, tool, fingerprint, entry_count, status, outcome) select id, '${org}', '${user}', 'seed-mutation-${who}', 'water.log', 'seed-write-fingerprint-${who}', 1, 'done', '{"entries":[]}' from ai_app_grant where user_id = '${user}' and kind = 'personal_key' returning id, grant_id)
       insert into ai_app_entry (grant_id, organization_id, user_id, write_id, item_index, kind, target_table, target_ids) select grant_id, '${org}', '${user}', id, 0, 'water', 'plain_water_entry', '{1}' from write_row`,
    // AI app drafts (#439, M2c): one lab result waiting for the member's review.
    `insert into ai_app_draft (id, grant_id, organization_id, user_id, kind, payload) select gen_random_uuid(), id, '${org}', '${user}', 'lab', '{"marker":"blood_marker_ferritin","value":40,"unit":"ng/mL"}' from ai_app_grant where user_id = '${user}' and kind = 'personal_key'`,
    // OAuth connection (#439, M1b): a client the member registered, an
    // `oauth` grant and the consent and token pair pointing at it.
    `insert into oauth_client (id, client_id, client_secret, user_id, name, redirect_uris, created_at) values ('oc-${who}', 'oauth-client-${who}', 'seed-client-secret-${who}', '${user}', 'Seeded app ${who}', '{https://app.example.test/callback}', now())`,
    `with grant_row as (insert into ai_app_grant (organization_id, user_id, kind, label, scopes, consent_version, consented_at, oauth_client_id) values ('${org}', '${user}', 'oauth', 'Seeded app ${who}', '{records:read}', 'mcp-v1', now(), 'oauth-client-${who}') returning id),
          consent_row as (insert into oauth_consent (id, client_id, user_id, reference_id, scopes, created_at, updated_at) select 'ocs-${who}', 'oauth-client-${who}', '${user}', id::text, '{records:read,offline_access}', now(), now() from grant_row),
          refresh_row as (insert into oauth_refresh_token (id, token, client_id, user_id, reference_id, resources, scopes, expires_at, created_at, rotation_replay_response) select 'ort-${who}', 'seed-refresh-hash-${who}', 'oauth-client-${who}', '${user}', id::text, '{https://server.example.test/api/mcp}', '{records:read,offline_access}', now() + interval '90 days', now(), 'seed-replay-response-${who}' from grant_row returning id)
       insert into oauth_access_token (id, token, client_id, user_id, reference_id, refresh_id, resources, scopes, expires_at, created_at) select 'oat-${who}', 'seed-access-hash-${who}', 'oauth-client-${who}', '${user}', g.id::text, r.id, '{https://server.example.test/api/mcp}', '{records:read,offline_access}', now() + interval '1 hour', now() from grant_row g, refresh_row r`,
    `insert into wellness_profile (user_id, revision) values ('${user}', 1)`,
    // Weight and Health Connect
    `insert into weight_event (organization_id, user_id, date, measured_at, source, weight_kg, created_at) values ('${org}', '${user}', '2026-10-01', '2026-10-01T07:00', 'manual', 72, '2026-10-01')`,
    `insert into daily_weight (organization_id, user_id, date, source, weight_kg, resolved_from_event_id, created_at, updated_at) select '${org}', '${user}', '2026-10-01', 'manual', 72, id, '2026-10-01', '2026-10-01' from weight_event where organization_id = '${org}'`,
    `insert into health_connect_sync (organization_id, payload_version, started_at, started_at_ts, window_start, window_end, created_at) values ('${org}', '1', '2026-10-01', now(), '2026-09-30', '2026-10-01', '2026-10-01')`,
    `insert into health_connect_record (organization_id, sync_id, record_type, start_time, start_time_ts, value_json, hash, ingested_at) select '${org}', id, 'steps', '2026-10-01', now(), '{"count": 100}', 'hc-${who}', '2026-10-01' from health_connect_sync where organization_id = '${org}'`,
    // Nutrition diary
    `insert into nutrition_food (organization_id, user_id, name, nutrient_basis_amount, nutrient_basis_unit, energy_kcal) values ('${org}', '${user}', 'Synthetic food ${who}', 100, 'g', 120)`,
    `insert into nutrition_food_snapshot (organization_id, source, source_food_id, source_version, custom_food_id, name, nutrient_basis_amount, nutrient_basis_unit, energy_kcal, content_hash) select '${org}', 'custom', id::text, '1', id, name, 100, 'g', 120, 'hash-${who}' from nutrition_food where organization_id = '${org}'`,
    `insert into nutrition_meal (organization_id, user_id, local_date, time_zone, slot) values ('${org}', '${user}', '2026-10-01', 'UTC', 'lunch')`,
    `insert into nutrition_meal_entry (organization_id, user_id, meal_id, snapshot_id, amount, unit, nutrient_factor, method) select '${org}', '${user}', m.id, s.id, 50, 'g', 0.5, 'manual' from nutrition_meal m, nutrition_food_snapshot s where m.organization_id = '${org}' and s.organization_id = '${org}'`,
    `insert into nutrition_diary_day (organization_id, user_id, local_date, completed_at) values ('${org}', '${user}', '2026-10-01', now())`,
    `insert into nutrition_favorite_food (organization_id, user_id, snapshot_id) select '${org}', '${user}', id from nutrition_food_snapshot where organization_id = '${org}'`,
    `insert into nutrition_diary_mutation (organization_id, user_id, client_mutation_id, kind, entry_id) select '${org}', '${user}', 'cm-${who}', 'update', id from nutrition_meal_entry where organization_id = '${org}'`,
    // Body
    `with scan as (insert into dexa_scan (organization_id, date, created_at) values ('${org}', '2026-09-01', '2026-09-01') returning organization_id, id)
       insert into dexa_regional (organization_id, scan_id, measurement_type, region, value) select organization_id, id, 'fat_mass', 'trunk', 10 from scan`,
    `insert into daily_weight_override (organization_id, user_id, date, weight_kg, created_at) values ('${org}', '${user}', '2026-09-01', 70, '2026-09-01')`,
    `insert into body_comp_event (organization_id, user_id, source, measured_at, date, created_at, weight_kg) values ('${org}', '${user}', 'manual', '2026-09-01T08:00:00Z', '2026-09-01', '2026-09-01', 70)`,
    `insert into weight_checkin (organization_id, date, weight_kg, created_at) values ('${org}', '2026-09-01', 70, '2026-09-01')`,
    `insert into private_body_measurement (organization_id, user_id, kind, value, unit, measured_at) values ('${org}', '${user}', 'waist', 80, 'cm', now())`,
    `insert into private_body_measurement_preference (user_id, enabled) values ('${user}', true)`,
    // Cycle logging (#91)
    `insert into cycle_preference (user_id, enabled, consent_version, consented_at) values ('${user}', true, 'cycle-v1', now())`,
    `with run as (insert into cycle_import (organization_id, user_id, source, period_count) values ('${org}', '${user}', 'health_connect', 1) returning id)
       insert into cycle_period (organization_id, user_id, start_date, source, source_record_id, import_id) select '${org}', '${user}', '2026-09-01', 'health_connect', 'hc-${who}', id from run`,
    // Custom trackers (#441)
    `with tracker as (insert into custom_tracker (organization_id, user_id, name, icon, type, aggregation) values ('${org}', '${user}', 'Sauna', 'flame', 'duration', 'sum') returning id, organization_id, user_id)
       insert into custom_tracker_entry (tracker_id, organization_id, user_id, logged_by_user_id, value, logged_at, local_date, note) select id, organization_id, user_id, user_id, 1200, '2026-09-01T08:00:00Z', '2026-09-01', 'seeded ${who}' from tracker`,
    `insert into custom_tracker_feed (organization_id, user_id, feed, tracker_id) select organization_id, user_id, 'healthkit_mindful_sessions', id from custom_tracker where organization_id = '${org}' and user_id = '${user}' and name = 'Sauna'`,
    // Pain log (#442)
    `insert into pain_preference (user_id, enabled, ai_visible) values ('${user}', true, false)`,
    `insert into pain_entry (organization_id, user_id, region, rating, type, logged_at, local_date, note) values ('${org}', '${user}', 'joint.knee_left', 4, 'ache', '2026-09-01T08:00:00Z', '2026-09-01', 'seeded ${who}')`,
    // Clinical
    `with panel as (insert into blood_panel (organization_id, date, created_at) values ('${org}', '2026-09-01', '2026-09-01') returning organization_id, id)
       insert into blood_marker (organization_id, panel_id, category, test_name, test_key) select organization_id, id, 'lipids', 'LDL', 'ldl' from panel`,
    `with exam as (insert into cardiac_exam (organization_id, date, type, created_at) values ('${org}', '2026-09-01', 'ecg', '2026-09-01') returning organization_id, id)
       insert into cardiac_measurement (organization_id, exam_id, name) select organization_id, id, 'qtc' from exam`,
    `insert into imaging_study (organization_id, date, type, body_part, created_at) values ('${org}', '2026-09-01', 'xray', 'chest', '2026-09-01')`,
    `insert into consultation (organization_id, date, type, created_at) values ('${org}', '2026-09-01', 'gp', '2026-09-01')`,
    `insert into family_history (organization_id, relation, condition, created_at) values ('${org}', 'parent', 'seeded condition', '2026-09-01')`,
    `insert into supplement_change (organization_id, date, change_type) values ('${org}', '2026-09-01', 'started')`,
    `insert into medication (organization_id, user_id, name) values ('${org}', '${user}', 'Seeded medication ${who}')`,
    // AI and coaching
    `insert into ai_feedback (organization_id, source, rating, created_at) values ('${org}', 'chat', 'up', '2026-09-01')`,
    `insert into coach_profile (organization_id, tone, assertiveness, risk_tolerance, medical_disclaimer_mode, selected_template_key, updated_at) values ('${org}', 'warm', 2, 'low', 'standard', 'default', '2026-09-01')`,
    `insert into insight (organization_id, type, title, created_at) values ('${org}', 'seed', 'Seeded insight', '2026-09-01')`,
    `insert into chat_message (organization_id, user_id, conversation_id, role, content, created_at) values ('${org}', '${user}', 'conv-${who}', 'user', 'Seeded message', '2026-09-01')`,
    `insert into nutrition_coach_consent (organization_id, user_id, granted) values ('${org}', '${user}', true)`,
    `insert into weekly_review (organization_id, week_start, created_at) values ('${org}', '2026-08-31', '2026-09-01')`,
    // Ingestion and integrations
    `with connection as (insert into provider_connection (organization_id, provider, external_user_id) values ('${org}', 'seed', 'ext-${who}') returning organization_id, id)
       insert into data_source (organization_id, provider_connection_id, source_type, source_key) select organization_id, id, 'device', 'seed-${who}' from connection`,
    `insert into wearable_connection (organization_id, user_id, provider_connection_id, provider) select organization_id, '${user}', id, 'seed' from provider_connection where organization_id = '${org}' and external_user_id = 'ext-${who}'`,
    `insert into wearable_oauth_state (state_hash, organization_id, user_id, provider, expires_at) values ('state-${who}', '${org}', '${user}', 'seed', now() + interval '10 minutes')`,
    `insert into metric_source_preference (organization_id, user_id, metric_code, preferred_sources) select organization_id, '${user}', code, '["seed"]' from metric_definition where organization_id = '${org}' limit 1`,
    `with job as (insert into ingestion_job (organization_id, job_type) values ('${org}', 'seed') returning organization_id, id),
          batch as (insert into ingestion_batch (organization_id, ingestion_job_id) select organization_id, id from job returning organization_id, id, ingestion_job_id),
          error as (insert into ingestion_error (organization_id, ingestion_job_id, ingestion_batch_id, error_code, message) select organization_id, ingestion_job_id, id, 'seed', 'Seeded error' from batch)
       insert into ingestion_raw_artifact (organization_id, ingestion_job_id, ingestion_batch_id, artifact_type, payload_json, size_bytes) select organization_id, ingestion_job_id, id, 'seed', '{}', 2 from batch`,
    `insert into ingestion_log (organization_id, status, created_at) values ('${org}', 'ok', '2026-09-01')`,
    `insert into health_event (organization_id, event_type, event_at, dedupe_hash) values ('${org}', 'seed', now(), 'event-${who}')`,
    `insert into provenance_link (organization_id, target_table, target_id, source_table, source_id) values ('${org}', 'metric_sample', 1, 'health_event', 1)`,
    `insert into telegram_account (organization_id, user_id, telegram_chat_id, telegram_user_id, connected_at, created_at) values ('${org}', '${user}', 'chat-${who}', 'tg-${who}', '2026-09-01', '2026-09-01')`,
    `insert into daily_reminder (organization_id, user_id, date, source_type, source_id, label, created_at) values ('${org}', '${user}', '2026-09-01', 'activity', 1, 'Seeded reminder', '2026-09-01')`,
    `insert into daily_reminder_email_digest
       (organization_id, user_id, date, reminder_ids, rendered_email, created_at, delivered_at, provider_message_id)
       select r.organization_id, r.user_id, '2026-09-01', array_agg(r.id order by r.id),
         jsonb_build_object(
           'to', u.email,
           'from', 'OpenValens <reminders@example.test>',
           'subject', 'Your daily reminders',
           'html', '<p>Seeded daily reminder digest</p>',
           'text', 'Seeded daily reminder digest',
           'templateName', 'daily-reminder'
         ),
         '2026-09-01T08:00:00.000Z', '2026-09-01T08:00:01.000Z', 'digest-provider-${who}'
       from daily_reminder r
       join "user" u on u.id = r.user_id
       where r.organization_id = '${org}' and r.user_id = '${user}'
       group by r.organization_id, r.user_id, u.email`,
    // Plans, goals and training
    `with goal_row as (insert into goal (organization_id, title, category) values ('${org}', 'Seeded goal', 'fitness') returning organization_id, id)
       insert into goal_checkin (organization_id, goal_id, date, created_at) select organization_id, id, '2026-09-01', '2026-09-01' from goal_row`,
    `insert into calendar_event (organization_id, date, type, title) values ('${org}', '2026-09-01', 'seed', 'Seeded event')`,
    `insert into scheduled_event (organization_id, user_id, title, type, start_date, frequency, created_at) values ('${org}', '${user}', 'Seeded schedule', 'seed', '2026-09-01', 'weekly', '2026-09-01')`,
    `with exercise_row as (insert into exercise (organization_id, source, name) values ('${org}', 'user', 'Seeded exercise ${who}') returning id),
          t as (insert into exercise_translation (exercise_id, language_code, name) select id, 'pt', 'Exercício' from exercise_row),
          m as (insert into exercise_muscle (exercise_id, name, role) select id, 'quadriceps', 'primary' from exercise_row),
          e as (insert into exercise_equipment (exercise_id, name) select id, 'barbell' from exercise_row)
       insert into exercise_media (exercise_id, source_external_media_id, kind) select id, 'media-${who}', 'image' from exercise_row`,
    `with workout_row as (insert into workout (organization_id, date, type, created_at) values ('${org}', '2026-09-01', 'strength', '2026-09-01') returning organization_id, id),
          exercise_row as (insert into workout_exercise (organization_id, workout_id, name) select organization_id, id, 'Squat' from workout_row returning organization_id, id)
       insert into workout_set (organization_id, exercise_id) select organization_id, id from exercise_row`,
  ];
  for (const statement of statements) await db.execute(sql.raw(statement));
  await seedPersonalGoals(db, who);
}

/** Seeds complete, explicitly owned goal history and source-linked fixtures. */
export async function seedPersonalGoals(db: Database, who: string): Promise<void> {
  const org = `org-${who}`;
  const owner = `user-${who}`;
  const definition = JSON.stringify({
    id: `rights-goal-${who}`,
    title: `Personal goal ${who}`,
    source: "water",
    metric: "water_ml",
    unit: "ml",
    rule: { kind: "recurring", cadence: "daily" },
    startDate: "2026-09-01",
    timeZone: "UTC",
    status: "active",
    milestones: [{ id: "milestone-1", value: 1000, targetDate: "2026-09-10" }],
    versions: [],
    pauses: [],
  });
  const created = (
    await db.execute(sql`
    insert into goal (organization_id, user_id, title, category, status, source,
      ever_had_evidence, definition, timezone, start_date)
    values (${org}, ${owner}, ${`Personal goal ${who}`}, 'health', 'in_progress', 'water', true,
      ${definition}::jsonb,
      'UTC', '2026-09-01') returning id
  `)
  ).rows[0] as { id: number } | undefined;
  if (!created) throw new Error(`personal goal fixture missing for ${who}`);
  const goalId = created.id;
  const checkin = (
    await db.execute(sql`
    insert into goal_checkin (organization_id, user_id, goal_id, date, value, notes, created_at)
    values (${org}, ${owner}, ${goalId}, '2026-09-01', '1200', 'original evidence', '2026-09-01T08:00:00Z') returning id
  `)
  ).rows[0] as { id: number } | undefined;
  if (!checkin) throw new Error(`goal check-in fixture missing for ${who}`);
  await db.execute(
    sql`update goal_checkin set deleted_at = '2026-09-01T10:00:00Z' where id = ${checkin.id}`,
  );
  await db.execute(sql`
    insert into goal_checkin
      (organization_id, user_id, goal_id, date, value, notes, version, corrected_from_id, created_at)
    values (${org}, ${owner}, ${goalId}, '2026-09-01', '1500', 'corrected evidence', 2, ${checkin.id}, '2026-09-01T10:01:00Z')
  `);
  await db.execute(sql`
    insert into goal_ownership_assignment
      (organization_id, goal_id, assigned_user_id, assigned_by_user_id, reason)
    select ${org}, id, ${owner}, ${owner}, 'verified fixture assignment'
    from goal where organization_id = ${org} and title = 'Seeded goal'
  `);
  const queries = [
    sql`insert into goal_definition
      (organization_id, user_id, goal_id, revision, definition, effective_from, effective_until)
      values (${org}, ${owner}, ${goalId}, 1,
        ${definition}::jsonb,
        '2026-09-01', '2026-09-15'),
        (${org}, ${owner}, ${goalId}, 2,
        ${definition}::jsonb,
        '2026-09-16', null)`,
    sql`insert into goal_milestone (organization_id, user_id, goal_id, value, target_date, achieved_at)
      values (${org}, ${owner}, ${goalId}, '1000', '2026-09-10', '2026-09-10T12:00:00Z')`,
    sql`insert into goal_lifecycle (organization_id, user_id, goal_id, event, occurred_at, effective_date, details)
      values (${org}, ${owner}, ${goalId}, 'created', '2026-09-01T00:00:00Z', '2026-09-01', '{"fixture":true}'::jsonb)`,
    sql`insert into goal_mutation
      (organization_id, user_id, client_mutation_id, operation, target_id, fingerprint, result)
      values (${org}, ${owner}, ${who === "a" ? "90000000-0000-4000-8000-000000000001" : "90000000-0000-4000-8000-000000000002"}::uuid,
        'create', ${goalId}, repeat('a', 64), '{"id":1}'::jsonb)`,
    sql`insert into goal_water_link (organization_id, user_id, goal_id, linked_at)
      values (${org}, ${owner}, ${goalId}, '2026-09-01T00:00:00Z')`,
    sql`insert into goal_water_cutover (organization_id, user_id, cutover_at)
      values (${org}, ${owner}, '2026-09-01T00:00:00Z')`,
    sql`insert into supplement_intake
      (organization_id, user_id, supplement_id, occurred_at, timezone, dose, note)
      select ${org}, ${owner}, id, '2026-09-01T08:00:00Z', 'UTC', '1 capsule', 'original intake'
      from supplement where name = ${`Supplement ${who}`}`,
  ];
  for (const query of queries) await db.execute(query);
  const intake = (
    await db.execute(sql`
    select id from supplement_intake where organization_id = ${org} and user_id = ${owner}
      and note = 'original intake' order by id desc limit 1
  `)
  ).rows[0] as { id: number } | undefined;
  if (!intake) throw new Error(`supplement intake fixture missing for ${who}`);
  await db.execute(
    sql`update supplement_intake set deleted_at = '2026-09-01T09:00:00Z' where id = ${intake.id}`,
  );
  await db.execute(sql`
    insert into supplement_intake
      (organization_id, user_id, supplement_id, occurred_at, timezone, dose, note, version, corrected_from_id)
    select organization_id, user_id, supplement_id, '2026-09-01T08:00:00Z', timezone,
      '2 capsules', 'corrected intake', 2, id from supplement_intake where id = ${intake.id}
  `);
}
