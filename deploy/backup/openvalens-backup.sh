#!/usr/bin/env bash
#
# OpenValens backup tool (Issue #64). Runs inside the `backup`,
# `backup-scheduler` and `backup-tools` services of deploy/compose.yml (the
# openvalens-backup image: pinned Postgres + age + jq). Operators never call it
# directly: use `deploy/setup.sh backup ...` and `deploy/setup.sh restore`.
#
#   create <daily|pre-migrate|manual>   take an encrypted backup (DB + files)
#   verify [<id>|latest] [--quick]      checksums, decrypt, pg_restore --list,
#                                       file checksums; without --quick also a
#                                       full restore into a scratch database
#                                       with per-table row counts compared
#   list                                backups in the volume, newest last
#   schedule                            long-running daily loop (scheduler)
#   restore-db <id> <stamp>             keep the current database and files
#                                       under a pre-restore name, restore both
#   undo-restore <stamp> <new stamp>    put the kept database and files back,
#                                       keeping the current ones under <new stamp>
#   ledger-merge                        merge the erasure ledgers of every kept
#                                       database and every backup into the
#                                       live database
#   wait-idle                           wait for a running backup or verify
#   has-backups                         exit 0 if the volume holds a backup
#   record <operation> <trigger> <outcome> [<id>] [<detail>]
#   export <id>                         write a backup as a tar to stdout
#   import <id>                         read a backup tar from stdin
#   cleanup [--force]                   list (or drop) pre-restore databases,
#                                       pre-restore files and legacy plain dumps
#   offsite-daemon                      upload finished backups off site (the
#                                       `backup-offsite` service, profile offsite)
#   offsite-upload [<id>|latest]        upload one backup off site now
#   offsite-list                        backups in the off-site bucket
#   offsite-pull [<id>|latest]          copy one off-site backup into the volume
#   offsite-sync                        record off-site results in backup_run
#
# Layout of one backup, /backups/<UTC stamp>-<trigger>/:
#   database.dump.age       pg_dump --format=custom, age-encrypted
#   files.tar.age           the local `storage` volume as a tar (local storage)
#   files.sha256.age        sha256 of every stored file (local storage)
#   erasure-ledger.csv.age  the erasure ledger at dump time
#   manifest.json.age       ids, sizes, plaintext checksums, per-table row counts
#   SHA256SUMS              sha256 of each .age file (checkable without the key)
#
# Encryption: age (https://age-encryption.org, X25519 + ChaCha20-Poly1305).
# Backups are encrypted to the public key derived from the private identity in
# deploy/secrets/backup/age-identity; that same file decrypts them. Lose it and
# every backup is unreadable: keep a copy off this server.
#
# The database dump, row counts and ledger come from ONE exported snapshot, so
# verify can compare counts exactly. Stored files are archived after the dump:
# a file uploaded in between is kept as an orphan, which is harmless.
#
# Never prints database contents, keys, passwords or connection strings.
set -euo pipefail

SELF="${BASH_SOURCE[0]}"
BACKUP_DIR="${OPENVALENS_BACKUP_DIR:-/backups}"
STORAGE_DIR="${OPENVALENS_STORAGE_DIR:-/storage}"
IDENTITY="${OPENVALENS_BACKUP_IDENTITY_FILE:-/run/backup-secrets/age-identity}"
DB="${PGDATABASE:-openvalens}"
SCRATCH_DB="${DB}_verify"
STORAGE_PROVIDER="${STORAGE_PROVIDER:-local}"
FORMAT=1
ID_PATTERN='^[0-9]{8}T[0-9]{6}Z-(daily|pre-migrate|manual)$'

log() { printf 'openvalens-backup: %s\n' "$*" >&2; }
fail() {
  printf 'openvalens-backup: ERROR: %s\n' "$*" >&2
  exit 1
}

if [ -n "${POSTGRES_PASSWORD_FILE:-}" ]; then
  [ -r "$POSTGRES_PASSWORD_FILE" ] || fail "database password file is not readable"
  PGPASSWORD="$(cat "$POSTGRES_PASSWORD_FILE")"
  export PGPASSWORD
fi
export PGDATABASE="$DB"

psql_db() { psql -XAtq -v ON_ERROR_STOP=1 --no-password "$@"; }

valid_id() { printf '%s' "$1" | grep -Eq "$ID_PATTERN"; }

# --- key -----------------------------------------------------------------------

require_key() {
  [ -s "$IDENTITY" ] ||
    fail "no backup key: deploy/secrets/backup/age-identity is missing (run deploy/setup.sh install or upgrade, or restore your escrowed copy there)"
  RECIPIENT="$(age-keygen -y "$IDENTITY" 2>/dev/null)" ||
    fail "deploy/secrets/backup/age-identity is not a valid age identity"
}

encrypt() { age --encrypt --recipient "$RECIPIENT" --output "$1"; }
decrypt() { age --decrypt --identity "$IDENTITY" "$1"; }

# --- locking -------------------------------------------------------------------

lock() {
  exec 9>"$BACKUP_DIR/.lock"
  flock -w "${1:-0}" 9 || fail "another backup, verify or restore is running; try again later"
}

# --- status rows ---------------------------------------------------------------

# record <operation> <trigger> <outcome> [backup id] [detail] [size] [started epoch]
# Best effort: before the first migration the table does not exist yet.
record() {
  local started="${7:-$(date -u +%s)}"
  psql_db -v op="$1" -v trig="$2" -v outcome="$3" -v id="${4:-}" -v detail="${5:-}" \
    -v size="${6:-}" -v started="$started" >/dev/null 2>&1 <<'SQL' || true
select to_regclass('public.backup_run') is not null as ready \gset
\if :ready
insert into backup_run (operation, trigger, outcome, backup_id, detail, size_bytes, started_at)
values (:'op', :'trig', :'outcome', nullif(:'id', ''), nullif(left(:'detail', 200), ''),
  nullif(:'size', '')::bigint, to_timestamp(:'started'::double precision));
\endif
SQL
}

clear_schedule() {
  psql_db >/dev/null 2>&1 <<'SQL' || true
select to_regclass('public.backup_schedule') is not null as ready \gset
\if :ready
delete from backup_schedule;
\endif
SQL
}

record_schedule() {
  psql_db -v next="$1" -v hour="$2" -v retain="$3" >/dev/null 2>&1 <<'SQL' || true
select to_regclass('public.backup_schedule') is not null as ready \gset
\if :ready
insert into backup_schedule (id, next_run_at, hour_utc, daily_retain, updated_at)
values ('instance', to_timestamp(:'next'::double precision), :'hour'::int, :'retain'::int, now())
on conflict (id) do update set next_run_at = excluded.next_run_at,
  hour_utc = excluded.hour_utc, daily_retain = excluded.daily_retain, updated_at = now();
delete from backup_run where finished_at < now() - interval '180 days';
\endif
SQL
}

