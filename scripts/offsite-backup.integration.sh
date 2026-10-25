#!/usr/bin/env bash
#
# Off-site backup copy against a disposable MinIO (Issue #64).
#
#   bun run test:offsite
#
# Runs the real deploy/compose.yml backup services and deploy/setup.sh against
# throwaway copies of deploy/ under two unique compose projects, "A" (the
# original host) and "B" (a fresh host), plus a disposable MinIO:
#
#   1. A: synthetic rows and a stored file containing a canary string; three
#      daily backups uploaded with OPENVALENS_BACKUP_DAILY_RETAIN=2, one
#      `deploy/setup.sh backup now`, and one pre-migrate backup picked up by
#      the running `backup-offsite` uploader.
#   2. The bucket holds exactly the retained backups, every object is age
#      ciphertext or SHA256SUMS, and no object contains the canary.
#   3. Upload results reach `backup_run`; a broken credential records a failed
#      upload and does not block the pre-migrate backup (the migration gate).
#   4. B: an empty stack with the escrowed key pulls a backup with
#      `deploy/setup.sh backup pull <id>`, verifies it and restores it; the rows
#      and the stored file match A.
#
# It does not build the server or web images, so it stops short of
# `deploy/setup.sh restore` (migrations and erasure-ledger replay need the
# server image); that path is covered by the restore drill.
#
# MinIO: by default a disposable container of the pinned image below is
# started on the projects' off-site network only (no published port). CI passes
# an already-running service container instead:
#   OFFSITE_TEST_MINIO_CONTAINER       container id/name to attach
#   OFFSITE_TEST_S3_ACCESS_KEY_ID      its root user
#   OFFSITE_TEST_S3_SECRET_ACCESS_KEY  its root password
# Synthetic credentials only; nothing leaves the machine. Refuses a remote
# Docker daemon. Requires docker (Compose v2) and bash.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MINIO_IMAGE="bitnamilegacy/minio:2025.5.24-debian-12-r5@sha256:451fe6858cb770cc9d0e77ba811ce287420f781c7c1b806a386f6896471a349c"
RUN_ID="$(date -u +%Y%m%d%H%M%S)$$"
TAG="offsite-test-$RUN_ID"
BUCKET="ov-offsite-test-$RUN_ID"
CANARY="offsite-plaintext-canary-$RUN_ID"
ACCESS_KEY="${OFFSITE_TEST_S3_ACCESS_KEY_ID:-offsite-synthetic}"
SECRET_KEY="${OFFSITE_TEST_S3_SECRET_ACCESS_KEY:-offsite-synthetic-secret}"
OWN_MINIO=""
MINIO="${OFFSITE_TEST_MINIO_CONTAINER:-}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/openvalens-offsite.XXXXXX")"
chmod 0700 "$WORK"

log() { printf '[%s] offsite-test: %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
step() { printf '\n[%s] ===== %s =====\n' "$(date -u +%H:%M:%SZ)" "$*"; }
die() {
  printf '[%s] offsite-test: FAIL: %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2
  exit 1
}
check() {
  if [ "$2" = "$3" ]; then log "PASS $1 ($2)"; else die "$1: got '$2', expected '$3'"; fi
}
quiet() { grep -v -E '^ ?(Container|Network|Volume|Image) |^#[0-9]+ ' || true; }

case "${DOCKER_HOST:-unix://}" in
  unix://*) ;;
  *) die "refusing a non-local DOCKER_HOST" ;;
esac
docker compose version >/dev/null 2>&1 || die "the Docker Compose v2 plugin is required"

# --- stage two throwaway hosts -------------------------------------------------

random_hex() { od -An -tx1 -N16 /dev/urandom | tr -d ' \n'; }

