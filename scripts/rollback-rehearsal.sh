#!/usr/bin/env bash
#
# Rollback rehearsal on a DISPOSABLE LOCAL stack (Issue #129).
#
#   scripts/rollback-rehearsal.sh --from <known-good ref> --to <candidate ref> \
#     [--transcript <path>] [--http-port 18080] [--https-port 18443] \
#     [--skip-build] [--keep-images] [--keep]
#
# Rehearses the self-host rollback path documented in docs/release.md against a
# throwaway copy of deploy/compose.yml, end to end:
#
#   1. install   start <from> on an empty database, verify readiness, record the
#                applied migrations and write a synthetic marker row.
#   2. upgrade   stop the app, start <to>: the gated chain takes the encrypted
#                pre-migrate backup, applies the new migrations and starts the
#                server. Verify readiness and write a second synthetic marker.
#   3. rollback  `deploy/setup.sh restore <pre-migrate backup> --no-build` with
#                <from>'s images: verify the backup, keep the upgraded database
#                under a new name, restore, re-apply the erasure ledger, start
#                <from> again and verify readiness, the migration count and the
#                markers (the pre-upgrade marker is back; the post-upgrade write
#                is gone, which is the expected cost of a restore rollback).
#   4. teardown  remove the rehearsal containers, volumes and temp state (unless
#                --keep) and the rehearsal image tags (unless --keep-images or
#                --keep). `--skip-build` reuses kept images on a re-run.
#
# Isolation: a unique compose project `openvalens-rehearsal-<id>`, a private
# temp state directory outside the repository, generated throwaway secrets,
# `localhost` behind Caddy's internal CA, ports bound to 127.0.0.1 only, and
# EMAIL_DRY_RUN=true with no Resend, Anthropic or Telegram key, so no provider
# is ever called. Images are built locally from `git archive <ref>` and tagged
# `openvalens-{server,web}:rehearsal-<sha>`; nothing is pushed or tagged in git.
# The backup image and deploy/ scripts are this checkout's. Both refs must
# include encrypted backups (Issue #64): the restore runs <from>'s
# scripts/erasure-replay.ts.
#
# This is NOT a production procedure and needs no deploy authorization. It
# refuses a remote Docker daemon. Requires: git, docker (Compose v2), bun.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

FROM_REF=""
TO_REF=""
TRANSCRIPT=""
HTTP_PORT=18080
HTTPS_PORT=18443
SKIP_BUILD=0
KEEP=0
KEEP_IMAGES=0

usage() { sed -n '3,34p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM_REF="${2:-}"; shift ;;
    --to) TO_REF="${2:-}"; shift ;;
    --transcript) TRANSCRIPT="${2:-}"; shift ;;
    --http-port) HTTP_PORT="${2:-}"; shift ;;
    --https-port) HTTPS_PORT="${2:-}"; shift ;;
    --skip-build) SKIP_BUILD=1 ;;
    --keep-images) KEEP_IMAGES=1 ;;
    --keep) KEEP=1 ;;
    -h | --help) usage; exit 0 ;;
    *)
      # Never echo the rejected value.
      echo "rehearsal: unknown option (see --help)" >&2
      exit 2
      ;;
  esac
  shift
done

[ -n "$FROM_REF" ] && [ -n "$TO_REF" ] || {
  echo "rehearsal: --from and --to are required (see --help)" >&2
  exit 2
}
for port in "$HTTP_PORT" "$HTTPS_PORT"; do
  case "$port" in
    '' | *[!0-9]*) echo "rehearsal: ports must be numbers" >&2; exit 2 ;;
  esac
done

if [ -n "$TRANSCRIPT" ]; then
  : >"$TRANSCRIPT"
  exec > >(tee -a "$TRANSCRIPT") 2>&1
fi

log() { printf '[%s] rehearsal: %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
step() { printf '\n[%s] ===== %s =====\n' "$(date -u +%H:%M:%SZ)" "$*"; }
die() {
  printf '[%s] rehearsal: ERROR: %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2
  exit 1
}

# --- preflight ---------------------------------------------------------------

case "${DOCKER_HOST:-unix://}" in
  unix://*) ;;
  *) die "refusing a non-local DOCKER_HOST: rehearse on a local daemon only" ;;
esac
command -v git >/dev/null || die "git is required"
command -v bun >/dev/null || die "bun is required"
docker compose version >/dev/null 2>&1 || die "the Docker Compose v2 plugin is required"