# --- create --------------------------------------------------------------------

COUNT_SQL="select coalesce(json_object_agg(schemaname || '.' || tablename,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, tablename),
  false, true, '')))[1]::text::bigint order by schemaname, tablename), '{}')
  from pg_tables where schemaname not in ('pg_catalog', 'information_schema')"

LEDGER_COLUMNS="subject_user_id, organization_ids, row_counts, erased_at"

# Internal: run by psql's \! inside the snapshot transaction (see create).
cmd__dump() {
  local work="$1" snapshot
  require_key
  snapshot="$(cat "$work/snapshot")"
  mkfifo "$work/db.fifo"
  sha256sum <"$work/db.fifo" | cut -d' ' -f1 >"$work/db.sha256" &
  local sum_pid=$!
  if pg_dump --format=custom --no-password --snapshot="$snapshot" </dev/null | tee "$work/db.fifo" |
    encrypt "$work/out/database.dump.age"; then
    wait "$sum_pid"
    : >"$work/dump.ok"
  else
    wait "$sum_pid" || true
  fi
}

# Internal: tar --to-command helper; prints "<sha256>  <path>" for one file.
cmd__filesum() { printf '%s  %s\n' "$(sha256sum | cut -d' ' -f1)" "$TAR_FILENAME"; }

file_list_sorted() { LC_ALL=C sort -k2; }

archive_files() {
  local work="$1"
  mkfifo "$work/tar.fifo" "$work/sum.fifo"
  sha256sum <"$work/tar.fifo" | cut -d' ' -f1 >"$work/files.sha256sum" &
  local tar_sum=$!
  tar -xf "$work/sum.fifo" --to-command="/bin/bash $SELF _filesum" | file_list_sorted |
    encrypt "$work/out/files.sha256.age" &
  local list_pid=$!
  # The readiness probe object, temp uploads and kept pre-restore copies are
  # not part of the backup.
  if ! tar -C "$STORAGE_DIR" --exclude='./_system' --exclude='./.tmp' --exclude='./.pre-restore-*' \
    -cf - . | tee "$work/tar.fifo" "$work/sum.fifo" | encrypt "$work/out/files.tar.age"; then
    wait "$tar_sum" "$list_pid" || true
    return 1
  fi
  wait "$tar_sum" || return 1
  wait "$list_pid" || return 1
  FILES_COUNT="$(decrypt "$work/out/files.sha256.age" | wc -l | tr -d ' ')"
  FILES_SHA="$(cat "$work/files.sha256sum")"
  FILES_BYTES="$(du -sb --exclude=_system --exclude=.tmp --exclude='.pre-restore-*' "$STORAGE_DIR" | cut -f1)"
}

cmd_create() {
  local trigger="${1:-}"
  case "$trigger" in daily | pre-migrate | manual) ;; *) fail "create needs daily, pre-migrate or manual" ;; esac
  require_key
  [ -d "$BACKUP_DIR" ] || fail "backup directory is missing"
  lock 600
  local started id final work
  started="$(date -u +%s)"
  id="$(date -u -d "@$started" +%Y%m%dT%H%M%SZ)-$trigger"
  final="$BACKUP_DIR/$id"
  [ -e "$final" ] && fail "a backup named for this second already exists; retry"
  umask 077
  work="$(mktemp -d /tmp/openvalens-backup.XXXXXX)"
  # shellcheck disable=SC2064
  trap "rm -rf '$work' '$BACKUP_DIR/.partial-$id'" EXIT
  mkdir "$work/out"
  # An interrupted earlier run (container killed) can leave a staging dir.
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -name '.partial-*' -exec rm -rf {} +

  log "backing up the database ($id)"
  # One repeatable-read snapshot for the dump, the row counts and the ledger.
  if ! psql_db >/dev/null <<SQL; then
begin transaction isolation level repeatable read read only;
\o $work/snapshot
select pg_export_snapshot();
\o $work/counts.json
$COUNT_SQL;
\o
select to_regclass('public.erasure_ledger') is not null as has_ledger \gset
\if :has_ledger
\copy (select $LEDGER_COLUMNS from erasure_ledger order by id) to '$work/ledger.csv' csv
\else
\! : > '$work/ledger.csv'
\endif
\! /bin/bash $SELF _dump $work
commit;
SQL
    record backup "$trigger" failed "$id" "snapshot" "" "$started"
    fail "could not read the database; no backup was written"
  fi
  if [ ! -f "$work/dump.ok" ]; then
    record backup "$trigger" failed "$id" "pg_dump" "" "$started"
    fail "pg_dump failed; no backup was written"
  fi
  encrypt "$work/out/erasure-ledger.csv.age" <"$work/ledger.csv"

  FILES_PROVIDER="$STORAGE_PROVIDER"
  FILES_COUNT=0
  FILES_SHA=""
  FILES_BYTES=0
  if [ "$STORAGE_PROVIDER" = local ]; then
    [ -d "$STORAGE_DIR" ] || fail "the storage volume is not mounted"
    log "archiving stored files"
    if ! archive_files "$work"; then
      record backup "$trigger" failed "$id" "files" "" "$started"
      fail "archiving the stored files failed; no backup was written"
    fi
  else
    log "STORAGE_PROVIDER=$STORAGE_PROVIDER: stored objects live in the bucket and are not in this backup (see docs/storage.md)"
  fi

  local db_bytes
  db_bytes="$(stat -c %s "$work/out/database.dump.age")"
  jq -n --argjson format "$FORMAT" --arg id "$id" --arg trigger "$trigger" \
    --arg created "$(date -u -d "@$started" +%Y-%m-%dT%H:%M:%SZ)" \
    --arg version "${OPENVALENS_VERSION:-unknown}" \
    --arg db_sha "$(cat "$work/db.sha256")" --argjson db_bytes "$db_bytes" \
    --slurpfile tables "$work/counts.json" \
    --arg provider "$FILES_PROVIDER" --argjson files_count "$FILES_COUNT" \
    --arg files_sha "$FILES_SHA" --argjson files_bytes "$FILES_BYTES" \
    --argjson ledger "$(grep -c '' "$work/ledger.csv" || true)" \
    '{format: $format, id: $id, trigger: $trigger, created_at: $created, app_version: $version,
      database: {sha256: $db_sha, encrypted_bytes: $db_bytes, tables: $tables[0]},
      files: {provider: $provider, included: ($provider == "local"), count: $files_count,
        bytes: $files_bytes, tar_sha256: $files_sha},
      erasure_ledger: {rows: $ledger}}' | encrypt "$work/out/manifest.json.age"
  rm -f "$work/ledger.csv" "$work/counts.json"
  (cd "$work/out" && sha256sum -- *.age >SHA256SUMS)

  # Stage inside the volume, verify, then rename: a backup only counts once
  # it reads back.
  mkdir "$BACKUP_DIR/.partial-$id"
  mv "$work/out/"* "$BACKUP_DIR/.partial-$id/"
  if ! verify_dir "$BACKUP_DIR/.partial-$id" quick; then
    record backup "$trigger" failed "$id" "read-back:$VERIFY_STEP" "" "$started"
    fail "the backup could not be read back (step: $VERIFY_STEP); it was discarded"
  fi
  mv "$BACKUP_DIR/.partial-$id" "$final"
  local size
  size="$(du -sb "$final" | cut -f1)"
  record backup "$trigger" ok "$id" "" "$size" "$started"
  log "backup written: $id ($size bytes, encrypted)"
  prune "$trigger"
  printf '%s\n' "$id"
}

