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
  "ACTIVITY_TEST_DATABASE_URL|activity_test|packages/activity/src/queries.integration.test.ts"
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
  if ! env "$env_var=$PG_ADMIN_URL/$database" bun test "$file"; then failed=1; fi
  echo "::endgroup::"
done

# Guard against suites added without being registered here.
registered=$(printf '%s\n' "${SUITES[@]}" | cut -d'|' -f1 | sort -u)
found=$(grep -rhoE 'process\.env\.[A-Z_]+_TEST_DATABASE_URL' packages --include='*.ts' | sed 's/process\.env\.//' | sort -u)
missing=$(comm -13 <(echo "$registered") <(echo "$found"))
if [ -n "$missing" ]; then echo "Unregistered integration suites: $missing" >&2; failed=1; fi

exit $failed
