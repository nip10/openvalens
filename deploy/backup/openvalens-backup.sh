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
#   undo-restore <stamp>                put the kept database and files back
#   ledger-merge <stamp>                merge the erasure ledgers of the kept
#                                       database and every backup into the
#                                       restored database
#   record <operation> <trigger> <outcome> [<id>] [<detail>]
#   export <id>                         write a backup as a tar to stdout
#   import <id>                         read a backup tar from stdin
#   cleanup [--force]                   list (or drop) pre-restore databases,
#                                       pre-restore files and legacy plain dumps
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
    sleep $((next - now)) &
    wait $! || true
    run_cycle
  done
}

# --- restore -------------------------------------------------------------------

kept_db() { printf '%s_pre_restore_%s' "$DB" "$1"; }

valid_stamp() { printf '%s' "$1" | grep -Eq '^[0-9]{14}$' || fail "not a restore stamp (expected 14 digits)"; }

db_exists() {
  [ "$(psql_db -d postgres -v name="$1" <<<"select count(*) from pg_database where datname = :'name';")" = 1 ]
}

swap_back_db() {
  local kept="$1"
  psql_db -d postgres -c "drop database if exists \"$DB\" with (force)" >/dev/null
  psql_db -d postgres -c "alter database \"$kept\" rename to \"$DB\"" >/dev/null
}

swap_back_files() {
  local keep="$STORAGE_DIR/.pre-restore-$1"
  [ -d "$keep" ] || return 0
  find "$STORAGE_DIR" -mindepth 1 -maxdepth 1 ! -name '.pre-restore-*' -exec rm -rf {} +
  find "$keep" -mindepth 1 -maxdepth 1 -exec mv -t "$STORAGE_DIR" {} +
  rmdir "$keep"
}

cmd_restore_db() {
  local id stamp kept manifest started
  id="$(resolve_id "${1:-}")"
  stamp="${2:-}"
  valid_stamp "$stamp"
  require_key
  lock 0
  started="$(date -u +%s)"
  kept="$(kept_db "$stamp")"
  db_exists "$kept" && fail "a kept database for this stamp already exists"
  manifest="$(decrypt "$BACKUP_DIR/$id/manifest.json.age" 2>/dev/null)" ||
    fail "cannot decrypt this backup with deploy/secrets/backup/age-identity"

  log "keeping the current database as $kept"
  psql_db -d postgres -v db="$DB" >/dev/null <<'SQL'
select count(pg_terminate_backend(pid)) from pg_stat_activity where datname = :'db' and pid <> pg_backend_pid();
SQL
  if db_exists "$DB"; then
    psql_db -d postgres -c "alter database \"$DB\" rename to \"$kept\"" >/dev/null
  fi
  createdb --no-password "$DB"
  log "restoring the database from $id"
  if ! decrypt "$BACKUP_DIR/$id/database.dump.age" |
    pg_restore --no-password --exit-on-error --no-owner --dbname="$DB" >/dev/null; then
    if db_exists "$kept"; then swap_back_db "$kept"; fi
    record restore manual failed "$id" "pg_restore" "" "$started"
    fail "pg_restore failed; the previous database was put back"
  fi

  if [ "$(jq -r .files.included <<<"$manifest")" = true ]; then
    [ -d "$STORAGE_DIR" ] || fail "the storage volume is not mounted"
    local keep="$STORAGE_DIR/.pre-restore-$stamp"
    log "keeping the current stored files under .pre-restore-$stamp in the storage volume"
    mkdir -m 0700 "$keep"
    find "$STORAGE_DIR" -mindepth 1 -maxdepth 1 ! -name '.pre-restore-*' -exec mv -t "$keep" {} +
    log "restoring stored files"
    local sums
    sums="$(decrypt "$BACKUP_DIR/$id/files.sha256.age")" || sums="unreadable"
    if [ "$sums" = unreadable ] ||
      ! decrypt "$BACKUP_DIR/$id/files.tar.age" | tar -C "$STORAGE_DIR" --same-owner -xpf - ||
      { [ -n "$sums" ] && ! (cd "$STORAGE_DIR" && sha256sum --quiet --strict -c - <<<"$sums" >/dev/null 2>&1); }; then
      swap_back_files "$stamp"
      if db_exists "$kept"; then swap_back_db "$kept"; fi
      record restore manual failed "$id" "files" "" "$started"
      fail "restoring the stored files failed; the previous database and files were put back"
    fi
  else
    log "this backup holds no stored files (STORAGE_PROVIDER was $(jq -r .files.provider <<<"$manifest")); the storage volume is unchanged"
  fi
  log "restored $id; previous database kept as $kept"
}

cmd_undo_restore() {
  local stamp="${1:-}" kept
  valid_stamp "$stamp"
  lock 0
  kept="$(kept_db "$stamp")"
  db_exists "$kept" || fail "no kept database for this stamp"
  psql_db -d postgres -v db="$DB" >/dev/null <<'SQL'
select count(pg_terminate_backend(pid)) from pg_stat_activity where datname = :'db' and pid <> pg_backend_pid();
SQL
  swap_back_db "$kept"
  swap_back_files "$stamp"
  log "the database and stored files from before restore $stamp are back"
}

cmd_ledger_merge() {
  local stamp="${1:-}" kept dir n
  valid_stamp "$stamp"
  require_key
  kept="$(kept_db "$stamp")"
  {
    echo "create temp table incoming (subject_user_id text, organization_ids jsonb, row_counts jsonb, erased_at timestamptz);"
    echo "\\copy incoming from stdin csv"
    if db_exists "$kept" && [ "$(psql_db -d "$kept" -c "select to_regclass('public.erasure_ledger') is not null")" = t ]; then
      psql_db -d "$kept" -c "\\copy (select $LEDGER_COLUMNS from erasure_ledger) to stdout csv"
    fi
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
  log "erasure ledger merged: $n erasures recorded in the restored database"

  # Keep the backup history (shown in readiness and /admin/settings) across
  # the restore. Best effort: it is status, not data.
  if db_exists "$kept" && [ "$(psql_db -d "$kept" -c "select to_regclass('public.backup_run') is not null")" = t ]; then
    {
      echo "create temp table runs (operation text, trigger text, outcome text, backup_id text, size_bytes bigint, detail text, started_at timestamptz, finished_at timestamptz);"
      echo "\\copy runs from stdin csv"
      psql_db -d "$kept" -c "\\copy (select $RUN_COLUMNS from backup_run) to stdout csv"
      echo '\.'
      echo "insert into backup_run ($RUN_COLUMNS) select $RUN_COLUMNS from runs r
        where not exists (select 1 from backup_run b where b.operation = r.operation
          and b.started_at = r.started_at and b.backup_id is not distinct from r.backup_id);"
    } | psql_db -d "$DB" >/dev/null 2>&1 || log "could not carry the backup history over (status only)"
  fi
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
  ledger-merge) cmd_ledger_merge "$@" ;;
  record) record "$@" ;;
  export) cmd_export "$@" ;;
  import) cmd_import "$@" ;;
  cleanup) cmd_cleanup "$@" ;;
  _dump) cmd__dump "$@" ;;
  _filesum) cmd__filesum ;;
  *) fail "unknown command (see deploy/setup.sh backup --help)" ;;
esac