# prune <trigger>: keep the newest N backups of that trigger (0 keeps all).
prune() {
  local retain
  case "$1" in
    daily) retain="${OPENVALENS_BACKUP_DAILY_RETAIN:-14}" ;;
    pre-migrate) retain="${OPENVALENS_BACKUP_RETAIN:-10}" ;;
    *) return 0 ;;
  esac
  case "$retain" in '' | *[!0-9]*) fail "backup retention must be a non-negative integer" ;; esac
  [ "$retain" -gt 0 ] || return 0
  local ids surplus old
  mapfile -t ids < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name "*-$1" -printf '%f\n' | LC_ALL=C sort)
  surplus=$((${#ids[@]} - retain))
  for old in "${ids[@]}"; do
    [ "$surplus" -gt 0 ] || break
    valid_id "$old" || continue
    rm -rf "${BACKUP_DIR:?}/$old"
    surplus=$((surplus - 1))
    log "pruned old backup $old"
  done
}

# --- verify --------------------------------------------------------------------

# verify_dir <dir> <quick|full>; sets VERIFY_STEP on failure.
verify_dir() {
  local dir="$1" mode="$2" manifest want got
  VERIFY_STEP=checksum
  [ -f "$dir/SHA256SUMS" ] || { log "SHA256SUMS is missing"; return 1; }
  (cd "$dir" && sha256sum --quiet --strict -c SHA256SUMS >/dev/null 2>&1) || {
    log "checksum mismatch: the backup files are damaged or incomplete"
    return 1
  }
  VERIFY_STEP=key
  manifest="$(decrypt "$dir/manifest.json.age" 2>/dev/null)" || {
    log "cannot decrypt this backup with deploy/secrets/backup/age-identity: it was encrypted for a different key (the files themselves are intact)"
    return 1
  }
  VERIFY_STEP=manifest
  [ "$(jq -r .format <<<"$manifest")" = "$FORMAT" ] || { log "unknown backup format"; return 1; }

  VERIFY_STEP=database
  want="$(jq -r .database.sha256 <<<"$manifest")"
  got="$(decrypt "$dir/database.dump.age" | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$got" ] || { log "database dump checksum mismatch"; return 1; }
  # pg_restore --list may stop reading after the table of contents, so age
  # can get SIGPIPE: judge pg_restore alone (the checksum above covers age).
  { decrypt "$dir/database.dump.age" 2>/dev/null || true; } | pg_restore --list >/dev/null 2>&1 || {
    log "pg_restore cannot read the database dump"
    return 1
  }

  VERIFY_STEP=ledger
  want="$(jq -r .erasure_ledger.rows <<<"$manifest")"
  got="$(decrypt "$dir/erasure-ledger.csv.age" | grep -c '' || true)"
  [ "$want" = "$got" ] || { log "erasure ledger row count mismatch"; return 1; }

  if [ "$(jq -r .files.included <<<"$manifest")" = true ]; then
    VERIFY_STEP=files
    want="$(jq -r .files.tar_sha256 <<<"$manifest")"
    got="$(decrypt "$dir/files.tar.age" | sha256sum | cut -d' ' -f1)"
    [ "$want" = "$got" ] || { log "file archive checksum mismatch"; return 1; }
    want="$(decrypt "$dir/files.sha256.age" | sha256sum | cut -d' ' -f1)"
    got="$(decrypt "$dir/files.tar.age" | tar -xf - --to-command="/bin/bash $SELF _filesum" |
      file_list_sorted | sha256sum | cut -d' ' -f1)"
    [ "$want" = "$got" ] || { log "stored file checksums do not match the archive"; return 1; }
  fi

  [ "$mode" = full ] || return 0
  VERIFY_STEP=restore
  psql_db -d postgres -c "drop database if exists \"$SCRATCH_DB\" with (force)" >/dev/null 2>&1 || true
  createdb --no-password "$SCRATCH_DB" || { log "cannot create the scratch database"; return 1; }
  if ! decrypt "$dir/database.dump.age" |
    pg_restore --no-password --exit-on-error --no-owner --dbname="$SCRATCH_DB" >/dev/null 2>&1; then
    dropdb --no-password --if-exists "$SCRATCH_DB" >/dev/null 2>&1 || true
    log "the dump does not restore into a scratch database"
    return 1
  fi
  VERIFY_STEP=row-counts
  want="$(jq -cS .database.tables <<<"$manifest")"
  got="$(psql_db -d "$SCRATCH_DB" -c "$COUNT_SQL" | jq -cS .)"
  dropdb --no-password --if-exists "$SCRATCH_DB" >/dev/null 2>&1 || true
  [ "$want" = "$got" ] || { log "row counts after a scratch restore differ from the manifest"; return 1; }
  return 0
}

resolve_id() {
  local id="${1:-latest}"
  if [ "$id" = latest ]; then
    id="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' |
      grep -E "$ID_PATTERN" | LC_ALL=C sort -t- -k1,1 | tail -n 1 || true)"
    [ -n "$id" ] || fail "there are no backups yet"
  fi
  valid_id "$id" || fail "not a backup id (expected <YYYYMMDDTHHMMSSZ>-<daily|pre-migrate|manual>)"
  [ -d "$BACKUP_DIR/$id" ] || fail "no such backup"
  printf '%s' "$id"
}