stage() {
  local name="$1" dir="$WORK/$1/deploy" pw
  mkdir -p "$dir/hooks" "$dir/backup"
  cp "$REPO_DIR/deploy/compose.yml" "$REPO_DIR/deploy/Caddyfile" "$REPO_DIR/deploy/setup.sh" \
    "$REPO_DIR/deploy/pre-migrate-backup.sh" "$dir/"
  cp "$REPO_DIR/deploy/backup/Dockerfile" "$REPO_DIR/deploy/backup/openvalens-backup.sh" "$dir/backup/"
  install -d -m 0700 "$dir/secrets"
  install -d -m 0755 "$dir/secrets/postgres" "$dir/secrets/server" "$dir/secrets/backup"
  pw="$(random_hex)"
  printf '%s\n' "$pw" >"$dir/secrets/postgres/POSTGRES_PASSWORD"
  printf 'postgresql://postgres:%s@postgres:5432/openvalens\n' "$pw" >"$dir/secrets/server/DATABASE_URL"
  printf '%s\n' "$ACCESS_KEY" >"$dir/secrets/backup/BACKUP_OFFSITE_S3_ACCESS_KEY_ID"
  printf '%s\n' "$SECRET_KEY" >"$dir/secrets/backup/BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY"
  chmod 0444 "$dir"/secrets/*/*
  (
    umask 077
    cat >"$dir/.env" <<EOF
OPENVALENS_DOMAIN=localhost
ACME_EMAIL=offsite-test@example.org
EMAIL_FROM=OpenValens Test <noreply@example.org>
OPENVALENS_VERSION=$TAG
OPENVALENS_HTTP_PORT=127.0.0.1:0
OPENVALENS_HTTPS_PORT=127.0.0.1:0
OPENVALENS_PRE_MIGRATE_BACKUP=pg_dump
OPENVALENS_BACKUP_RETAIN=10
OPENVALENS_BACKUP_DAILY_RETAIN=2
OPENVALENS_OFFSITE_POLL_SECONDS=2
BACKUP_OFFSITE_S3_ENDPOINT=http://minio:9000
BACKUP_OFFSITE_S3_REGION=us-east-1
BACKUP_OFFSITE_S3_BUCKET=$BUCKET
BACKUP_OFFSITE_S3_PREFIX=hosts/test
BACKUP_OFFSITE_S3_FORCE_PATH_STYLE=true
COMPOSE_PROFILES=offsite
EOF
  )
}

A="ovoffsite-a-$RUN_ID"
B="ovoffsite-b-$RUN_ID"
ca() { docker compose -p "$A" --project-directory "$WORK/a/deploy" -f "$WORK/a/deploy/compose.yml" --env-file "$WORK/a/deploy/.env" "$@"; }
cb() { docker compose -p "$B" --project-directory "$WORK/b/deploy" -f "$WORK/b/deploy/compose.yml" --env-file "$WORK/b/deploy/.env" "$@"; }
setup_a() { COMPOSE_PROJECT_NAME="$A" bash "$WORK/a/deploy/setup.sh" "$@"; }
setup_b() { COMPOSE_PROJECT_NAME="$B" bash "$WORK/b/deploy/setup.sh" "$@"; }
psql_a() { ca exec -T postgres psql -U postgres -d openvalens -XAtq -v ON_ERROR_STOP=1 "$@"; }
psql_b() { cb exec -T postgres psql -U postgres -d openvalens -XAtq -v ON_ERROR_STOP=1 "$@"; }

# rclone against the test bucket from inside the A off-site network.
s3() {
  docker run --rm --network "${A}_offsite" \
    -e RCLONE_CONFIG=/dev/null -e RCLONE_CONFIG_M_TYPE=s3 -e RCLONE_CONFIG_M_PROVIDER=Minio \
    -e RCLONE_CONFIG_M_ENDPOINT=http://minio:9000 -e RCLONE_CONFIG_M_FORCE_PATH_STYLE=true \
    -e RCLONE_CONFIG_M_ACCESS_KEY_ID="$ACCESS_KEY" -e RCLONE_CONFIG_M_SECRET_ACCESS_KEY="$SECRET_KEY" \
    -v "$WORK/download:/download" --entrypoint rclone "openvalens-backup:$TAG" "$@"
}

teardown() {
  local status=$?
  step "teardown"
  if [ -n "$MINIO" ] && docker network inspect "${A}_offsite" >/dev/null 2>&1; then
    s3 purge "m:$BUCKET" >/dev/null 2>&1 || true
  fi
  ca --profile offsite --profile tools down -v --remove-orphans >/dev/null 2>&1 || true
  cb --profile offsite --profile tools down -v --remove-orphans >/dev/null 2>&1 || true
  if [ -n "$OWN_MINIO" ]; then
    docker rm -f "$OWN_MINIO" >/dev/null 2>&1 || true
  elif [ -n "$MINIO" ]; then
    docker network disconnect "${A}_offsite" "$MINIO" >/dev/null 2>&1 || true
    docker network disconnect "${B}_offsite" "$MINIO" >/dev/null 2>&1 || true
  fi
  docker image rm "openvalens-backup:$TAG" >/dev/null 2>&1 || true
  rm -rf "$WORK"
  log "removed projects $A and $B, their volumes, the test bucket and temp state"
  exit "$status"
}
trap teardown EXIT

step "stage two disposable hosts (projects $A, $B)"
stage a
stage b
ca config --quiet || die "compose configuration is invalid"
ca build --quiet backup 2>&1 | quiet
docker run --rm --entrypoint age-keygen "openvalens-backup:$TAG" >"$WORK/a/deploy/secrets/backup/age-identity" 2>/dev/null
chmod 0444 "$WORK/a/deploy/secrets/backup/age-identity"
# Host B gets the escrowed key, as the docs describe for a new host.
cp "$WORK/a/deploy/secrets/backup/age-identity" "$WORK/b/deploy/secrets/backup/age-identity"
log "built openvalens-backup:$TAG; generated a throwaway key (never printed)"

step "start postgres and the off-site network on A; attach MinIO"
ca up -d --wait postgres 2>&1 | quiet
ca up --no-start backup-offsite 2>&1 | quiet
if [ -z "$MINIO" ]; then
  OWN_MINIO="ovoffsite-minio-$RUN_ID"
  docker run -d --name "$OWN_MINIO" --network "${A}_offsite" --network-alias minio \
    -e MINIO_ROOT_USER="$ACCESS_KEY" -e MINIO_ROOT_PASSWORD="$SECRET_KEY" "$MINIO_IMAGE" >/dev/null
  MINIO="$OWN_MINIO"
  log "started disposable MinIO ($MINIO_IMAGE) on the off-site network only"
else
  docker network connect --alias minio "${A}_offsite" "$MINIO"
  log "attached the MinIO service container to the off-site network"
fi
for _ in $(seq 1 60); do s3 lsd m: >/dev/null 2>&1 && break || sleep 1; done
s3 mkdir "m:$BUCKET" >/dev/null || die "could not create the test bucket"

step "A: synthetic data with a canary in a row and in a stored file"
for migration in 20261004120000_erasure_ledger 20261025090000_backup_status; do
  psql_a <"$REPO_DIR/packages/db/src/migrations/$migration/migration.sql" >/dev/null
done
psql_a -c "create table synthetic (id serial primary key, note text not null);
  insert into synthetic (note) select '$CANARY ' || g from generate_series(1, 25) g;
  insert into erasure_ledger (subject_user_id, organization_ids, row_counts) values ('user-gone', '[\"org-gone\"]', '{}')" >/dev/null
ca run --rm --no-deps -T --entrypoint bash backup-tools -c \
  "mkdir -p /storage/org/org-a && printf '%s\n' '$CANARY' >/storage/org/org-a/11111111-1111-4111-8111-111111111111 && chown -R 1000:1000 /storage" 2>&1 | quiet
FILE_SUM="$(ca run --rm --no-deps -T --entrypoint sha256sum backup-tools /storage/org/org-a/11111111-1111-4111-8111-111111111111 2>/dev/null | cut -d' ' -f1)"
ROWS="$(psql_a -c "select count(*) from synthetic")"
log "25 rows and one stored file written"

step "A: three daily backups (retention 2), backup now, and a pre-migrate backup"
DAILY=()
for _ in 1 2 3; do
  id="$(ca run --rm --no-deps -T backup-tools create daily 2>/dev/null | tr -d '\r' | tail -n 1)"
  DAILY+=("$id")
  ca run --rm --no-deps -T backup-offsite offsite-upload "$id" 2>&1 | quiet
  sleep 1
done
setup_a backup now 2>&1 | quiet | grep -E '^setup:|off-site' || true
MANUAL="$(ca run --rm --no-deps -T backup-tools list 2>/dev/null | cut -f1 | grep -- '-manual$' | tail -n 1 | tr -d '\r')"
[ -n "$MANUAL" ] || die "backup now wrote no manual backup"
# The pre-migrate one-shot, then the long-running uploader picks it up.
ca run --rm -T backup 2>&1 | quiet | grep 'pre-migrate-backup:' || true
PRE="$(ca run --rm --no-deps -T backup-tools list 2>/dev/null | cut -f1 | grep -- '-pre-migrate$' | tail -n 1 | tr -d '\r')"
[ -n "$PRE" ] || die "no pre-migrate backup was written"
ca up -d backup-offsite 2>&1 | quiet
for _ in $(seq 1 60); do
  s3 lsf "m:$BUCKET/hosts/test/$PRE/SHA256SUMS" 2>/dev/null | grep -q . && break
  sleep 1
done
ca stop backup-offsite 2>&1 | quiet

step "the bucket: retention applied, ciphertext only, no canary"
REMOTE="$(s3 lsf --dirs-only "m:$BUCKET/hosts/test/" | sed 's#/$##' | sort)"
printf '%s\n' "$REMOTE" | sed 's/^/  remote: /'
check "daily backups kept off site (retention 2 of 3)" \
  "$(printf '%s\n' "$REMOTE" | grep -c -- '-daily$')" 2
check "oldest daily backup pruned off site" \
  "$(printf '%s\n' "$REMOTE" | grep -c -- "^${DAILY[0]}$" || true)" 0
check "backup now uploaded" "$(printf '%s\n' "$REMOTE" | grep -c -- "^$MANUAL$")" 1
check "pre-migrate backup uploaded by the uploader service" "$(printf '%s\n' "$REMOTE" | grep -c -- "^$PRE$")" 1
mkdir -p "$WORK/download"
s3 copy "m:$BUCKET/hosts/test" /download >/dev/null
check "objects other than *.age and SHA256SUMS" \
  "$(find "$WORK/download" -type f ! -name '*.age' ! -name SHA256SUMS | wc -l | tr -d ' ')" 0
NOT_AGE=0
while IFS= read -r file; do
  head -c 21 "$file" | grep -q '^age-encryption.org/v1' || NOT_AGE=$((NOT_AGE + 1))
done < <(find "$WORK/download" -type f -name '*.age')
check ".age objects without the age header" "$NOT_AGE" 0
check "objects containing the plaintext canary" \
  "$( (grep -rl -- "$CANARY" "$WORK/download" || true) | wc -l | tr -d ' ')" 0
check "every off-site backup verifies against its SHA256SUMS" \
  "$(for d in "$WORK"/download/*/; do (cd "$d" && sha256sum --quiet --strict -c SHA256SUMS >/dev/null 2>&1 && echo ok || echo bad); done | sort -u)" ok

