#!/bin/sh
# Pre-migrate backup hook (Issue #63). Runs in the one-shot `backup` service of
# deploy/compose.yml, after Postgres is healthy and BEFORE `migrate`. A non-zero
# exit stops the chain: migrations do not run and `server` does not start.
#
# OPENVALENS_PRE_MIGRATE_BACKUP selects the hook:
#   pg_dump (default)  plain pg_dump (custom format) into the `backups` volume,
#                      verified with `pg_restore --list` before it counts.
#   hook               run the operator's executable deploy/hooks/pre-migrate
#                      (mounted at /opt/openvalens/hooks/pre-migrate). It must
#                      exit 0 only after a backup it trusts has been written.
#   none               take no backup. Refused unless
#                      OPENVALENS_ALLOW_MIGRATE_WITHOUT_BACKUP=I_HAVE_A_BACKUP.
#
# NOT the encrypted backup/restore of Issue #64: the default dump is
# UNENCRYPTED and protected only by the Docker volume's host permissions. Treat
# the `backups` volume as health data.
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

umask 077
[ -d "$backup_dir" ] || fail "backup directory is missing"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$backup_dir/pre-migrate-$stamp.dump"
partial="$backup_dir/.partial-pre-migrate-$stamp.dump"
[ -e "$final" ] && fail "a backup named for this second already exists; retry"

log "dumping database to the backups volume"
if ! pg_dump --format=custom --no-password --file="$partial"; then
  rm -f "$partial"
  fail "pg_dump failed; refusing to migrate"
fi
if ! pg_restore --list "$partial" >/dev/null; then
  rm -f "$partial"
  fail "the dump could not be read back; refusing to migrate"
fi
mv "$partial" "$final"
chmod 0600 "$final"
log "backup written: pre-migrate-$stamp.dump ($(wc -c <"$final" | tr -d ' ') bytes)"

# Retention: keep the newest $retain pre-migrate dumps (0 keeps everything).
# The dump just written is always the newest, so it is never pruned.
if [ "$retain" -gt 0 ]; then
  # Timestamped names glob in chronological order; delete the oldest surplus.
  total=0
  for old in "$backup_dir"/pre-migrate-*.dump; do
    [ -f "$old" ] && total=$((total + 1))
  done
  surplus=$((total - retain))
  for old in "$backup_dir"/pre-migrate-*.dump; do
    [ "$surplus" -gt 0 ] || break
    [ -f "$old" ] || continue
    rm -f "$old"
    surplus=$((surplus - 1))
    log "pruned old backup $(basename "$old")"
  done
fi