cmd_verify() {
  local id="" mode=full trigger="${OPENVALENS_BACKUP_TRIGGER:-manual}" started
  while [ $# -gt 0 ]; do
    case "$1" in
      --quick) mode=quick ;;
      *) id="$1" ;;
    esac
    shift
  done
  require_key
  id="$(resolve_id "${id:-latest}")"
  lock 600
  started="$(date -u +%s)"
  log "verifying $id ($mode)"
  if verify_dir "$BACKUP_DIR/$id" "$mode"; then
    record verify "$trigger" ok "$id" "$mode" "" "$started"
    log "verify passed: $id"
  else
    record verify "$trigger" failed "$id" "$VERIFY_STEP" "" "$started"
    fail "verify FAILED for $id (step: $VERIFY_STEP)"
  fi
}

# --- list ----------------------------------------------------------------------

cmd_list() {
  local found=0 id size
  while IFS= read -r id; do
    valid_id "$id" || continue
    found=1
    size="$(du -sh "$BACKUP_DIR/$id" | cut -f1)"
    printf '%s\t%s\tencrypted\n' "$id" "$size"
  done < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | LC_ALL=C sort -t- -k1,1)
  while IFS= read -r id; do
    found=1
    size="$(du -sh "$BACKUP_DIR/$id" | cut -f1)"
    printf '%s\t%s\tLEGACY UNENCRYPTED (delete with: deploy/setup.sh backup cleanup --force)\n' "$id" "$size"
  done < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type f -name '*.dump' -printf '%f\n' | LC_ALL=C sort)
  [ "$found" -eq 1 ] || log "no backups yet"
}

# --- schedule ------------------------------------------------------------------

latest_epoch() {
  local id stamp
  id="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' |
    grep -E "$ID_PATTERN" | LC_ALL=C sort -t- -k1,1 | tail -n 1 || true)"
  [ -n "$id" ] || { echo 0; return; }
  stamp="${id%%-*}"
  date -u -d "${stamp:0:4}-${stamp:4:2}-${stamp:6:2} ${stamp:9:2}:${stamp:11:2}:${stamp:13:2}" +%s
}

run_cycle() {
  local id
  if id="$(bash "$SELF" create daily)"; then
    OPENVALENS_BACKUP_TRIGGER=daily bash "$SELF" verify "$id" || log "scheduled verify failed"
  else
    log "scheduled backup failed"
  fi
}

cmd_schedule() {
  local hour="${OPENVALENS_BACKUP_HOUR:-3}" retain="${OPENVALENS_BACKUP_DAILY_RETAIN:-14}" now next
  case "$hour" in '' | *[!0-9]*) fail "OPENVALENS_BACKUP_HOUR must be an hour 0-23 (UTC)" ;; esac
  [ "$hour" -le 23 ] || fail "OPENVALENS_BACKUP_HOUR must be an hour 0-23 (UTC)"
  case "$retain" in '' | *[!0-9]*) fail "OPENVALENS_BACKUP_DAILY_RETAIN must be a non-negative integer" ;; esac
  require_key
  trap 'log "scheduler stopping"; exit 0' TERM INT
  case "${OPENVALENS_BACKUP_SCHEDULE:-on}" in
    on) ;;
    off)
      # Backups are the operator's own (a hook, snapshots): no daily backup,
      # and no schedule row, so readiness never reports them stale.
      clear_schedule
      log "OPENVALENS_BACKUP_SCHEDULE=off: no daily backups; only off-site results are recorded"
      while :; do
        offsite_sync
        sleep 60 &
        wait $! || true
      done
      ;;
    *) fail "OPENVALENS_BACKUP_SCHEDULE must be on or off" ;;
  esac
  log "daily encrypted backups at $(printf '%02d' "$hour"):00 UTC, keeping $retain"
  while :; do
    now="$(date -u +%s)"
    # Catch up when the last backup is more than a day old (fresh install,
    # host was off at the scheduled hour).
    if [ $((now - $(latest_epoch))) -gt 86400 ]; then
      log "no backup in the last 24 hours: taking one now"
      run_cycle
      now="$(date -u +%s)"
    fi
    next="$(date -u -d "today $hour:00" +%s)"
    [ "$next" -gt "$now" ] || next="$(date -u -d "tomorrow $hour:00" +%s)"
    record_schedule "$next" "$hour" "$retain"
    # Wake every minute to record off-site upload results (Issue #64).
    while [ "$now" -lt "$next" ]; do
      offsite_sync
      sleep $(((next - now) < 60 ? (next - now) : 60)) &
      wait $! || true
      now="$(date -u +%s)"
    done
    run_cycle
    offsite_sync
  done
}

# --- off-site copy (Issue #64) ------------------------------------------------
#
# Optional. The `backup-offsite` service (compose profile `offsite`) is the only
# backup service with internet access, and it has neither the database password
# nor the age key: it copies finished, verified backup directories (ciphertext
# and SHA256SUMS only) to an S3-compatible bucket with rclone, applies the same
# retention there, and drops one result file per upload into
# /backups/.offsite/events. The scheduler (database access, no internet) turns
# those into `backup_run` rows, so readiness and /admin/settings show them.

OFFSITE_DIR="$BACKUP_DIR/.offsite"
OFFSITE_RETRY_SECONDS="${OPENVALENS_OFFSITE_RETRY_SECONDS:-900}"

