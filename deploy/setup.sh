#!/usr/bin/env bash
#
# OpenValens self-host installer and upgrader (Issue #63).
#
#   deploy/setup.sh install    [--dry-run] [--non-interactive] [--reconfigure]
#   deploy/setup.sh upgrade    [--dry-run]
#   deploy/setup.sh mint-token [--dry-run]
#
# install     Asks for the domain and email settings, generates every secret
#             into deploy/secrets/ (never prints one), writes deploy/.env, builds
#             the pinned images, starts the stack behind Caddy (HTTPS) and mints
#             the one-time setup token into deploy/secrets/setup-token.
#             Re-running it keeps existing secrets, the settings already in
#             deploy/.env and every key you added there by hand.
# upgrade     Run after `git checkout <new tag>`: rebuilds the images, stops the
#             server, then starts the chain postgres -> pre-migrate backup ->
#             migrate -> server. A failed backup or migration leaves the server
#             stopped and keeps every backup.
# mint-token  Re-mints the setup token (it expires after 24 hours). Minting
#             again invalidates the previous token. Refused once an
#             administrator exists.
#
# --dry-run          Change nothing: generate config and throwaway secrets in a
#                    private temp directory, validate the compose file, print the
#                    commands that would run, then delete the temp directory.
#                    An existing deploy/.env is copied in, so the preview
#                    reflects your settings; the original is never modified.
# --non-interactive  Read settings from the environment instead of prompting:
#                    OPENVALENS_DOMAIN, ACME_EMAIL, EMAIL_FROM and, optionally,
#                    RESEND_API_KEY_SOURCE (path to a private file holding the
#                    Resend key). Secrets are never accepted as arguments.
# --reconfigure      install only: ask for (or, with --non-interactive, read) the
#                    domain and email settings again instead of reusing the ones
#                    in deploy/.env. Secrets and every other key are kept.
#
# Secrets are written only to files on this host. Never paste a secret, the
# setup token or deploy/.env into chat, tickets or logs.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"

command="${1:-}"
[ $# -gt 0 ] && shift
DRY_RUN=0
INTERACTIVE=1
RECONFIGURE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --non-interactive) INTERACTIVE=0 ;;
    --reconfigure) RECONFIGURE=1 ;;
    -h | --help) command=help ;;
    *)
      # Never echo the rejected value: it may be a pasted secret.
      echo "setup: unknown option (see deploy/setup.sh --help)" >&2
      exit 2
      ;;
  esac
  shift
done

log() { printf 'setup: %s\n' "$*"; }
warn() { printf 'setup: WARNING: %s\n' "$*" >&2; }
die() {
  printf 'setup: ERROR: %s\n' "$*" >&2
  exit 1
}

usage() { sed -n '3,37p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

# In dry-run mode everything is staged in a private temp directory.
if [ "$DRY_RUN" -eq 1 ]; then
  STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/openvalens-setup-dry-run.XXXXXX")"
  chmod 0700 "$STATE_DIR"
  trap 'rm -rf "$STATE_DIR"' EXIT
  # Preview against the real settings; the copy is private and deleted on exit.
  if [ -f "$DEPLOY_DIR/.env" ]; then
    (
      umask 077
      cat "$DEPLOY_DIR/.env" >"$STATE_DIR/.env"
    )
  fi
else
  STATE_DIR="$DEPLOY_DIR"
fi
ENV_FILE="$STATE_DIR/.env"
SECRETS_DIR="$STATE_DIR/secrets"
TOKEN_FILE="$SECRETS_DIR/setup-token"

compose() {
  docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/compose.yml" --env-file "$ENV_FILE" "$@"
}

# Run a side-effecting command, or only print it in dry-run mode.
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf 'setup: [dry-run] would run: %s\n' "$*"
  else
    "$@"
  fi
}

# --- preflight ---------------------------------------------------------------

preflight() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed (https://docs.docker.com/engine/install/)"
  docker compose version >/dev/null 2>&1 || die "the Docker Compose v2 plugin ('docker compose') is required"
  if [ "$DRY_RUN" -eq 0 ]; then
    docker info >/dev/null 2>&1 || die "cannot reach the Docker daemon (is it running, and may this user use it?)"
  fi
  [ -r /dev/urandom ] || die "/dev/urandom is not readable"
}