FROM_SHA="$(git -C "$REPO_DIR" rev-parse --verify "$FROM_REF^{commit}")" || die "unknown --from ref"
TO_SHA="$(git -C "$REPO_DIR" rev-parse --verify "$TO_REF^{commit}")" || die "unknown --to ref"
[ "$FROM_SHA" != "$TO_SHA" ] || die "--from and --to must be different commits"
FROM_TAG="rehearsal-${FROM_SHA:0:12}"
TO_TAG="rehearsal-${TO_SHA:0:12}"

RUN_ID="$(date -u +%Y%m%d%H%M%S)"
PROJECT="openvalens-rehearsal-$RUN_ID"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/openvalens-rehearsal.XXXXXX")"
chmod 0700 "$WORK"
case "$(cd "$WORK" && pwd -P)/" in
  "$(cd "$REPO_DIR" && pwd -P)"/*) die "temp state must be outside the repository" ;;
esac
STATE="$WORK/deploy"

compose() {
  docker compose -p "$PROJECT" --project-directory "$STATE" \
    -f "$STATE/compose.yml" -f "$STATE/compose.rehearsal.yml" --env-file "$STATE/.env" "$@"
}

teardown() {
  local status=$?
  if [ "$KEEP" -eq 1 ]; then
    log "--keep: leaving project $PROJECT and state in $WORK"
    log "remove later: docker compose -p $PROJECT down -v; rm -rf $WORK"
  else
    step "teardown"
    compose down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$WORK"
    log "removed project $PROJECT (containers, networks, volumes) and temp state"
    if [ "$KEEP_IMAGES" -eq 0 ]; then
      docker image rm "openvalens-server:$FROM_TAG" "openvalens-web:$FROM_TAG" \
        "openvalens-server:$TO_TAG" "openvalens-web:$TO_TAG" \
        "openvalens-backup:$FROM_TAG" "openvalens-backup:$TO_TAG" >/dev/null 2>&1 || true
      log "removed rehearsal image tags"
    fi
  fi
  exit "$status"
}
trap teardown EXIT

step "LOCAL REHEARSAL ONLY — disposable stack, synthetic data, no production access"
log "from (known-good) $FROM_REF = $FROM_SHA"
log "to   (candidate)  $TO_REF = $TO_SHA"
log "compose project $PROJECT; https://localhost:$HTTPS_PORT (loopback only)"
log "docker $(docker version --format '{{.Server.Version}}') context $(docker context show)"

# --- stage a throwaway self-host state directory -----------------------------

mkdir -p "$STATE"
cp "$REPO_DIR/deploy/compose.yml" "$REPO_DIR/deploy/Caddyfile" \
  "$REPO_DIR/deploy/pre-migrate-backup.sh" "$REPO_DIR/deploy/setup.sh" "$STATE/"
mkdir -p "$STATE/hooks" "$STATE/backup"
cp "$REPO_DIR/deploy/backup/Dockerfile" "$REPO_DIR/deploy/backup/openvalens-backup.sh" "$STATE/backup/"
# Images are pre-built per ref below, so compose must never build or pull them.
cat >"$STATE/compose.rehearsal.yml" <<'EOF'
services:
  web:
    build: !reset null
    pull_policy: never
  server:
    build: !reset null
    pull_policy: never
  migrate:
    pull_policy: never
  backup:
    build: !reset null
    pull_policy: never
  backup-scheduler:
    pull_policy: never
  backup-tools:
    pull_policy: never
EOF

random_hex() { od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; }
write_secret() {
  (umask 022 && printf '%s\n' "$3" >"$1/$2")
  chmod 0444 "$1/$2"
}
install -d -m 0700 "$STATE/secrets"
install -d -m 0755 "$STATE/secrets/server" "$STATE/secrets/postgres" "$STATE/secrets/backup"
pg_password="$(random_hex)"
write_secret "$STATE/secrets/postgres" POSTGRES_PASSWORD "$pg_password"
write_secret "$STATE/secrets/server" DATABASE_URL "postgresql://postgres:$pg_password@postgres:5432/openvalens"
unset pg_password
write_secret "$STATE/secrets/server" BETTER_AUTH_SECRET "$(random_hex)"
write_secret "$STATE/secrets/server" CRON_SECRET "$(random_hex)"
write_secret "$STATE/secrets/server" TELEGRAM_WEBHOOK_SECRET "$(random_hex)"

set_version() {
  (
    umask 077
    cat >"$STATE/.env" <<EOF
OPENVALENS_DOMAIN=localhost
ACME_EMAIL=rehearsal@example.org
EMAIL_FROM=OpenValens Rehearsal <noreply@example.org>
EMAIL_DRY_RUN=true
OPENVALENS_HTTP_PORT=127.0.0.1:$HTTP_PORT
OPENVALENS_HTTPS_PORT=127.0.0.1:$HTTPS_PORT
OPENVALENS_VERSION=$1
OPENVALENS_PRE_MIGRATE_BACKUP=pg_dump
OPENVALENS_BACKUP_RETAIN=10
OPENVALENS_BACKUP_DAILY_RETAIN=14
OPENVALENS_BACKUP_HOUR=3
EOF
  )
}
set_version "$FROM_TAG"
compose config --quiet || die "rehearsal compose configuration is invalid"
log "staged throwaway config and generated secrets (never printed) in a private temp dir"

# --- build images per ref ----------------------------------------------------

build_ref() {
  local sha="$1" tag="$2" src="$WORK/src-${1:0:12}"
  if [ "$SKIP_BUILD" -eq 1 ] &&
    docker image inspect "openvalens-server:$tag" >/dev/null 2>&1 &&
    docker image inspect "openvalens-web:$tag" >/dev/null 2>&1; then
    log "reusing existing images openvalens-{server,web}:$tag"
    return 0
  fi
  mkdir -p "$src"
  git -C "$REPO_DIR" archive --format=tar "$sha" | tar -x -C "$src"
  log "building openvalens-server:$tag from ${sha:0:12}"
  docker build --quiet --file "$src/apps/server/Dockerfile" --tag "openvalens-server:$tag" \
    --label "org.opencontainers.image.revision=$sha" --label com.openvalens.rehearsal=1 "$src" >/dev/null
  log "building openvalens-web:$tag from ${sha:0:12}"
  docker build --quiet --file "$src/apps/web/Dockerfile" --tag "openvalens-web:$tag" \
    --build-arg VITE_SERVER_URL=https://localhost \
    --label "org.opencontainers.image.revision=$sha" --label com.openvalens.rehearsal=1 "$src" >/dev/null
  rm -rf "$src"
}

# The backup image (pinned Postgres + age) is this checkout's, tagged per ref
# so OPENVALENS_VERSION names it for either release.
build_backup_image() {
  docker build --quiet --tag "openvalens-backup:$1" --label com.openvalens.rehearsal=1 \
    "$STATE/backup" >/dev/null
}

step "build release artifacts (local only, never pushed)"
build_ref "$FROM_SHA" "$FROM_TAG"
build_ref "$TO_SHA" "$TO_TAG"
build_backup_image "$FROM_TAG"
build_backup_image "$TO_TAG"
# Throwaway backup key, generated like setup.sh does; never printed.
docker run --rm --entrypoint age-keygen "openvalens-backup:$FROM_TAG" \
  >"$STATE/secrets/backup/age-identity" 2>/dev/null
chmod 0444 "$STATE/secrets/backup/age-identity"
for tag in "$FROM_TAG" "$TO_TAG"; do
  for app in server web; do
    log "image openvalens-$app:$tag $(docker image inspect --format '{{.Id}}' "openvalens-$app:$tag")"
  done
done

# --- helpers -----------------------------------------------------------------

wait_for_server() {
  local id state
  for _ in $(seq 1 60); do
    id="$(compose ps -q server 2>/dev/null || true)"
    state="$(docker inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null || true)"
    [ "$state" = "healthy" ] && return 0
    sleep 3
  done
  return 1
}

# psql inside the postgres container; output is counts/marker labels only.
sql() { compose exec -T postgres psql -U postgres -d "${2:-openvalens}" -XAtq -v ON_ERROR_STOP=1 -c "$1"; }

migration_count() { sql "select count(*) from drizzle.__drizzle_migrations"; }

verify() {
  bun "$REPO_DIR/scripts/verify-readiness.ts" --base-url "https://localhost:$HTTPS_PORT" \
    --insecure --expect email=dry-run:resend,ai=off,messaging=off
}

running_image() {
  docker inspect --format '{{.Image}}' "$(compose ps -q server)"
}

start_chain() {
  if ! compose up -d >/dev/null 2>&1 || ! wait_for_server; then
    compose logs --no-color backup migrate server | tail -n 40
    die "the gated chain did not reach a healthy server"
  fi
  log "one-shot steps: $(compose ps -a --format '{{.Service}}={{.State}}({{.ExitCode}})' backup migrate | tr '\n' ' ')"
  compose logs --no-color backup | sed -n 's/^.*pre-migrate-backup: /  backup: /p' | tail -n 1
}

# --- 1. install the known-good release ---------------------------------------

step "1. install known-good release $FROM_TAG on an empty database"
set_version "$FROM_TAG"
start_chain
verify
FROM_IMAGE="$(running_image)"
FROM_MIGRATIONS="$(migration_count)"
log "server image $FROM_IMAGE"
log "applied migrations: $FROM_MIGRATIONS"
sql "create schema rehearsal; create table rehearsal.marker (label text primary key, written_at timestamptz not null default now()); insert into rehearsal.marker (label) values ('before-upgrade')"
log "synthetic marker written: before-upgrade"

# --- 2. upgrade to the candidate ---------------------------------------------

step "2. upgrade to candidate $TO_TAG (stop app -> pre-migrate backup -> migrate -> start)"
compose stop caddy web server >/dev/null 2>&1
set_version "$TO_TAG"
start_chain
verify
TO_IMAGE="$(running_image)"
TO_MIGRATIONS="$(migration_count)"
log "server image $TO_IMAGE"
log "applied migrations: $TO_MIGRATIONS (was $FROM_MIGRATIONS)"
[ "$TO_IMAGE" != "$FROM_IMAGE" ] || die "the candidate image is not running"
sql "insert into rehearsal.marker (label) values ('after-upgrade')"
log "synthetic marker written: after-upgrade (simulates a write made after the upgrade)"
BACKUP_ID="$(compose run --rm --no-deps -T backup-tools list 2>/dev/null | cut -f1 | grep -- '-pre-migrate$' | tail -n 1 | tr -d '\r')"
[ -n "$BACKUP_ID" ] || die "no pre-migrate backup was taken during the upgrade"
log "encrypted pre-migrate backup taken by the upgrade: $BACKUP_ID"

# --- 3. roll back ------------------------------------------------------------

step "3. ROLLBACK to $FROM_TAG: deploy/setup.sh restore $BACKUP_ID (keeps the upgraded DB)"
set_version "$FROM_TAG"
if ! restore_output="$(COMPOSE_PROJECT_NAME="$PROJECT" bash "$STATE/setup.sh" restore "$BACKUP_ID" \
  --non-interactive --force --no-build 2>&1)"; then
  printf '%s\n' "$restore_output" | grep -v -E '^ ?(Container|Network|Volume) ' | tail -n 20
  die "the restore failed; the upgraded database is kept (see the messages above)"
fi
printf '%s\n' "$restore_output" | grep -E '^(setup|openvalens-backup): |^Erasure ledger' | sed 's/^/  /'
KEPT_DB="$(sql "select datname from pg_database where datname like 'openvalens_pre_restore_%' order by 1 desc limit 1" postgres)"
log "upgraded database kept as $KEPT_DB for forensics"
start_chain
verify
ROLLBACK_IMAGE="$(running_image)"
ROLLBACK_MIGRATIONS="$(migration_count)"
MARKERS="$(sql "select string_agg(label, ',' order by label) from rehearsal.marker")"
log "server image $ROLLBACK_IMAGE"
log "applied migrations: $ROLLBACK_MIGRATIONS"
log "synthetic markers present: $MARKERS"

step "result"
fail=0
check() {
  if [ "$2" = "$3" ]; then log "PASS $1 ($2)"; else
    log "FAIL $1 (got $2, expected $3)"
    fail=1
  fi
}
check "rolled-back server runs the known-good image" "$ROLLBACK_IMAGE" "$FROM_IMAGE"
check "migration journal matches the known-good release" "$ROLLBACK_MIGRATIONS" "$FROM_MIGRATIONS"
check "pre-upgrade data restored; post-upgrade write absent" "$MARKERS" "before-upgrade"
if [ "$TO_MIGRATIONS" = "$FROM_MIGRATIONS" ]; then
  log "NOTE: the candidate added no migration; this rehearsed an image-only rollback path"
fi
[ "$fail" -eq 0 ] || die "rollback rehearsal FAILED"
log "rollback rehearsal PASSED (local, disposable stack)"