# Configures rclone's `offsite:` remote from the environment and two secret
# files. Never prints a key.
offsite_env() {
  OFFSITE_BUCKET="${BACKUP_OFFSITE_S3_BUCKET:-}"
  [ -n "$OFFSITE_BUCKET" ] || fail "off-site copy is not configured (BACKUP_OFFSITE_S3_BUCKET is empty)"
  printf '%s' "$OFFSITE_BUCKET" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$' ||
    fail "BACKUP_OFFSITE_S3_BUCKET is not a valid bucket name"
  OFFSITE_PREFIX="${BACKUP_OFFSITE_S3_PREFIX:-openvalens}"
  OFFSITE_PREFIX="${OFFSITE_PREFIX#/}"
  OFFSITE_PREFIX="${OFFSITE_PREFIX%/}"
  printf '%s' "$OFFSITE_PREFIX" | grep -Eq '^[A-Za-z0-9._/-]*$' ||
    fail "BACKUP_OFFSITE_S3_PREFIX may contain letters, digits, '.', '_', '-' and '/' only"
  local id_file="${BACKUP_OFFSITE_S3_ACCESS_KEY_ID_FILE:-/run/offsite-secrets/access-key-id}"
  local secret_file="${BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY_FILE:-/run/offsite-secrets/secret-access-key}"
  [ -s "$id_file" ] && [ -s "$secret_file" ] ||
    fail "off-site credentials missing: deploy/secrets/backup/BACKUP_OFFSITE_S3_ACCESS_KEY_ID and ..._SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_OFFSITE_TYPE=s3
  if [ -n "${BACKUP_OFFSITE_S3_ENDPOINT:-}" ]; then
    export RCLONE_CONFIG_OFFSITE_PROVIDER=Other
    export RCLONE_CONFIG_OFFSITE_ENDPOINT="$BACKUP_OFFSITE_S3_ENDPOINT"
  else
    export RCLONE_CONFIG_OFFSITE_PROVIDER=AWS
  fi
  export RCLONE_CONFIG_OFFSITE_REGION="${BACKUP_OFFSITE_S3_REGION:-us-east-1}"
  case "${BACKUP_OFFSITE_S3_FORCE_PATH_STYLE:-false}" in
    true) export RCLONE_CONFIG_OFFSITE_FORCE_PATH_STYLE=true ;;
    false) export RCLONE_CONFIG_OFFSITE_FORCE_PATH_STYLE=false ;;
    *) fail "BACKUP_OFFSITE_S3_FORCE_PATH_STYLE must be true or false" ;;
  esac
  export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID
  RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="$(head -n 1 "$id_file")"
  export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY
  RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="$(head -n 1 "$secret_file")"
  # The bucket must exist; the key needs no permission to create buckets.
  export RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true
  export RCLONE_CONFIG_DIR=/tmp RCLONE_CONFIG=/dev/null
  # Each host uploads into its own folder (OPENVALENS_BACKUP_HOST_ID, written
  # once into deploy/.env by setup.sh), and retention only ever prunes that
  # folder: a new host never deletes the old host's backups. Pull searches all.
  OFFSITE_HOST="${OPENVALENS_BACKUP_HOST_ID:-}"
  printf '%s' "$OFFSITE_HOST" | grep -Eq '^[A-Za-z0-9-]{8,64}$' ||
    fail "OPENVALENS_BACKUP_HOST_ID is missing or invalid (run deploy/setup.sh install)"
  OFFSITE_ALL="offsite:$OFFSITE_BUCKET${OFFSITE_PREFIX:+/$OFFSITE_PREFIX}"
  OFFSITE_ROOT="$OFFSITE_ALL/$OFFSITE_HOST"
  mkdir -p "$OFFSITE_DIR/events"
}

# rclone with its output kept to a short, value-free tail on failure.
rc() {
  local out
  if ! out="$(rclone --retries 3 --low-level-retries 3 --contimeout 30s --timeout 5m "$@" 2>&1)"; then
    printf '%s\n' "$out" | grep -vi 'secret\|access.key' | tail -n 2 | sed 's/^/  rclone: /' >&2
    return 1
  fi
  [ -z "$out" ] || printf '%s\n' "$out"
}

offsite_event() { : >"$OFFSITE_DIR/events/$(date -u +%s)_${1}_${2}_${3:-}"; }

offsite_ids() {
  rc lsf --dirs-only "$OFFSITE_ROOT/" | sed 's#/$##' | grep -E "$ID_PATTERN" | LC_ALL=C sort -t- -k1,1 || true
}

# offsite_upload_one <id>: data files first, SHA256SUMS last (a remote backup
# without SHA256SUMS is incomplete and never pulled), then a size + hash check.
offsite_upload_one() {
  local id="$1" dir="$BACKUP_DIR/$1" step
  step=upload
  if rc copy "$dir" "$OFFSITE_ROOT/$id" --exclude SHA256SUMS >/dev/null &&
    rc copyto "$dir/SHA256SUMS" "$OFFSITE_ROOT/$id/SHA256SUMS" >/dev/null; then
    step=check
    if rc check --one-way "$dir" "$OFFSITE_ROOT/$id" >/dev/null; then
      rm -f "$OFFSITE_DIR/$id.failed"
      : >"$OFFSITE_DIR/$id.done"
      offsite_event "$id" ok ""
      log "off-site copy written: $id"
      offsite_prune
      return 0
    fi
  fi
  : >"$OFFSITE_DIR/$id.failed"
  offsite_event "$id" failed "$step"
  log "off-site copy FAILED for $id (step: $step); retrying in $((OFFSITE_RETRY_SECONDS / 60)) minutes"
  return 1
}

