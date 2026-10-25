#!/bin/sh
# Pre-migrate backup hook (Issue #63). Runs in the one-shot `backup` service of
# deploy/compose.yml, after Postgres is healthy and BEFORE `migrate`. A non-zero
# exit stops the chain: migrations do not run and `server` does not start.
#
# OPENVALENS_PRE_MIGRATE_BACKUP selects the hook:
#   pg_dump (default)  encrypted backup of the database AND the stored files
#                      into the `backups` volume (Issue #64, see
#                      deploy/backup/openvalens-backup.sh), verified (decrypt,
#                      checksums, `pg_restore --list`) before it counts.
#   hook               run the operator's executable deploy/hooks/pre-migrate
#                      (mounted at /opt/openvalens/hooks/pre-migrate). It must
#                      exit 0 only after a backup it trusts has been written.
#   none               take no backup. Refused unless
#                      OPENVALENS_ALLOW_MIGRATE_WITHOUT_BACKUP=I_HAVE_A_BACKUP.
#
# A `hook` writes whatever the operator's hook writes: if it is unencrypted,
# treat the `backups` volume as health data.
#
# Never prints database contents, connection strings or passwords.
set -eu

log() { echo "pre-migrate-backup: $*"; }
fail() {
  echo "pre-migrate-backup: ERROR: $*" >&2
  exit 1
}

mode="${OPENVALENS_PRE_MIGRATE_BACKUP:-pg_dump}"
backup_dir="${OPENVALENS_BACKUP_DIR:-/backups}"
retain="${OPENVALENS_BACKUP_RETAIN:-10}"
hook="${OPENVALENS_BACKUP_HOOK:-/opt/openvalens/hooks/pre-migrate}"

case "$retain" in
  '' | *[!0-9]*) fail "OPENVALENS_BACKUP_RETAIN must be a non-negative integer" ;;
esac

if [ -n "${POSTGRES_PASSWORD_FILE:-}" ]; then
  [ -r "$POSTGRES_PASSWORD_FILE" ] || fail "database password file is not readable"
  PGPASSWORD="$(cat "$POSTGRES_PASSWORD_FILE")"
  export PGPASSWORD
fi

case "$mode" in
  none)
    if [ "${OPENVALENS_ALLOW_MIGRATE_WITHOUT_BACKUP:-}" != "I_HAVE_A_BACKUP" ]; then
      fail "backups are disabled (OPENVALENS_PRE_MIGRATE_BACKUP=none) but OPENVALENS_ALLOW_MIGRATE_WITHOUT_BACKUP is not I_HAVE_A_BACKUP; refusing to migrate"
    fi
    log "WARNING: migrating WITHOUT a pre-migrate backup (explicit operator override)"
    exit 0
    ;;
  hook)
    [ -x "$hook" ] || fail "OPENVALENS_PRE_MIGRATE_BACKUP=hook but $hook is missing or not executable; refusing to migrate"
    log "running operator backup hook"
    "$hook" || fail "operator backup hook failed; refusing to migrate"
    log "operator backup hook succeeded"
    exit 0
    ;;
  pg_dump) ;;
  *) fail "unknown OPENVALENS_PRE_MIGRATE_BACKUP (expected pg_dump, hook or none); refusing to migrate" ;;
esac

# A brand-new database has nothing worth dumping: skip only when there is no
# user table in any non-system schema (this includes the Drizzle journal).
tables="$(psql -XAtq -v ON_ERROR_STOP=1 -c \
  "select count(*) from pg_catalog.pg_tables where schemaname not in ('pg_catalog', 'information_schema')")" ||
  fail "could not inspect the database; refusing to migrate"
if [ "$tables" = "0" ]; then
  log "empty database (fresh install): no backup needed"
  exit 0
fi

# The encrypted backup (database + stored files), verified before it counts:
# deploy/backup/openvalens-backup.sh. Its retention keeps the newest
# OPENVALENS_BACKUP_RETAIN pre-migrate backups.
tool="${OPENVALENS_BACKUP_TOOL:-/opt/openvalens/openvalens-backup.sh}"
[ -r "$tool" ] || fail "the backup tool is missing; refusing to migrate"
id="$(OPENVALENS_BACKUP_DIR="$backup_dir" bash "$tool" create pre-migrate)" ||
  fail "the encrypted pre-migrate backup failed; refusing to migrate"
log "encrypted backup written: $id"