# --- config ------------------------------------------------------------------

# Bare DNS name (or `localhost` for a local trial); no scheme, port or path.
valid_domain() {
  printf '%s' "$1" | grep -Eq '^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'
}
valid_email() { printf '%s' "$1" | grep -Eq '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'; }
# `Name <addr@host>` or a bare address.
valid_from() { printf '%s' "$1" | grep -Eq '^([^<>]+ <)?[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+>?$'; }

# Read one setting from deploy/.env (literal value, no shell evaluation).
env_get() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true
}

ask() {
  # ask <var> <prompt> <validator>
  local value=""
  while :; do
    printf '%s: ' "$2" >&2
    IFS= read -r value || die "no input"
    if "$3" "$value"; then break; fi
    echo "  invalid value, try again" >&2
  done
  printf -v "$1" '%s' "$value"
}

image_version() {
  # Images are built from this checkout, so the version is the checked-out
  # tag/commit. Docker tags allow [A-Za-z0-9_.-] only.
  local v
  v="$(git -C "$REPO_DIR" describe --tags --always --dirty 2>/dev/null || true)"
  v="$(printf '%s' "${v:-local}" | tr -c 'A-Za-z0-9_.-' '-')"
  printf '%s' "${v:0:120}"
}

gather_config() {
  DOMAIN="$(env_get OPENVALENS_DOMAIN)"
  ACME="$(env_get ACME_EMAIL)"
  FROM="$(env_get EMAIL_FROM)"
  if [ -n "$DOMAIN" ] && [ "$RECONFIGURE" -eq 0 ]; then
    log "reusing settings from deploy/.env (--reconfigure to change them)"
    return
  fi
  if [ "$INTERACTIVE" -eq 1 ]; then
    echo "OpenValens will be served at https://<domain>. Point the domain's DNS A/AAAA" >&2
    echo "record at this host and open ports 80 and 443 before continuing." >&2
    ask DOMAIN "Domain (e.g. health.example.org)" valid_domain
    ask ACME "Email for Let's Encrypt certificate notices" valid_email
    ask FROM "Sender for app email (e.g. OpenValens <noreply@example.org>)" valid_from
  else
    DOMAIN="${OPENVALENS_DOMAIN:-}"
    ACME="${ACME_EMAIL:-}"
    FROM="${EMAIL_FROM:-}"
    valid_domain "$DOMAIN" || die "OPENVALENS_DOMAIN must be a bare domain name"
    valid_email "$ACME" || die "ACME_EMAIL must be an email address"
    valid_from "$FROM" || die "EMAIL_FROM must be an address or 'Name <address>'"
  fi
}

# Keys `install` writes on every run, keeping the values already in
# deploy/.env (only the domain and email settings are re-asked, and only with
# --reconfigure). Every other line is the operator's and is copied through.
MANAGED_KEYS="OPENVALENS_DOMAIN ACME_EMAIL EMAIL_FROM OPENVALENS_VERSION
  OPENVALENS_PRE_MIGRATE_BACKUP OPENVALENS_BACKUP_RETAIN STORAGE_PROVIDER
  STORAGE_S3_ENDPOINT STORAGE_S3_REGION STORAGE_S3_BUCKET
  STORAGE_S3_FORCE_PATH_STYLE STORAGE_S3_SSE"
# Optional secrets: `<KEY>_FILE` is set exactly when deploy/secrets/server/<KEY>
# exists, so the stack never points at a missing file.
SECRET_FILE_KEYS="RESEND_API_KEY EMAIL_AUDIT_BCC AI_API_KEY ANTHROPIC_API_KEY
  TELEGRAM_BOT_TOKEN STORAGE_S3_ACCESS_KEY_ID STORAGE_S3_SECRET_ACCESS_KEY
  OIDC_CLIENT_SECRET"
OPERATOR_MARKER="# --- Your settings: deploy/setup.sh install keeps everything below ---"