# Same retention as the local volume: daily and pre-migrate backups are pruned
# per trigger, manual backups are kept.
offsite_prune() {
  local trigger retain ids surplus old
  for trigger in daily pre-migrate; do
    if [ "$trigger" = daily ]; then retain="${OPENVALENS_BACKUP_DAILY_RETAIN:-14}"; else retain="${OPENVALENS_BACKUP_RETAIN:-10}"; fi
    [ "$retain" -gt 0 ] 2>/dev/null || continue
    mapfile -t ids < <(offsite_ids | grep -- "-$trigger\$" || true)
    surplus=$((${#ids[@]} - retain))
    for old in "${ids[@]}"; do
      [ "$surplus" -gt 0 ] || break
      valid_id "$old" || continue
      if rc purge "$OFFSITE_ROOT/$old" >/dev/null; then log "pruned off-site copy $old"; fi
      surplus=$((surplus - 1))
    done
  done
}

offsite_lock() {
  exec 8>"$OFFSITE_DIR/.lock"
  flock -w 3600 8 || fail "another off-site upload is running"
}

# One pass: upload every finished local backup without an off-site copy.
offsite_pass() {
  local id now
  offsite_lock
  now="$(date -u +%s)"
  while IFS= read -r id; do
    valid_id "$id" || continue
    [ -f "$OFFSITE_DIR/$id.done" ] && continue
    if [ -f "$OFFSITE_DIR/$id.failed" ] &&
      [ $((now - $(stat -c %Y "$OFFSITE_DIR/$id.failed"))) -lt "$OFFSITE_RETRY_SECONDS" ]; then
      continue
    fi
    offsite_upload_one "$id" || true
  done < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | LC_ALL=C sort -t- -k1,1)
  # Forget markers of backups that local retention removed.
  for marker in "$OFFSITE_DIR"/*.done "$OFFSITE_DIR"/*.failed; do
    [ -e "$marker" ] || continue
    id="$(basename "$marker")"
    id="${id%.*}"
    [ -d "$BACKUP_DIR/$id" ] || rm -f "$marker"
  done
  flock -u 8
}

cmd_offsite_daemon() {
  local poll="${OPENVALENS_OFFSITE_POLL_SECONDS:-30}"
  offsite_env
  trap 'log "off-site uploader stopping"; exit 0' TERM INT
  log "off-site copy enabled: uploading encrypted backups (prefix '${OFFSITE_PREFIX}'), checking every ${poll}s"
  while :; do
    offsite_pass
    sleep "$poll" &
    wait $! || true
  done
}

cmd_offsite_upload() {
  local id
  id="$(resolve_id "${1:-latest}")"
  offsite_env
  offsite_lock
  offsite_upload_one "$id"
}

# Every "<host>/<backup id>" in the bucket, oldest first by backup id.
offsite_all_ids() {
  rc lsf -R --dirs-only --max-depth 2 "$OFFSITE_ALL/" | sed 's#/$##' |
    awk -F/ 'NF == 2' | while IFS=/ read -r host id; do
      printf '%s' "$id" | grep -Eq "$ID_PATTERN" && printf '%s/%s\n' "$host" "$id"
    done | LC_ALL=C sort -t/ -k2,2 || true
}

cmd_offsite_list() {
  local entry complete mine
  offsite_env
  rc lsf "$OFFSITE_ALL/" >/dev/null || fail "cannot list the off-site bucket"
  while IFS= read -r entry; do
    complete=complete
    rc lsf "$OFFSITE_ALL/$entry/SHA256SUMS" | grep -q . || complete="INCOMPLETE (no SHA256SUMS)"
    mine=""
    [ "${entry%%/*}" = "$OFFSITE_HOST" ] && mine=" (this host)"
    printf '%s\t%s\t%s%s\n' "${entry#*/}" "$complete" "host ${entry%%/*}" "$mine"
  done < <(offsite_all_ids)
}

# offsite-pull <id|latest>: copy one backup (still encrypted) into the volume
# and check every file against its SHA256SUMS. Marked as already off site.
cmd_offsite_pull() {
  local id="${1:-latest}" tmp
  offsite_env
  local entry
  if [ "$id" = latest ]; then
    entry="$(offsite_all_ids | tail -n 1)"
  else
    valid_id "$id" || fail "not a backup id"
    entry="$(offsite_all_ids | grep -- "/$id\$" | tail -n 1)"
  fi
  [ -n "$entry" ] || fail "no such off-site backup"
  id="${entry#*/}"
  [ ! -e "$BACKUP_DIR/$id" ] || fail "backup $id is already in the backups volume"
  rc lsf "$OFFSITE_ALL/$entry/SHA256SUMS" | grep -q . ||
    fail "off-site backup $id is incomplete (no SHA256SUMS)"
  umask 077
  tmp="$BACKUP_DIR/.pull-$id"
  rm -rf "$tmp"
  mkdir -p "$tmp/$id"
  rc copy "$OFFSITE_ALL/$entry" "$tmp/$id" >/dev/null || { rm -rf "$tmp"; fail "downloading $id failed"; }
  (cd "$tmp/$id" && sha256sum --quiet --strict -c SHA256SUMS >/dev/null 2>&1) ||
    { rm -rf "$tmp"; fail "checksum mismatch: the off-site copy of $id is damaged or incomplete"; }
  chmod -R go-rwx "$tmp/$id"
  mv "$tmp/$id" "$BACKUP_DIR/$id"
  rm -rf "$tmp"
  : >"$OFFSITE_DIR/$id.done"
  log "pulled $id from off site; run deploy/setup.sh backup verify $id"
  printf '%s\n' "$id"
}

# Scheduler side (database access): record upload results, then delete them.
offsite_sync() {
  local events="$OFFSITE_DIR/events" file name epoch rest id outcome step
  [ -d "$events" ] || return 0
  for file in "$events"/*; do
    [ -f "$file" ] || continue
    name="$(basename "$file")"
    epoch="${name%%_*}"
    rest="${name#*_}"
    id="${rest%%_*}"
    rest="${rest#*_}"
    outcome="${rest%%_*}"
    step="${rest#*_}"
    if valid_id "$id" && { [ "$outcome" = ok ] || [ "$outcome" = failed ]; }; then
      record offsite "${id#*-}" "$outcome" "$id" "$step" "" "$epoch"
    fi
    rm -f "$file"
  done
}

# --- restore -------------------------------------------------------------------

kept_db() { printf '%s_pre_restore_%s' "$DB" "$1"; }

valid_stamp() { printf '%s' "$1" | grep -Eq '^[0-9]{14}$' || fail "not a restore stamp (expected 14 digits)"; }

db_exists() {
  [ "$(psql_db -d postgres -v name="$1" <<<"select count(*) from pg_database where datname = :'name';")" = 1 ]
}

rename_db() { psql_db -d postgres -c "alter database \"$1\" rename to \"$2\"" >/dev/null; }

terminate_db() {
  psql_db -d postgres -v db="$1" >/dev/null <<'SQL'
select count(pg_terminate_backend(pid)) from pg_stat_activity where datname = :'db' and pid <> pg_backend_pid();
SQL
}

# Every database a restore or an undo kept (openvalens_pre_restore_<stamp>).
kept_dbs() {
  psql_db -d postgres -v pat="${DB}_pre_restore_%" <<<"select datname from pg_database where datname like :'pat' order by 1;"
}

# Moves the current stored files (except kept copies) into .pre-restore-<stamp>.
keep_files() {
  local keep="$STORAGE_DIR/.pre-restore-$1"
  mkdir -m 0700 "$keep"
  find "$STORAGE_DIR" -mindepth 1 -maxdepth 1 ! -name '.pre-restore-*' -exec mv -t "$keep" {} +
}

# Puts .pre-restore-<stamp> back, discarding the current files (a failed restore).
swap_back_files() {
  local keep="$STORAGE_DIR/.pre-restore-$1"
  [ -d "$keep" ] || return 0
  find "$STORAGE_DIR" -mindepth 1 -maxdepth 1 ! -name '.pre-restore-*' -exec rm -rf {} +
  find "$keep" -mindepth 1 -maxdepth 1 -exec mv -t "$STORAGE_DIR" {} +
  rmdir "$keep"
}

# Rollback state of a running restore-db. The EXIT trap puts the previous
# database and files back on ANY failure (including `set -e` exits), says
# exactly what it could and could not put back, and records the failure.
RB_ID=""
RB_STAMP=""
RB_KEPT=""
RB_STEP=""
RB_STARTED=""
RB_DB_MOVED=0
RB_FILES_MOVED=0
RB_DONE=0

restore_rollback() {
  local status=$? db_back=untouched files_back=untouched
  [ "$RB_DONE" -eq 0 ] || return 0
  trap - EXIT
  set +e
  if [ "$RB_DB_MOVED" -eq 1 ]; then
    db_back=no
    if db_exists "$RB_KEPT"; then
      terminate_db "$DB"
      psql_db -d postgres -c "drop database if exists \"$DB\" with (force)" >/dev/null 2>&1 &&
        rename_db "$RB_KEPT" "$DB" && db_back=yes
    fi
  fi
  if [ "$RB_FILES_MOVED" -eq 1 ]; then
    files_back=no
    swap_back_files "$RB_STAMP" && files_back=yes
  fi
  if [ "$db_back" != no ] && [ "$files_back" != no ]; then
    record restore manual failed "$RB_ID" "$RB_STEP" "" "$RB_STARTED"
    log "RESTORE FAILED at step '$RB_STEP' (stamp $RB_STAMP); rolled back: database $db_back, stored files $files_back"
    exit 2
  fi
  log "RESTORE FAILED at step '$RB_STEP' (stamp $RB_STAMP) and the ROLLBACK IS INCOMPLETE:"
  log "  database put back: $db_back (the previous one is $RB_KEPT if it still exists)"
  log "  stored files put back: $files_back (the previous ones are in .pre-restore-$RB_STAMP in the storage volume)"
  exit 3
  # shellcheck disable=SC2317
  return "$status"
}

cmd_restore_db() {
  local id stamp kept manifest
  id="$(resolve_id "${1:-}")"
  stamp="${2:-}"
  valid_stamp "$stamp"
  require_key
  lock 0
  kept="$(kept_db "$stamp")"
  db_exists "$kept" && fail "a kept database for this stamp already exists"
  manifest="$(decrypt "$BACKUP_DIR/$id/manifest.json.age" 2>/dev/null)" ||
    fail "cannot decrypt this backup with deploy/secrets/backup/age-identity"

  RB_ID="$id" RB_STAMP="$stamp" RB_KEPT="$kept" RB_STARTED="$(date -u +%s)"
  trap restore_rollback EXIT
  RB_STEP=keep-database
  log "keeping the current database as $kept"
  terminate_db "$DB"
  if db_exists "$DB"; then
    rename_db "$DB" "$kept"
    RB_DB_MOVED=1
  fi
  RB_STEP=createdb
  createdb --no-password "$DB"
  RB_STEP=pg_restore
  log "restoring the database from $id"
  decrypt "$BACKUP_DIR/$id/database.dump.age" |
    pg_restore --no-password --exit-on-error --no-owner --dbname="$DB" >/dev/null ||
    fail "pg_restore failed"

  if [ "$(jq -r .files.included <<<"$manifest")" = true ]; then
    RB_STEP=keep-files
    [ -d "$STORAGE_DIR" ] || fail "the storage volume is not mounted"
    log "keeping the current stored files under .pre-restore-$stamp in the storage volume"
    RB_FILES_MOVED=1
    keep_files "$stamp"
    RB_STEP=files
    log "restoring stored files"
    local sums
    sums="$(decrypt "$BACKUP_DIR/$id/files.sha256.age")" || fail "the file checksums cannot be read"
    decrypt "$BACKUP_DIR/$id/files.tar.age" | tar -C "$STORAGE_DIR" --same-owner -xpf - ||
      fail "the stored files cannot be extracted"
    if [ -n "$sums" ]; then
      (cd "$STORAGE_DIR" && sha256sum --quiet --strict -c - <<<"$sums" >/dev/null 2>&1) ||
        fail "the restored files do not match their checksums"
    fi
  else
    log "this backup holds no stored files (STORAGE_PROVIDER was $(jq -r .files.provider <<<"$manifest")); the storage volume is unchanged"
  fi
  RB_DONE=1
  trap - EXIT
  log "restored $id; previous database kept as $kept"
}

# undo-restore <stamp> <new stamp>: the database and files a restore kept
# become live again; the current ones are KEPT (never dropped) as
# openvalens_pre_restore_<new stamp> and .pre-restore-<new stamp>, so an undo
# can itself be undone. setup.sh then migrates, merges every kept ledger and
# replays it, so nobody erased after the restore comes back.
cmd_undo_restore() {
  local stamp="${1:-}" new="${2:-}" kept newkept
  valid_stamp "$stamp"
  valid_stamp "$new"
  lock 0
  kept="$(kept_db "$stamp")"
  newkept="$(kept_db "$new")"
  db_exists "$kept" || fail "no kept database for stamp $stamp"
  db_exists "$newkept" && fail "a kept database for stamp $new already exists"
  terminate_db "$DB"
  if db_exists "$DB"; then rename_db "$DB" "$newkept"; fi
  if ! rename_db "$kept" "$DB"; then
    db_exists "$newkept" && rename_db "$newkept" "$DB"
    fail "could not bring back $kept; nothing was changed"
  fi
  if [ -d "$STORAGE_DIR/.pre-restore-$stamp" ]; then
    keep_files "$new"
    find "$STORAGE_DIR/.pre-restore-$stamp" -mindepth 1 -maxdepth 1 -exec mv -t "$STORAGE_DIR" {} +
    rmdir "$STORAGE_DIR/.pre-restore-$stamp"
  fi
  log "the database and stored files from before restore $stamp are back"
  log "the ones they replaced are kept as $newkept and .pre-restore-$new (undo again with stamp $new)"
}

# Merges into the live database the erasure ledgers of EVERY database a restore
# or undo kept (a restore that halted and was re-run leaves more than one) and
# of every backup in the volume, then carries their backup history over.
cmd_ledger_merge() {
  local dir n kept
  require_key
  {
    echo "create temp table incoming (subject_user_id text, organization_ids jsonb, row_counts jsonb, erased_at timestamptz);"
    echo "\\copy incoming from stdin csv"
    while IFS= read -r kept; do
      [ -n "$kept" ] || continue
      if [ "$(psql_db -d "$kept" -c "select to_regclass('public.erasure_ledger') is not null")" = t ]; then
        psql_db -d "$kept" -c "\\copy (select $LEDGER_COLUMNS from erasure_ledger) to stdout csv"
      fi
    done < <(kept_dbs)
    for dir in "$BACKUP_DIR"/*/; do
      dir="${dir%/}"
      valid_id "$(basename "$dir")" || continue
      [ -f "$dir/erasure-ledger.csv.age" ] || continue
      decrypt "$dir/erasure-ledger.csv.age" 2>/dev/null ||
        log "skipped the ledger of $(basename "$dir"): it cannot be decrypted with this key"
    done
    echo '\.'
    echo "insert into erasure_ledger ($LEDGER_COLUMNS)
      select distinct on (subject_user_id, erased_at) $LEDGER_COLUMNS from incoming i
      where not exists (select 1 from erasure_ledger e
        where e.subject_user_id = i.subject_user_id and e.erased_at = i.erased_at)
      order by subject_user_id, erased_at;"
    echo "select count(*) from erasure_ledger;"
  } | psql_db -d "$DB" >"/tmp/ledger-merge.$$" || fail "merging the erasure ledger failed"
  n="$(tail -n 1 "/tmp/ledger-merge.$$")"
  rm -f "/tmp/ledger-merge.$$"
  log "erasure ledger merged from $(kept_dbs | grep -c . || true) kept database(s) and the backups: $n erasures recorded"

  # Keep the backup history (shown in readiness and /admin/settings) across
  # the restore. Best effort: it is status, not data.
  while IFS= read -r kept; do
    [ -n "$kept" ] || continue
    [ "$(psql_db -d "$kept" -c "select to_regclass('public.backup_run') is not null")" = t ] || continue
    {
      echo "create temp table runs (operation text, trigger text, outcome text, backup_id text, size_bytes bigint, detail text, started_at timestamptz, finished_at timestamptz);"
      echo "\\copy runs from stdin csv"
      psql_db -d "$kept" -c "\\copy (select $RUN_COLUMNS from backup_run) to stdout csv"
      echo '\.'
      echo "insert into backup_run ($RUN_COLUMNS) select $RUN_COLUMNS from runs r
        where not exists (select 1 from backup_run b where b.operation = r.operation
          and b.started_at = r.started_at and b.backup_id is not distinct from r.backup_id);"
    } | psql_db -d "$DB" >/dev/null 2>&1 || log "could not carry the backup history of $kept over (status only)"
  done < <(kept_dbs)
}

