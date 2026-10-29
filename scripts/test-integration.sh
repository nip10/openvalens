#!/usr/bin/env bash
# Run every database-backed integration suite against a disposable Postgres.
#
# Each suite requires its own EMPTY database with a fixed name (the suites
# refuse any other name or a non-loopback host). This script drops and
# recreates each database, then runs its suite with the matching env var.
#
#   PG_ADMIN_URL=postgres://postgres:pw@127.0.0.1:5432 scripts/test-integration.sh
#
# Never point PG_ADMIN_URL at a shared or production server.
set -euo pipefail

: "${PG_ADMIN_URL:?Set PG_ADMIN_URL to a disposable loopback Postgres (no database path)}"
case "$PG_ADMIN_URL" in
  postgres://*@127.0.0.1:* | postgres://*@localhost:* | postgresql://*@127.0.0.1:* | postgresql://*@localhost:*) ;;
  *) echo "PG_ADMIN_URL must be a loopback host" >&2; exit 1 ;;
esac

# env var | database | test file
SUITES=(
  "INGESTION_TEST_DATABASE_URL|ingestion_cron|packages/ingestion/src/ingestion.integration.test.ts"
  "MAINTENANCE_TEST_DATABASE_URL|maintenance_issue17|packages/health-record/src/scheduler.integration.test.ts"
  "RECURRENCE_TEST_DATABASE_URL|recurrence_issue17|packages/health-record/src/recurrence.integration.test.ts"
  "METRIC_PRIORITY_TEST_DATABASE_URL|metric_priority_issue17|packages/health-record/src/metric-priority.integration.test.ts"
  "INGEST_TEST_DATABASE_URL|ingest_seam_issue17|packages/health-record/src/ingest-writer.integration.test.ts"
  "TIMELINE_TEST_DATABASE_URL|timeline_issue17|packages/health-record/src/repository.integration.test.ts"
  "BODY_TEST_DATABASE_URL|bodytest|packages/body/src/daily-weight.integration.test.ts"
  "LEGACY_EXPORT_TEST_DATABASE_URL|legacy_export_issue20|packages/clinical-export/src/repository.legacy.integration.test.ts"
  "CLINICAL_EXPORT_TEST_DATABASE_URL|clinical_export_issue20|packages/clinical-export/src/repository.integration.test.ts"
  "MOBILE_INGEST_TEST_DATABASE_URL|mobile_ingest_issue7|packages/ingestion/src/mobile-batch.integration.test.ts"
  "HEALTHKIT_SLEEP_TEST_DATABASE_URL|healthkit_sleep_issue131|packages/ingestion/src/healthkit-sleep.integration.test.ts"
  "ACTIVITY_TEST_DATABASE_URL|activity_test|packages/activity/src/queries.integration.test.ts"
  "VITALS_TEST_DATABASE_URL|vitals_test|packages/vitals/src/queries.integration.test.ts"
  "NUTRITION_TEST_DATABASE_URL|nutrition_test|packages/nutrition/src/repository.integration.test.ts"
  "NUTRITION_DIARY_TEST_DATABASE_URL|nutrition_diary_test|packages/api/src/routers/nutrition-diary.integration.test.ts"
  "NUTRITION_TEMPLATES_TEST_DATABASE_URL|nutrition_templates_test|packages/api/src/routers/nutrition-templates.integration.test.ts"
  "FOOD_CATALOG_TEST_DATABASE_URL|food_catalog_test|packages/nutrition/src/catalog/catalog.integration.test.ts"
  "NUTRITION_FOODS_TEST_DATABASE_URL|nutrition_foods_test|packages/api/src/routers/nutrition-foods.integration.test.ts"
  "WEIGHT_TREND_TEST_DATABASE_URL|weight_trend_test|packages/api/src/routers/weight-trend.integration.test.ts"
  "NUTRITION_CUSTOM_FOODS_TEST_DATABASE_URL|nutrition_custom_foods_test|packages/api/src/routers/nutrition-custom-foods.integration.test.ts"
  "NUTRITION_ENERGY_TEST_DATABASE_URL|nutrition_energy_test|packages/api/src/routers/nutrition-energy.integration.test.ts"
  "NUTRITION_TARGETS_TEST_DATABASE_URL|nutrition_targets_test|packages/api/src/routers/nutrition-targets.integration.test.ts"
  "NUTRITION_COACH_CONSENT_TEST_DATABASE_URL|nutrition_coach_consent_test|packages/nutrition/src/coach-consent.integration.test.ts"
  "WATER_TEST_DATABASE_URL|water_test|packages/nutrition/src/plain-water.integration.test.ts"
  "WATER_ROUTER_TEST_DATABASE_URL|water_router_test|packages/api/src/routers/plain-water.integration.test.ts"
  "NUTRITION_COACH_TEST_DATABASE_URL|nutrition_coach_test|packages/api/src/routers/nutrition-coach.integration.test.ts"
  "AI_CHAT_TEST_DATABASE_URL|ai_chat_test|packages/api/src/routers/ai.integration.test.ts"
  "LABS_TEST_DATABASE_URL|labs_test|packages/labs/src/queries.integration.test.ts"
  "LABS_ROUTER_TEST_DATABASE_URL|labs_router_test|packages/api/src/routers/labs.integration.test.ts"
  "AI_TOOLS_TEST_DATABASE_URL|ai_tools_test|packages/ai/src/tools/health-tools.integration.test.ts"
  "AI_REMAINING_TOOLS_TEST_DATABASE_URL|ai_remaining_tools_test|packages/ai/src/tools/remaining-tools.integration.test.ts"
  "DATA_RIGHTS_TEST_DATABASE_URL|data_rights_test|packages/data-rights/src/export.integration.test.ts"
  "DATA_RIGHTS_DELETE_TEST_DATABASE_URL|data_rights_delete_test|packages/data-rights/src/delete.integration.test.ts"
  "ERASURE_REPLAY_TEST_DATABASE_URL|erasure_replay_test|packages/data-rights/src/replay.integration.test.ts"
  "INSTANCE_ADMIN_TEST_DATABASE_URL|instance_admin_test|packages/auth/src/authz/instance-admin.integration.test.ts"
  "ADMISSION_TEST_DATABASE_URL|admission_test|packages/auth/src/admission/admission.integration.test.ts"
  "ADMISSION_AUTH_TEST_DATABASE_URL|admission_auth_test|packages/auth/src/admission-auth.integration.test.ts"
  "ORG_INVITATION_TEST_DATABASE_URL|org_invitation_test|packages/auth/src/organization-invitation.integration.test.ts"
  "OIDC_AUTH_TEST_DATABASE_URL|oidc_auth_test|packages/auth/src/oidc-auth.integration.test.ts"
  "PUBLIC_SIGN_UP_TEST_DATABASE_URL|public_sign_up_test|packages/auth/src/public-sign-up.integration.test.ts"
  "SOCIAL_AUTH_TEST_DATABASE_URL|social_auth_test|packages/auth/src/social-auth.integration.test.ts"
  "ADMISSION_AUTH_TEST_DATABASE_URL|admission_rpc_test|packages/api/src/admission-rpc.integration.test.ts"
  "ADMISSION_AUTH_TEST_DATABASE_URL|admission_cli_test|scripts/admission.integration.test.ts"
  "ADMISSION_AUTH_TEST_DATABASE_URL|admission_sharing_test|packages/api/src/routers/sharing.integration.test.ts"
  "PRODUCT_SETTINGS_TEST_DATABASE_URL|product_settings_test|packages/api/src/product-settings.integration.test.ts"
  "WELLNESS_PROFILE_TEST_DATABASE_URL|wellness_profile_test|packages/api/src/wellness-profile.integration.test.ts"
  "DATA_RIGHTS_ERASURE_AUTH_TEST_DATABASE_URL|data_rights_erasure_auth_test|packages/api/src/routers/data-rights.integration.test.ts"
  "PRIVATE_BODY_TEST_DATABASE_URL|private_body_test|packages/api/src/private-body.integration.test.ts"
  "BODY_MAP_TEST_DATABASE_URL|body_map_test|packages/api/src/body-map.integration.test.ts"
  "STRENGTH_TEST_DATABASE_URL|strength_training_test|packages/api/src/strength-training.integration.test.ts"
  "PREFERENCES_TEST_DATABASE_URL|preferences_test|packages/api/src/preferences.integration.test.ts"
  "CYCLE_TEST_DATABASE_URL|cycle_test|packages/api/src/cycle.integration.test.ts"
  "SCORE_TEST_DATABASE_URL|score_test|packages/api/src/score.integration.test.ts"
  "ACTIVITY_LOAD_TEST_DATABASE_URL|activity_load_test|packages/api/src/activity-load.integration.test.ts"
  "INSIGHTS_TEST_DATABASE_URL|insights_test|packages/api/src/insights.integration.test.ts"
  "PREVENTIVE_CARE_TEST_DATABASE_URL|preventive_care_test|packages/api/src/preventive-care.integration.test.ts"
  "REFERENCE_COMPARISON_TEST_DATABASE_URL|reference_comparison_test|packages/api/src/reference-comparison.integration.test.ts"
  "REMINDERS_TEST_DATABASE_URL|reminders_issue125|packages/integrations/telegram/src/reminders.integration.test.ts"
  "REMINDER_MATERIALIZATION_TEST_DATABASE_URL|reminder_materialization_test|packages/integrations/telegram/src/reminder-materialization.integration.test.ts"
  "TELEGRAM_CONNECT_TEST_DATABASE_URL|telegram_connect_test|packages/integrations/telegram/src/connect.integration.test.ts"
  "STORAGE_TEST_DATABASE_URL|storage_test|packages/storage/src/service.integration.test.ts"
  "WEARABLES_TEST_DATABASE_URL|wearables_issue60|packages/integrations/wearables/src/service.integration.test.ts"
  "ANALYTICS_TEST_DATABASE_URL|analytics_consent_test|apps/server/src/services/analytics.integration.test.ts"
  "EXERCISE_CATALOG_TEST_DATABASE_URL|exercise_catalog_test|apps/server/src/services/exercise-catalog.integration.test.ts"
  "EXERCISE_CATALOG_API_TEST_DATABASE_URL|exercise_catalog_api_test|packages/api/src/services/exercise-catalog.integration.test.ts"
  "FOOD_CATALOG_CLI_TEST_DATABASE_URL|food_catalog_cli_test|scripts/food-catalog-import.integration.test.ts"
  "DEMO_SEED_TEST_DATABASE_URL|openvalens_demo_test|packages/demo-seed/src/demo-seed.integration.test.ts"
)