# has_secret <KEY>: the optional secret file exists and is non-empty. A dry run
# also checks the real deploy/secrets (existence only, never the contents).
has_secret() {
  [ -s "$SECRETS_DIR/server/$1" ] && return 0
  [ "$DRY_RUN" -eq 1 ] && [ -s "$DEPLOY_DIR/secrets/server/$1" ]
}

# The operator's lines from the current deploy/.env: everything below the
# marker, plus any unmanaged `KEY=value` line above it (files written before
# the marker existed). Managed keys are dropped here; write_env rewrites them
# with the value env_get finds (the last occurrence wins, as in Compose).
operator_lines() {
  [ -f "$ENV_FILE" ] || return 0
  local managed="" key
  for key in $MANAGED_KEYS; do managed="$managed $key"; done
  for key in $SECRET_FILE_KEYS; do managed="$managed ${key}_FILE"; done
  awk -v managed="$managed" -v marker="$OPERATOR_MARKER" '
    BEGIN { n = split(managed, keys, " "); for (i = 1; i <= n; i++) skip[keys[i]] = 1 }
    $0 == marker { below = 1; next }
    {
      assignment = $0 ~ /^[A-Za-z_][A-Za-z0-9_]*=/
      key = $0; sub(/=.*/, "", key)
      if (assignment && (key in skip)) next
      if (below || assignment) print
    }
  ' "$ENV_FILE"
}

write_env() {
  local key value file_lines="" operator tmp
  for key in $SECRET_FILE_KEYS; do
    value=""
    if has_secret "$key"; then
      value="/run/secrets/$key"
    elif [ -n "$(env_get "${key}_FILE")" ]; then
      warn "clearing ${key}_FILE: deploy/secrets/server/$key is missing or empty"
    fi
    # Key names only: a value in deploy/.env is never echoed.
    if [ -n "$(env_get "$key")" ]; then
      warn "deploy/.env sets $key directly, which the stack ignores; move it to deploy/secrets/server/$key"
    fi
    file_lines="$file_lines${key}_FILE=$value"$'\n'
  done
  operator="$(operator_lines)"
  tmp="$ENV_FILE.tmp.$$"
  (
    umask 077
    cat >"$tmp" <<EOF
# Written by deploy/setup.sh. Non-secret settings only: secrets live in
# deploy/secrets/ and are referenced through *_FILE paths.
OPENVALENS_DOMAIN=$DOMAIN
ACME_EMAIL=$ACME
EMAIL_FROM=$FROM
# Image tag for the locally built server/web images (the checked-out version).
OPENVALENS_VERSION=$(image_version)
# Pre-migrate backup hook: pg_dump (default) | hook | none. See docs/self-hosting/backup.md.
OPENVALENS_PRE_MIGRATE_BACKUP=$(env_get OPENVALENS_PRE_MIGRATE_BACKUP | grep . || echo pg_dump)
OPENVALENS_BACKUP_RETAIN=$(env_get OPENVALENS_BACKUP_RETAIN | grep . || echo 10)
# Object storage: local (default, the "storage" volume) | s3. See docs/storage.md.
STORAGE_PROVIDER=$(env_get STORAGE_PROVIDER | grep . || echo local)
STORAGE_S3_ENDPOINT=$(env_get STORAGE_S3_ENDPOINT)
STORAGE_S3_REGION=$(env_get STORAGE_S3_REGION)
STORAGE_S3_BUCKET=$(env_get STORAGE_S3_BUCKET)
STORAGE_S3_FORCE_PATH_STYLE=$(env_get STORAGE_S3_FORCE_PATH_STYLE | grep . || echo false)
STORAGE_S3_SSE=$(env_get STORAGE_S3_SSE | grep . || echo AES256)
# Optional secrets: set when deploy/secrets/server/<KEY> exists, empty otherwise.
${file_lines}# Add other settings (AI_PROVIDER, CSP_MODE, EMAIL_DRY_RUN, ...; see
# docs/self-hosting/configuration.md) below this line.
$OPERATOR_MARKER
EOF
    [ -z "$operator" ] || printf '%s\n' "$operator" >>"$tmp"
  )
  mv "$tmp" "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
}