# Waits until no backup, verify or restore holds the lock (upgrade/restore call
# it before stopping the scheduler, so a running verify is never cut short).
cmd_wait_idle() {
  exec 9>"$BACKUP_DIR/.lock"
  if ! flock -n 9; then
    log "a backup or verify is running; waiting for it to finish (up to 30 minutes)"
    flock -w 1800 9 || fail "a backup or verify is still running after 30 minutes"
  fi
}

# Exit 0 when the volume holds at least one encrypted backup.
cmd_has_backups() {
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | grep -Eq "$ID_PATTERN"
}

RUN_COLUMNS="operation, trigger, outcome, backup_id, size_bytes, detail, started_at, finished_at"

# --- transfer ------------------------------------------------------------------

cmd_export() {
  local id
  id="$(resolve_id "${1:-}")"
  [ ! -t 1 ] || fail "export writes a tar to stdout; redirect it"
  tar -C "$BACKUP_DIR" -cf - "$id"
}

cmd_import() {
  local id="${1:-}" tmp
  valid_id "$id" || fail "not a backup id"
  [ ! -e "$BACKUP_DIR/$id" ] || fail "a backup with this id already exists"
  tmp="$BACKUP_DIR/.import-$id"
  rm -rf "$tmp"
  mkdir -m 0700 "$tmp"
  # Archives made on macOS carry extended headers (and AppleDouble ._ files): skip both.
  tar -C "$tmp" --no-same-owner --no-same-permissions --warning=no-unknown-keyword \
    --exclude="._*" -xf - || { rm -rf "$tmp"; fail "could not read the backup"; }
  [ -d "$tmp/$id" ] || { rm -rf "$tmp"; fail "the archive does not contain backup $id"; }
  (cd "$tmp/$id" && sha256sum --quiet --strict -c SHA256SUMS >/dev/null 2>&1) ||
    { rm -rf "$tmp"; fail "checksum mismatch: the copy is damaged or incomplete"; }
  chmod -R go-rwx "$tmp/$id"
  mv "$tmp/$id" "$BACKUP_DIR/$id"
  rm -rf "$tmp"
  log "imported $id; run deploy/setup.sh backup verify $id"
}