reset_db() {
  bun -e '
    const sql = new Bun.SQL(process.argv[1] + "/postgres");
    await sql.unsafe(`drop database if exists "${process.argv[2]}" with (force)`);
    await sql.unsafe(`create database "${process.argv[2]}"`);
    await sql.close();
  ' "$PG_ADMIN_URL" "$1"
}

failed=0
for suite in "${SUITES[@]}"; do
  IFS='|' read -r env_var database file <<<"$suite"
  if [ ! -f "$file" ]; then echo "missing suite $file" >&2; failed=1; continue; fi
  reset_db "$database"
  echo "::group::$file"
  # Each suite migrates a fresh database in beforeAll; with ~80 migrations that
  # can pass bun's 5s hook default when Postgres is busy, so allow 30s.
  if ! env "$env_var=$PG_ADMIN_URL/$database" bun test --timeout 30000 "$file"; then failed=1; fi
  echo "::endgroup::"
done

# Guard against suites added without being registered here.
registered=$(printf '%s\n' "${SUITES[@]}" | cut -d'|' -f1 | sort -u)
found=$(grep -rhoE 'process\.env\.[A-Z_]+_TEST_DATABASE_URL' packages apps scripts --include='*.ts' | sed 's/process\.env\.//' | sort -u)
missing=$(comm -13 <(echo "$registered") <(echo "$found"))
if [ -n "$missing" ]; then echo "Unregistered integration suites: $missing" >&2; failed=1; fi

exit $failed