set_image_version() {
  local tmp="$ENV_FILE.tmp.$$"
  (
    umask 077
    grep -v '^OPENVALENS_VERSION=' "$ENV_FILE" >"$tmp" || true
    printf 'OPENVALENS_VERSION=%s\n' "$(image_version)" >>"$tmp"
  )
  mv "$tmp" "$ENV_FILE"
}

# --- secrets -----------------------------------------------------------------

random_hex() { od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; }

# write_secret <dir> <name> <value>; never overwrites an existing secret.
# Layout (docs/self-hosting/install.md): secrets/ is 0700 (host-private); each service
# subdirectory is 0755 with 0444 files so the containers' non-root users can
# read their read-only mount even when host and container UIDs differ.
write_secret() {
  local file="$1/$2"
  [ -s "$file" ] && return 0
  (
    umask 022
    printf '%s\n' "$3" >"$file.tmp.$$"
  )
  chmod 0444 "$file.tmp.$$"
  mv "$file.tmp.$$" "$file"
}

generate_secrets() {
  install -d -m 0700 "$SECRETS_DIR"
  install -d -m 0755 "$SECRETS_DIR/server" "$SECRETS_DIR/postgres"
  chmod 0700 "$SECRETS_DIR"

  write_secret "$SECRETS_DIR/postgres" POSTGRES_PASSWORD "$(random_hex)"
  local pw
  pw="$(head -n 1 "$SECRETS_DIR/postgres/POSTGRES_PASSWORD")"
  write_secret "$SECRETS_DIR/server" DATABASE_URL "postgresql://postgres:$pw@postgres:5432/openhealth"
  write_secret "$SECRETS_DIR/server" BETTER_AUTH_SECRET "$(random_hex)"
  write_secret "$SECRETS_DIR/server" CRON_SECRET "$(random_hex)"
  write_secret "$SECRETS_DIR/server" TELEGRAM_WEBHOOK_SECRET "$(random_hex)"
  unset pw

  has_secret RESEND_API_KEY && return 0
  local key=""
  if [ "$INTERACTIVE" -eq 1 ]; then
    echo "Account setup and invitations send a one-time code by email (Resend)." >&2
    printf 'Resend API key (input hidden; press Enter to skip): ' >&2
    IFS= read -rs key || true
    echo >&2
  elif [ -n "${RESEND_API_KEY_SOURCE:-}" ]; then
    [ -r "$RESEND_API_KEY_SOURCE" ] || die "RESEND_API_KEY_SOURCE is not a readable file"
    key="$(head -n 1 "$RESEND_API_KEY_SOURCE")"
  fi
  if [ -n "$key" ]; then
    write_secret "$SECRETS_DIR/server" RESEND_API_KEY "$key"
  else
    warn "no Resend key: email is dry-run only, so the setup proof code cannot be delivered."
    warn "add it later to deploy/secrets/server/RESEND_API_KEY (mode 0444) and re-run install."
  fi
  unset key
}

# --- steps -------------------------------------------------------------------

validate_compose() {
  log "validating deploy/compose.yml"
  compose config --quiet || die "compose configuration is invalid"
  # Only Caddy may publish ports: Docker-published ports bypass host firewalls.
  local publishers
  publishers="$(compose config | awk '
    /^services:/ { in_services = 1; next }
    /^[^ ]/ { in_services = 0 }
    in_services && /^  [A-Za-z0-9_.-]+:$/ { service = $1; sub(":", "", service) }
    in_services && /^    ports:/ { print service }
  ')"
  [ "$publishers" = "caddy" ] || die "only caddy may publish ports (found: ${publishers:-none})"
  log "compose configuration is valid; only caddy publishes ports"
}

wait_for_server() {
  local state
  for _ in $(seq 1 60); do
    state="$(docker inspect --format '{{.State.Health.Status}}' "$(compose ps -q server 2>/dev/null)" 2>/dev/null || true)"
    [ "$state" = "healthy" ] && return 0
    sleep 5
  done
  return 1
}

start_chain() {
  # `up` runs postgres -> backup -> migrate -> server -> web -> caddy in order;
  # a failing one-shot step aborts the chain before `server` starts.
  if ! run compose up -d; then
    report_chain_failure
    exit 1
  fi
  if [ "$DRY_RUN" -eq 0 ]; then
    wait_for_server || {
      report_chain_failure
      exit 1
    }
  fi
}