step "upload results reach backup_run; a failed upload never blocks the migration gate"
ca run --rm --no-deps -T backup-tools offsite-sync 2>&1 | quiet
check "successful off-site uploads recorded" \
  "$(psql_a -c "select count(*) >= 5 from backup_run where operation = 'offsite' and outcome = 'ok'")" t
chmod 0644 "$WORK/a/deploy/secrets/backup/BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY"
printf 'wrong-secret\n' >"$WORK/a/deploy/secrets/backup/BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY"
BROKEN="$(ca run --rm --no-deps -T backup-tools create manual 2>/dev/null | tr -d '\r' | tail -n 1)"
if ca run --rm --no-deps -T backup-offsite offsite-upload "$BROKEN" >/dev/null 2>&1; then
  die "an upload with a wrong secret succeeded"
fi
ca run --rm --no-deps -T backup-tools offsite-sync 2>&1 | quiet
check "failed upload recorded with its step" \
  "$(psql_a -c "select outcome || ':' || detail from backup_run where operation = 'offsite' order by id desc limit 1")" "failed:upload"
if ! ca run --rm -T backup >/dev/null 2>&1; then die "the pre-migrate backup failed while off-site was broken"; fi
log "PASS pre-migrate backup (the migration gate) succeeds while the off-site copy is broken"
printf '%s\n' "$SECRET_KEY" >"$WORK/a/deploy/secrets/backup/BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY"
chmod 0444 "$WORK/a/deploy/secrets/backup/BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY"