# --- cleanup -------------------------------------------------------------------

cmd_cleanup() {
  local force=0 name
  [ "${1:-}" = --force ] && force=1
  local dbs dirs dumps
  dbs="$(psql_db -d postgres -v pat="${DB}_pre_restore_%" <<<"select datname from pg_database where datname like :'pat' order by 1;")"
  dirs="$(find "$STORAGE_DIR" -mindepth 1 -maxdepth 1 -type d -name '.pre-restore-*' -printf '%f\n' 2>/dev/null | sort || true)"
  dumps="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type f -name '*.dump' -printf '%f\n' | sort || true)"
  if [ -z "$dbs$dirs$dumps" ]; then
    log "nothing to clean up"
    return 0
  fi
  for name in $dbs; do printf 'database kept by a restore: %s\n' "$name"; done
  for name in $dirs; do printf 'stored files kept by a restore: %s\n' "$name"; done
  for name in $dumps; do printf 'legacy UNENCRYPTED dump: %s\n' "$name"; done
  if [ "$force" -eq 0 ]; then
    log "re-run with --force to delete all of the above permanently"
    return 0
  fi
  for name in $dbs; do psql_db -d postgres -c "drop database \"$name\" with (force)" >/dev/null; done
  for name in $dirs; do rm -rf "${STORAGE_DIR:?}/$name"; done
  for name in $dumps; do rm -f "${BACKUP_DIR:?}/$name"; done
  log "deleted"
}

command="${1:-}"
[ $# -gt 0 ] && shift
case "$command" in
  create) cmd_create "$@" ;;
  verify) cmd_verify "$@" ;;
  list) cmd_list ;;
  schedule) cmd_schedule ;;
  restore-db) cmd_restore_db "$@" ;;
  undo-restore) cmd_undo_restore "$@" ;;
  ledger-merge) cmd_ledger_merge ;;
  wait-idle) cmd_wait_idle ;;
  has-backups) cmd_has_backups ;;
  record) record "$@" ;;
  export) cmd_export "$@" ;;
  import) cmd_import "$@" ;;
  cleanup) cmd_cleanup "$@" ;;
  offsite-daemon) cmd_offsite_daemon ;;
  offsite-upload) cmd_offsite_upload "$@" ;;
  offsite-list) cmd_offsite_list ;;
  offsite-pull) cmd_offsite_pull "$@" ;;
  offsite-sync) mkdir -p "$OFFSITE_DIR/events" && offsite_sync ;;
  _dump) cmd__dump "$@" ;;
  _filesum) cmd__filesum ;;
  *) fail "unknown command (see deploy/setup.sh backup --help)" ;;
esac