report_chain_failure() {
  echo >&2
  warn "the stack did not start. The server is NOT running; existing backups are kept."
  warn "inspect: docker compose -f deploy/compose.yml logs backup migrate server"
  warn "list backups: docker compose -f deploy/compose.yml run --rm --no-deps --entrypoint ls backup -l /backups"
  warn "fix the cause, then re-run: deploy/setup.sh upgrade (it takes a fresh backup first)"
}

mint_token() {
  if [ "$DRY_RUN" -eq 1 ]; then
    run compose run --rm --no-deps -T --workdir /app migrate bash scripts/admission.sh mint --stdout --allow-remote
    log "[dry-run] would write the token to deploy/secrets/setup-token (mode 0600)"
    return 0
  fi
  local tmp="$TOKEN_FILE.tmp.$$"
  (
    umask 077
    : >"$tmp"
  )
  # The CLI prints only the token on stdout; it goes straight into a private file.
  if ! compose run --rm --no-deps -T --workdir /app migrate \
    bash scripts/admission.sh mint --stdout --allow-remote >"$tmp"; then
    rm -f "$tmp"
    warn "setup token not minted (an administrator may already exist)."
    return 1
  fi
  mv "$tmp" "$TOKEN_FILE"
  chmod 0600 "$TOKEN_FILE"
  log "setup token written to deploy/secrets/setup-token (valid 24 hours, single use)"
}

cmd_install() {
  preflight
  gather_config
  generate_secrets
  write_env
  validate_compose
  log "building images (this can take several minutes)"
  run compose build
  start_chain
  if [ -s "$TOKEN_FILE" ] && [ "$DRY_RUN" -eq 0 ]; then
    log "setup token already exists; run 'deploy/setup.sh mint-token' to replace it"
  else
    mint_token || true
  fi
  cat <<EOF

OpenValens is starting at: https://$DOMAIN
  1. Read the one-time setup token locally:  cat deploy/secrets/setup-token
     (never paste it into chat, tickets or logs)
  2. Open https://$DOMAIN/setup, enter the token and your email, then the
     emailed code. That account becomes the instance administrator and
     registration closes: everyone else joins by administrator invitation.
  3. Pre-migrate backups are plain, UNENCRYPTED pg_dump files in the
     'backups' volume. Encrypted backup/restore is pending (Issue #64).
EOF
  if [ "$DRY_RUN" -eq 1 ]; then log "[dry-run] nothing was changed"; fi
}

require_installed() {
  [ -f "$ENV_FILE" ] || die "deploy/.env not found; run 'deploy/setup.sh install' first"
  [ -s "$SECRETS_DIR/server/DATABASE_URL" ] || die "deploy/secrets is incomplete; run 'deploy/setup.sh install'"
}

cmd_upgrade() {
  preflight
  if [ "$DRY_RUN" -eq 1 ]; then
    # Stage a throwaway install so the compose file can be validated.
    INTERACTIVE=0
    OPENVALENS_DOMAIN="${OPENVALENS_DOMAIN:-health.example.org}"
    ACME_EMAIL="${ACME_EMAIL:-ops@example.org}"
    EMAIL_FROM="${EMAIL_FROM:-OpenValens <noreply@example.org>}"
    gather_config
    generate_secrets 2>/dev/null
    write_env
  fi
  require_installed
  set_image_version
  validate_compose
  log "building images for $(image_version)"
  run compose build
  # Stop the old server first so it never serves a half-migrated database.
  run compose stop caddy web server
  start_chain
  [ "$DRY_RUN" -eq 1 ] && log "[dry-run] nothing was changed" && return 0
  log "upgrade complete: https://$(env_get OPENVALENS_DOMAIN)"
}

cmd_mint_token() {
  preflight
  if [ "$DRY_RUN" -eq 0 ]; then
    require_installed
  fi
  mint_token
}

case "$command" in
  install) cmd_install ;;
  upgrade) cmd_upgrade ;;
  mint-token) cmd_mint_token ;;
  help | -h | --help | "") usage ;;
  *)
    echo "setup: unknown command (see deploy/setup.sh --help)" >&2
    exit 2
    ;;
esac