step "B: a fresh host with the escrowed key pulls $MANUAL from off site and restores it"
cb up -d --wait postgres 2>&1 | quiet
cb up --no-start backup-offsite 2>&1 | quiet
docker network connect --alias minio "${B}_offsite" "$MINIO"
check "B starts empty" "$(psql_b -c "select count(*) from pg_tables where schemaname = 'public'")" 0
setup_b backup pull 2>&1 | quiet | sed 's/^/  /'
setup_b backup pull "$MANUAL" 2>&1 | quiet | grep -E '^setup:|openvalens-backup:' || die "backup pull failed"
cb run --rm --no-deps -T backup-tools verify "$MANUAL" 2>&1 | quiet
cb run --rm --no-deps -T backup-tools restore-db "$MANUAL" "$(date -u +%Y%m%d%H%M%S)" 2>&1 | quiet
check "rows restored on B" "$(psql_b -c "select count(*) from synthetic")" "$ROWS"
check "erasure ledger restored on B" "$(psql_b -c "select count(*) from erasure_ledger")" 1
check "stored file restored on B" \
  "$(cb run --rm --no-deps -T --entrypoint sha256sum backup-tools /storage/org/org-a/11111111-1111-4111-8111-111111111111 2>/dev/null | cut -d' ' -f1)" "$FILE_SUM"
check "pulled backup marked as already off site (not re-uploaded)" \
  "$(cb run --rm --no-deps -T --entrypoint test backup-tools -f "/backups/.offsite/$MANUAL.done" >/dev/null 2>&1 && echo yes || echo no)" yes

step "result"
log "off-site backup test PASSED (local, disposable)"
