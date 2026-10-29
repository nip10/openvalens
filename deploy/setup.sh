#!/usr/bin/env bash
#
# OpenValens self-host installer and upgrader (Issue #63).
#
#   deploy/setup.sh install    [--dry-run] [--non-interactive] [--reconfigure]
#   deploy/setup.sh upgrade    [--dry-run]
#   deploy/setup.sh mint-token [--dry-run]
#   deploy/setup.sh catalogs   --source fdc|fdc-branded|off|all [--dry-run] [--non-interactive]
#   deploy/setup.sh backup     now|list|verify [<id>] [--quick] [--key-file <path>]
#                              |export <id> <dir>|import <dir>
#                              |pull [<id>|latest]|cleanup [--force]|undo-restore <stamp>
#   deploy/setup.sh restore    <id> [--force] [--non-interactive] [--no-build]
#
# install     Asks for the domain and email settings, generates every secret
#             into deploy/secrets/ (never prints one), writes deploy/.env, builds
#             the pinned images, starts the stack behind Caddy (HTTPS) and mints
#             the one-time setup token into deploy/secrets/setup-token.
#             Re-running it keeps existing secrets, the settings already in
#             deploy/.env and every key you added there by hand.
# upgrade     Run after `git checkout <new tag>`: refreshes OPENVALENS_VERSION,
#             adds every setting install manages that deploy/.env lacks (with
#             its default; existing values and your own lines are never
#             changed), rebuilds the images, stops the server, then starts the
#             chain postgres -> pre-migrate backup -> migrate -> server. A
#             failed backup or migration leaves the server stopped and keeps
#             every backup.
# mint-token  Re-mints the setup token (it expires after 24 hours). Minting
#             again invalidates the previous token. Refused once an
#             administrator exists.
# catalogs    Downloads public food catalogs into deploy/catalogs/ and imports
#             them in a one-off server container on the internal db network.
#             Opt-in, as the downloads are large. Re-run it to update: unchanged
#             files are neither downloaded nor imported again.
#             --source takes a comma-separated list:
#               fdc          USDA Foundation + SR Legacy (~14 MB), generic foods
#               fdc-branded  USDA Branded (~200 MB), US packaged foods, barcodes
#               off          Open Food Facts (~13 GB), worldwide products, barcodes
#               all          all of the above
#             Sizes, time and licences: docs/self-hosting/food-catalogs.md.
# backup      Encrypted backups of the database and stored files (Issue #64).
#             A daily backup runs on its own (OPENVALENS_BACKUP_HOUR, UTC) and
#             one is taken before every migration. Every backup is encrypted
#             to deploy/secrets/backup/age-identity: keep a copy of that file
#             off this server, or the backups cannot be restored.
#               now           take a backup now (also verified)
#               list          list the backups in the 'backups' volume
#               verify [id]   decrypt, check every checksum and restore into a
#                             scratch database (default: the newest backup);
#                             --quick skips the scratch restore
#               verify [id] --key-file <path>
#                             check another copy of the backup key (your
#                             escrowed one) against a backup: it must decrypt
#                             every file. The key is read by this script,
#                             never printed, and the check is not recorded as
#                             a verify of the backup
#               export <id> <dir>  copy a backup (still encrypted) to <dir>
#               import <dir>  copy a backup directory into the volume
#               pull [id]     list the off-site backups, or copy one (or
#                             "latest") from the off-site bucket into the volume
#               cleanup       list what restores kept (and legacy unencrypted
#                             dumps); --force deletes them
#               undo-restore <stamp>  put back the database and files a
#                             restore kept; the current ones are kept in turn,
#                             the erasure ledger is re-applied (asks to
#                             confirm; --force skips)
# restore     Builds the checked-out version (for a rollback: check out the
#             previous version first), verifies the backup, stops the app,
#             keeps the current database (renamed openvalens_pre_restore_<stamp>)
#             and stored files, restores both, runs migrations, re-applies the
#             erasure ledger so people who deleted their data stay deleted,
#             then starts the stack. Asks for confirmation; --non-interactive
#             needs --force.
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
#                    OPENVALENS_SITE_SCHEME=http (any mode) serves plain HTTP
#                    for a proxy in front that terminates TLS.
#                    OPENVALENS_HTTP_PORT and OPENVALENS_HTTPS_PORT (any mode)
#                    set the ports Caddy publishes, as <port> or <IP>:<port>
#                    (default 80 and 443); install keeps them in deploy/.env.
#                    catalogs: start without asking to confirm the downloads.
# --reconfigure      install only: ask for (or, with --non-interactive, read) the
#                    domain and email settings again instead of reusing the ones
#                    in deploy/.env. Secrets and every other key are kept.
# --force            restore: skip the confirmation prompt (required with
#                    --non-interactive). backup cleanup: delete what it lists.
# --quick            backup verify: skip the scratch-database restore.
# --key-file <path>  backup verify: check this copy of the backup key instead
#                    of deploy/secrets/backup/age-identity.
# --new-backup-key   install/upgrade: generate a new backup key although the
#                    'backups' volume holds backups and the key file is missing.
#                    Those backups then stay unreadable until the old key is put
#                    back; normally restore your escrowed key instead.
# --no-build         restore: use the images OPENVALENS_VERSION in deploy/.env
#                    names as they are, instead of building the checked-out
#                    version (the rollback rehearsal uses pre-built images).
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
FORCE=0
QUICK=0
NO_BUILD=0
NEW_BACKUP_KEY=0
CATALOG_SOURCES=""
KEY_FILE=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    --quick) QUICK=1 ;;
    --no-build) NO_BUILD=1 ;;
    --new-backup-key) NEW_BACKUP_KEY=1 ;;
    --source)
      [ "$command" = catalogs ] && [ $# -gt 1 ] || {
        echo "setup: --source needs a value and applies to catalogs only (see deploy/setup.sh --help)" >&2
        exit 2
      }
      CATALOG_SOURCES="$2"
      shift
      ;;
    --key-file)
      [ "$command" = backup ] && [ $# -gt 1 ] || {
        echo "setup: --key-file needs a path and applies to 'backup verify' only" >&2
        exit 2
      }
      KEY_FILE="$2"
      shift
      ;;
    --non-interactive) INTERACTIVE=0 ;;
    --reconfigure) RECONFIGURE=1 ;;
    -h | --help) command=help ;;
    -*)
      # Never echo the rejected value: it may be a pasted secret.
      echo "setup: unknown option (see deploy/setup.sh --help)" >&2
      exit 2
      ;;
    *)
      case "$command" in
        backup | restore) ARGS+=("$1") ;;
        *)
          echo "setup: unexpected argument (see deploy/setup.sh --help)" >&2
          exit 2
          ;;
      esac
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

usage() { sed -n '3,/^set -euo pipefail/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }

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
MANAGED_KEYS="OPENVALENS_DOMAIN OPENVALENS_SITE_SCHEME ACME_EMAIL EMAIL_FROM OPENVALENS_VERSION
  OPENVALENS_HTTP_PORT OPENVALENS_HTTPS_PORT
  OPENVALENS_PRE_MIGRATE_BACKUP OPENVALENS_BACKUP_RETAIN OPENVALENS_BACKUP_DAILY_RETAIN
  OPENVALENS_BACKUP_HOUR OPENVALENS_BACKUP_SCHEDULE OPENVALENS_BACKUP_HOST_ID STORAGE_PROVIDER
  STORAGE_S3_ENDPOINT STORAGE_S3_REGION STORAGE_S3_BUCKET
  STORAGE_S3_FORCE_PATH_STYLE STORAGE_S3_SSE BACKUP_OFFSITE_S3_ENDPOINT
  BACKUP_OFFSITE_S3_REGION BACKUP_OFFSITE_S3_BUCKET BACKUP_OFFSITE_S3_PREFIX
  BACKUP_OFFSITE_S3_FORCE_PATH_STYLE COMPOSE_PROFILES"
# Optional secrets: `<KEY>_FILE` is set exactly when deploy/secrets/server/<KEY>
# exists, so the stack never points at a missing file.
SECRET_FILE_KEYS="RESEND_API_KEY EMAIL_AUDIT_BCC AI_API_KEY ANTHROPIC_API_KEY
  TELEGRAM_BOT_TOKEN STORAGE_S3_ACCESS_KEY_ID STORAGE_S3_SECRET_ACCESS_KEY
  OIDC_CLIENT_SECRET GOOGLE_CLIENT_SECRET APPLE_PRIVATE_KEY
  WEARABLES_OURA_CLIENT_SECRET WEARABLES_WHOOP_CLIENT_SECRET
  WEARABLES_POLAR_CLIENT_SECRET WEARABLES_POLAR_WEBHOOK_SECRET
  WEARABLES_WITHINGS_CLIENT_SECRET WEARABLES_GOOGLE_HEALTH_CLIENT_SECRET
  POSTHOG_PROJECT_TOKEN"
OPERATOR_MARKER="# --- Your settings: deploy/setup.sh install keeps everything below ---"

# Default of a managed key that deploy/.env does not set yet. The domain and
# email settings have none (install asks for them), and OPENVALENS_VERSION is
# the checkout's.
managed_default() {
  case "$1" in
    OPENVALENS_SITE_SCHEME) echo https ;;
    OPENVALENS_HTTP_PORT) echo 80 ;;
    OPENVALENS_HTTPS_PORT) echo 443 ;;
    OPENVALENS_PRE_MIGRATE_BACKUP) echo pg_dump ;;
    OPENVALENS_BACKUP_RETAIN) echo 10 ;;
    OPENVALENS_BACKUP_DAILY_RETAIN) echo 14 ;;
    OPENVALENS_BACKUP_HOUR) echo 3 ;;
    OPENVALENS_BACKUP_SCHEDULE) echo on ;;
    OPENVALENS_BACKUP_HOST_ID) od -An -tx1 -N8 /dev/urandom | tr -d ' \n' ;;
    STORAGE_PROVIDER) echo local ;;
    STORAGE_S3_FORCE_PATH_STYLE | BACKUP_OFFSITE_S3_FORCE_PATH_STYLE) echo false ;;
    STORAGE_S3_SSE) echo AES256 ;;
    BACKUP_OFFSITE_S3_PREFIX) echo openvalens ;;
    COMPOSE_PROFILES) offsite_profile ;;
  esac
}

# The value deploy/.env sets for a managed key, or its default.
managed_value() { env_get "$1" | grep . || managed_default "$1"; }

# A setting as Compose resolves it: the environment first, then deploy/.env,
# then the default.
effective_setting() {
  local value="${!1:-}"
  [ -n "$value" ] || value="$(env_get "$1")"
  printf '%s' "${value:-$2}"
}

# A published port: <port>, or <IPv4>:<port> / [<IPv6>]:<port> to bind one
# address (for a proxy on this host: a private or loopback address).
valid_port_binding() {
  printf '%s' "$1" | grep -Eq '^((([0-9]{1,3}\.){3}[0-9]{1,3}|\[[0-9A-Fa-f:.]+\]):)?[0-9]{1,5}$'
}

# True when the binding listens on every interface of the host.
binds_all_interfaces() {
  case "$1" in
    *:*) case "$1" in 0.0.0.0:* | "[::]:"*) return 0 ;; *) return 1 ;; esac ;;
    *) return 0 ;;
  esac
}

describe_binding() {
  if binds_all_interfaces "$1"; then printf 'port %s on all interfaces' "${1##*:}"; else printf '%s' "$1"; fi
}

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

# Off-site copy (Issue #64): configured when a bucket is set and both credential
# files exist. Checked by name and size only; the values are never read here.
offsite_configured() {
  [ -n "$(env_get BACKUP_OFFSITE_S3_BUCKET)" ] || return 1
  local key
  for key in BACKUP_OFFSITE_S3_ACCESS_KEY_ID BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY; do
    [ -s "$SECRETS_DIR/backup/$key" ] && continue
    [ "$DRY_RUN" -eq 1 ] && [ -s "$DEPLOY_DIR/secrets/backup/$key" ] && continue
    return 1
  done
}

offsite_profile() {
  if offsite_configured; then
    printf 'offsite'
  elif [ -n "$(env_get BACKUP_OFFSITE_S3_BUCKET)" ]; then
    warn "BACKUP_OFFSITE_S3_BUCKET is set but deploy/secrets/backup/BACKUP_OFFSITE_S3_ACCESS_KEY_ID or ..._SECRET_ACCESS_KEY is missing: off-site copy stays off"
  fi
}

write_env() {
  local key value file_lines="" operator tmp
  check_port_settings
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
# https (default): Caddy gets the certificate. http: a proxy in front terminates TLS.
OPENVALENS_SITE_SCHEME=${OPENVALENS_SITE_SCHEME:-$(managed_value OPENVALENS_SITE_SCHEME)}
# Ports Caddy publishes: <port> (every interface) or <IP>:<port>. Behind a proxy
# on this host, bind a private address, e.g. 127.0.0.1:8080
# (docs/self-hosting/install.md#behind-a-tls-terminating-proxy).
OPENVALENS_HTTP_PORT=${OPENVALENS_HTTP_PORT:-$(managed_value OPENVALENS_HTTP_PORT)}
OPENVALENS_HTTPS_PORT=${OPENVALENS_HTTPS_PORT:-$(managed_value OPENVALENS_HTTPS_PORT)}
ACME_EMAIL=$ACME
EMAIL_FROM=$FROM
# Image tag for the locally built server/web images (the checked-out version).
OPENVALENS_VERSION=$(image_version)
# Backups (docs/self-hosting/backup.md), encrypted to deploy/secrets/backup/age-identity:
# keep a copy of that file off this server. Pre-migrate backup: pg_dump (default,
# encrypted database + files) | hook | none. Daily backup at OPENVALENS_BACKUP_HOUR (UTC).
OPENVALENS_PRE_MIGRATE_BACKUP=$(managed_value OPENVALENS_PRE_MIGRATE_BACKUP)
OPENVALENS_BACKUP_RETAIN=$(managed_value OPENVALENS_BACKUP_RETAIN)
OPENVALENS_BACKUP_DAILY_RETAIN=$(managed_value OPENVALENS_BACKUP_DAILY_RETAIN)
OPENVALENS_BACKUP_HOUR=$(managed_value OPENVALENS_BACKUP_HOUR)
# off: no daily backups (you back up yourself, e.g. with a hook); readiness then
# never reports them stale. Pre-migrate backups follow OPENVALENS_PRE_MIGRATE_BACKUP.
OPENVALENS_BACKUP_SCHEDULE=$(managed_value OPENVALENS_BACKUP_SCHEDULE)
# This host's folder in the off-site bucket; generated once. Delete this line
# when you copy deploy/.env to a NEW host, so it gets its own folder.
OPENVALENS_BACKUP_HOST_ID=$(managed_value OPENVALENS_BACKUP_HOST_ID)
# Object storage: local (default, the "storage" volume) | s3. See docs/storage.md.
STORAGE_PROVIDER=$(managed_value STORAGE_PROVIDER)
STORAGE_S3_ENDPOINT=$(env_get STORAGE_S3_ENDPOINT)
STORAGE_S3_REGION=$(env_get STORAGE_S3_REGION)
STORAGE_S3_BUCKET=$(env_get STORAGE_S3_BUCKET)
STORAGE_S3_FORCE_PATH_STYLE=$(managed_value STORAGE_S3_FORCE_PATH_STYLE)
STORAGE_S3_SSE=$(managed_value STORAGE_S3_SSE)
# Optional off-site copy of the encrypted backups to an S3-compatible bucket
# (docs/self-hosting/backup.md#off-site-copy). The keys are files:
# deploy/secrets/backup/BACKUP_OFFSITE_S3_ACCESS_KEY_ID and ..._SECRET_ACCESS_KEY.
BACKUP_OFFSITE_S3_ENDPOINT=$(env_get BACKUP_OFFSITE_S3_ENDPOINT)
BACKUP_OFFSITE_S3_REGION=$(env_get BACKUP_OFFSITE_S3_REGION)
BACKUP_OFFSITE_S3_BUCKET=$(env_get BACKUP_OFFSITE_S3_BUCKET)
BACKUP_OFFSITE_S3_PREFIX=$(managed_value BACKUP_OFFSITE_S3_PREFIX)
BACKUP_OFFSITE_S3_FORCE_PATH_STYLE=$(managed_value BACKUP_OFFSITE_S3_FORCE_PATH_STYLE)
# Compose profiles: "offsite" exactly when the off-site copy is configured.
COMPOSE_PROFILES=$(offsite_profile)
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

# Replaces OPENVALENS_VERSION where it is (above the operator marker in a file
# install wrote), so the operator's section is never touched.
set_image_version() {
  local tmp="$ENV_FILE.tmp.$$"
  (
    umask 077
    awk -v line="OPENVALENS_VERSION=$(image_version)" -v marker="$OPERATOR_MARKER" '
      /^OPENVALENS_VERSION=/ { if (!done) print line; done = 1; next }
      $0 == marker && !done { print line; done = 1 }
      { print }
      END { if (!done) print line }
    ' "$ENV_FILE" >"$tmp"
  )
  mv "$tmp" "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
}

# upgrade: writes every managed key deploy/.env lacks (a key a newer version
# added, such as the backup settings), with its default, just above the
# operator marker. Existing lines, including the operator's, are untouched.
add_missing_managed_keys() {
  local key value added="" tmp="$ENV_FILE.tmp.$$"
  (
    umask 077
    : >"$tmp.add"
  )
  for key in $MANAGED_KEYS; do
    case "$key" in
      # Asked by install, or refreshed by upgrade itself.
      OPENVALENS_DOMAIN | ACME_EMAIL | EMAIL_FROM | OPENVALENS_VERSION) continue ;;
    esac
    grep -q "^$key=" "$ENV_FILE" && continue
    printf '%s=%s\n' "$key" "$(managed_default "$key")" >>"$tmp.add"
    added="$added $key"
  done
  for key in $SECRET_FILE_KEYS; do
    grep -q "^${key}_FILE=" "$ENV_FILE" && continue
    value=""
    if has_secret "$key"; then value="/run/secrets/$key"; fi
    printf '%s_FILE=%s\n' "$key" "$value" >>"$tmp.add"
    added="$added ${key}_FILE"
  done
  if [ -z "$added" ]; then
    rm -f "$tmp.add"
    return 0
  fi
  (
    umask 077
    awk -v marker="$OPERATOR_MARKER" -v add="$tmp.add" '
      function insert(  line) { while ((getline line < add) > 0) print line; done = 1 }
      $0 == marker && !done { insert() }
      { print }
      END { if (!done) insert() }
    ' "$ENV_FILE" >"$tmp"
  )
  rm -f "$tmp.add"
  mv "$tmp" "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
  # Key names only, never values.
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] would add to deploy/.env, with their defaults:$added"
  else
    log "added to deploy/.env, with their defaults:$added"
  fi
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
  write_secret "$SECRETS_DIR/server" DATABASE_URL "postgresql://postgres:$pw@postgres:5432/openvalens"
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

# --- backup key (Issue #64) ---------------------------------------------------

BACKUP_KEY="$SECRETS_DIR/backup/age-identity"
BACKUP_KEY_CREATED=0

# Generates the age identity that encrypts every backup, once, with age-keygen
# from the backup image (the host needs no age install). Never printed. Losing
# it makes every backup unreadable, so the operator must copy it off the host.
ensure_backup_key() {
  install -d -m 0700 "$SECRETS_DIR"
  install -d -m 0755 "$SECRETS_DIR/backup"
  if [ -s "$BACKUP_KEY" ]; then return 0; fi
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] would generate the backup key into deploy/secrets/backup/age-identity"
    return 0
  fi
  # A missing key next to existing backups is almost always a lost or not yet
  # restored key: a new one would silently leave every backup unreadable.
  if [ "$NEW_BACKUP_KEY" -eq 0 ] && compose run --rm --no-deps -T backup-tools has-backups >/dev/null 2>&1; then
    die "deploy/secrets/backup/age-identity is missing but the 'backups' volume holds encrypted backups. Put your escrowed key back there (mode 0444) and re-run; only if that key is lost for good, re-run with --new-backup-key (the old backups stay unreadable)."
  fi
  local tmp="$BACKUP_KEY.tmp.$$"
  (
    umask 022
    : >"$tmp"
  )
  if ! compose run --rm --no-deps -T --entrypoint age-keygen backup-tools >"$tmp" 2>/dev/null ||
    ! grep -q '^AGE-SECRET-KEY-' "$tmp"; then
    rm -f "$tmp"
    die "could not generate the backup key"
  fi
  chmod 0444 "$tmp"
  mv "$tmp" "$BACKUP_KEY"
  BACKUP_KEY_CREATED=1
  log "backup key generated: deploy/secrets/backup/age-identity (never printed)"
}

backup_key_notice() {
  cat <<EOF

IMPORTANT: every backup is encrypted with deploy/secrets/backup/age-identity.
  Copy that file OFF this server now (password manager, encrypted USB drive,
  another machine) and guard it like the data itself. If this server is lost
  together with that file, no backup can ever be restored. Copy the file
  (scp, install -m 0400) instead of printing it; never paste it into chat,
  tickets or logs. Once a backup exists ('deploy/setup.sh backup list'),
  check that the copy decrypts it:
    deploy/setup.sh backup verify --key-file <path to the copy>
EOF
}

# --- steps -------------------------------------------------------------------

# Port settings from the environment or deploy/.env. Never echoes a value.
check_port_settings() {
  local key
  for key in OPENVALENS_HTTP_PORT OPENVALENS_HTTPS_PORT; do
    valid_port_binding "$(effective_setting "$key" 0)" ||
      die "$key must be <port> or <IP>:<port> (for example 8080 or 127.0.0.1:8080)"
  done
}

# Prints the host addresses Caddy will publish, and refuses an http-mode
# install whose unused HTTPS port would still be published on every interface.
check_published_ports() {
  local http https scheme
  check_port_settings
  http="$(effective_setting OPENVALENS_HTTP_PORT 80)"
  https="$(effective_setting OPENVALENS_HTTPS_PORT 443)"
  scheme="$(effective_setting OPENVALENS_SITE_SCHEME https)"
  log "caddy publishes HTTP on $(describe_binding "$http") (to :80/tcp) and HTTPS on $(describe_binding "$https") (to :443/tcp+udp)"
  [ "$scheme" = http ] || return 0
  if binds_all_interfaces "$https"; then
    die "OPENVALENS_SITE_SCHEME=http, but Caddy's HTTPS port is still published, on every interface ($(describe_binding "$https")). It serves nothing in http mode and collides with a proxy on this host that owns 443. Set OPENVALENS_HTTPS_PORT=127.0.0.1:<free port> in deploy/.env (or in the environment for install), and bind OPENVALENS_HTTP_PORT to the address your proxy forwards to; see docs/self-hosting/install.md#behind-a-tls-terminating-proxy"
  fi
  if binds_all_interfaces "$http"; then
    warn "OPENVALENS_SITE_SCHEME=http and HTTP is published on every interface: anyone who reaches $(describe_binding "$http") bypasses the proxy and talks to OpenValens without TLS. Prefer OPENVALENS_HTTP_PORT=<private IP>:<port>."
  fi
}

validate_compose() {
  log "validating deploy/compose.yml"
  case "$(effective_setting OPENVALENS_SITE_SCHEME https)" in
    https | http) ;;
    *) die "OPENVALENS_SITE_SCHEME must be https (default) or http" ;;
  esac
  check_published_ports
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
  warn "list backups: deploy/setup.sh backup list"
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
  ensure_backup_key
  start_chain
  if [ -s "$TOKEN_FILE" ] && [ "$DRY_RUN" -eq 0 ]; then
    log "setup token already exists; run 'deploy/setup.sh mint-token' to replace it"
  else
    mint_token || true
  fi
  cat <<EOF

OpenValens is starting at: https://$DOMAIN
  1. The one-time setup token is in deploy/secrets/setup-token. Copy the
     file to your own computer (scp) or open it in a private session
     (less deploy/secrets/setup-token); never paste it into chat, tickets
     or logs.
  2. Open https://$DOMAIN/setup, enter the token and your email, then the
     emailed code. That account becomes the instance administrator and
     registration closes: everyone else joins by administrator invitation.
  3. Encrypted backups of the database and stored files run daily and
     before every upgrade ('deploy/setup.sh backup list'). Copy the backup
     key file deploy/secrets/backup/age-identity OFF this server (scp, or
     install -m 0400 onto removable media; never print it): without it no
     backup can be restored. Check the copy with
     'deploy/setup.sh backup verify --key-file <copy>' once a backup exists
     (docs/self-hosting/backup.md#the-backup-key).
  4. The food catalogs start EMPTY: food search finds only members' own
     foods and barcode scans miss. Import the public catalogs (large,
     opt-in downloads; see docs/self-hosting/food-catalogs.md):
       deploy/setup.sh catalogs --source fdc     # ~14 MB, generic foods
       deploy/setup.sh catalogs --source off     # ~13 GB, product barcodes
EOF
  if [ "$BACKUP_KEY_CREATED" -eq 1 ]; then backup_key_notice; fi
  if [ "$DRY_RUN" -eq 1 ]; then log "[dry-run] nothing was changed"; fi
}

require_installed() {
  [ -f "$ENV_FILE" ] || die "deploy/.env not found; run 'deploy/setup.sh install' first"
  [ -s "$SECRETS_DIR/server/DATABASE_URL" ] || die "deploy/secrets is incomplete; run 'deploy/setup.sh install'"
}

cmd_upgrade() {
  preflight
  if [ "$DRY_RUN" -eq 1 ]; then
    # Stage throwaway secrets (and, without an install, a throwaway
    # deploy/.env) so the compose file can be validated. An existing
    # deploy/.env is previewed as it is, so the keys upgrade would add show.
    INTERACTIVE=0
    generate_secrets 2>/dev/null
    if [ ! -f "$ENV_FILE" ]; then
      OPENVALENS_DOMAIN="${OPENVALENS_DOMAIN:-health.example.org}"
      ACME_EMAIL="${ACME_EMAIL:-ops@example.org}"
      EMAIL_FROM="${EMAIL_FROM:-OpenValens <noreply@example.org>}"
      gather_config
      write_env
    fi
  fi
  require_installed
  set_image_version
  add_missing_managed_keys
  validate_compose
  log "building images for $(image_version)"
  run compose build
  ensure_backup_key
  # Stop the old server first so it never serves a half-migrated database.
  stop_scheduler
  run compose stop caddy web server
  start_chain
  [ "$DRY_RUN" -eq 1 ] && log "[dry-run] nothing was changed" && return 0
  log "upgrade complete: https://$(env_get OPENVALENS_DOMAIN)"
  if [ "$BACKUP_KEY_CREATED" -eq 1 ]; then backup_key_notice; fi
}

cmd_mint_token() {
  preflight
  if [ "$DRY_RUN" -eq 0 ]; then
    require_installed
  fi
  mint_token
}

# --- food catalogs -------------------------------------------------------------

# Downloaded artifacts stay here, so a re-run skips unchanged files and the
# OFF-derived tables can be regenerated from the same dump (ODbL 4.6b).
# Git-ignored and excluded from the image build context.
CATALOG_DIR="$DEPLOY_DIR/catalogs"
# USDA FoodData Central releases are immutable, dated files; bump deliberately.
FDC_BASE_URL="https://fdc.nal.usda.gov/fdc-datasets"
FDC_RELEASE="2026-04-30"
FDC_SR_LEGACY_RELEASE="2018-04"
# Open Food Facts publishes a new full dump every day under one URL.
OFF_URL="https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz"
OFF_FILE="openfoodfacts-products.jsonl.gz"

parse_catalog_sources() {
  CATALOG_FDC=0
  CATALOG_FDC_BRANDED=0
  CATALOG_OFF=0
  if [ -z "$CATALOG_SOURCES" ]; then
    echo "setup: catalogs needs --source fdc, fdc-branded, off or all (comma-separated)" >&2
    exit 2
  fi
  local item items
  IFS=, read -r -a items <<<"$CATALOG_SOURCES"
  for item in "${items[@]}"; do
    case "$item" in
      fdc) CATALOG_FDC=1 ;;
      fdc-branded) CATALOG_FDC_BRANDED=1 ;;
      off) CATALOG_OFF=1 ;;
      all) CATALOG_FDC=1 CATALOG_FDC_BRANDED=1 CATALOG_OFF=1 ;;
      *)
        # Never echo the rejected value.
        echo "setup: unknown catalog source (use fdc, fdc-branded, off or all)" >&2
        exit 2
        ;;
    esac
  done
}

catalog_notice() {
  echo
  echo "Food catalogs are imported into this instance's database and shown with"
  echo "their attribution. Sizes and times are approximate."
  if [ "$CATALOG_FDC" -eq 1 ] || [ "$CATALOG_FDC_BRANDED" -eq 1 ]; then
    cat <<EOF
  USDA FoodData Central: CC0 1.0 (public domain). Shown as "Source: U.S.
    Department of Agriculture, Agricultural Research Service. FoodData
    Central. fdc.nal.usda.gov".
EOF
  fi
  if [ "$CATALOG_FDC" -eq 1 ]; then
    echo "    fdc: Foundation $FDC_RELEASE + SR Legacy, ~14 MB, ~8,000 foods, about a minute."
  fi
  if [ "$CATALOG_FDC_BRANDED" -eq 1 ]; then
    echo "    fdc-branded: Branded $FDC_RELEASE, ~200 MB, US packaged foods with barcodes."
  fi
  if [ "$CATALOG_OFF" -eq 1 ]; then
    cat <<EOF
  Open Food Facts: database under the Open Database License (ODbL 1.0),
    contents under the Database Contents License (DbCL 1.0). The tables
    imported from it are ODbL too: if others use this instance, offer them
    under ODbL or point to how to regenerate them (DATA-LICENSES.md).
    off: ~13 GB download kept in deploy/catalogs/, millions of products.
    Importing takes tens of minutes to hours and grows the database by
    several GB: plan for at least 25 GB of free disk.
EOF
  fi
  echo
}

confirm_catalogs() {
  if [ "$INTERACTIVE" -eq 0 ] || [ "$DRY_RUN" -eq 1 ]; then return 0; fi
  local answer=""
  printf 'Download and import these catalogs now? [y/N] ' >&2
  IFS= read -r answer || true
  case "$answer" in
    y | Y | yes | YES) ;;
    *) die "cancelled; nothing was downloaded" ;;
  esac
}

# UTC date (YYYY-MM-DD) of a file's modification time: the upstream
# Last-Modified time, which curl --remote-time copies onto the download.
file_date() {
  date -u -r "$1" +%Y-%m-%d 2>/dev/null || date -u -d "@$(stat -c %Y "$1")" +%Y-%m-%d
}

# fetch_catalog <url> <file name> immutable|conditional
# Downloads into <file>.part, then renames it; an interrupted download resumes
# on the next run. An immutable (dated) release is never downloaded twice; a
# conditional one only when upstream is newer than the file already here.
fetch_catalog() {
  local url="$1" name="$2" mode="$3"
  local dest="$CATALOG_DIR/$2" part="$CATALOG_DIR/$2.part"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf 'setup: [dry-run] would download %s to deploy/catalogs/%s\n' "$url" "$name"
    return 0
  fi
  if [ -s "$part" ]; then
    log "resuming the download of $name"
    curl -fL --retry 5 --progress-bar --remote-time -C - -o "$part" "$url" ||
      die "downloading $name failed; re-run to resume (or delete deploy/catalogs/$name.part)"
  elif [ -s "$dest" ] && [ "$mode" = immutable ]; then
    log "$name is already downloaded"
    return 0
  elif [ -s "$dest" ]; then
    log "checking for a newer $name"
    curl -fL --retry 5 --progress-bar --remote-time -z "$dest" -o "$part" "$url" ||
      die "downloading $name failed; re-run to resume"
  else
    log "downloading $name"
    curl -fL --retry 5 --progress-bar --remote-time -o "$part" "$url" ||
      die "downloading $name failed; re-run to resume"
  fi
  if [ -s "$part" ]; then
    mv -f "$part" "$dest"
  else
    rm -f "$part"
    log "$name is up to date"
  fi
}

# import_catalog <fdc|off> <file name> <dataset> <version> <url>
# Runs the importer from the server image as a one-off `migrate` container: the
# same image and read-only DATABASE_URL secret file, on the internal db network
# only. The artifact directory is mounted read-only.
import_catalog() {
  log "importing $2 ($1 $3 $4)"
  run compose run --rm --no-deps -T --workdir /app \
    -v "$CATALOG_DIR:/catalogs:ro" migrate \
    bun --no-env-file scripts/food-catalog-import.ts --source "$1" \
    --file "/catalogs/$2" --dataset "$3" --version "$4" --source-url "$5" --allow-remote ||
    die "importing $2 failed; no rows were changed. Fix the cause and re-run."
}

cmd_catalogs() {
  parse_catalog_sources
  preflight
  command -v curl >/dev/null 2>&1 || die "curl is required to download the catalogs"
  if [ "$DRY_RUN" -eq 0 ]; then require_installed; fi
  catalog_notice
  confirm_catalogs

  # <dataset>:<release> for each FDC download.
  local fdc=() item name version
  if [ "$CATALOG_FDC" -eq 1 ]; then fdc+=("foundation:$FDC_RELEASE" "sr_legacy:$FDC_SR_LEGACY_RELEASE"); fi
  if [ "$CATALOG_FDC_BRANDED" -eq 1 ]; then fdc+=("branded:$FDC_RELEASE"); fi
  fdc_name() { printf 'FoodData_Central_%s_food_json_%s.zip' "${1%%:*}" "${1#*:}"; }

  if [ "$DRY_RUN" -eq 0 ]; then install -d -m 0755 "$CATALOG_DIR"; fi
  for item in ${fdc[@]+"${fdc[@]}"}; do
    name="$(fdc_name "$item")"
    fetch_catalog "$FDC_BASE_URL/$name" "$name" immutable
  done
  if [ "$CATALOG_OFF" -eq 1 ]; then fetch_catalog "$OFF_URL" "$OFF_FILE" conditional; fi

  log "starting postgres"
  run compose up -d --wait postgres
  for item in ${fdc[@]+"${fdc[@]}"}; do
    name="$(fdc_name "$item")"
    import_catalog fdc "$name" "${item%%:*}" "${item#*:}" "$FDC_BASE_URL/$name"
  done
  if [ "$CATALOG_OFF" -eq 1 ]; then
    version="<dump date>"
    if [ "$DRY_RUN" -eq 0 ]; then version="$(file_date "$CATALOG_DIR/$OFF_FILE")"; fi
    import_catalog off "$OFF_FILE" products "$version" "$OFF_URL"
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] nothing was downloaded or imported"
    return 0
  fi
  log "food catalogs are ready: search and barcode lookup use them right away"
}

# --- backups and restore (Issue #64) ------------------------------------------

BACKUP_ID_PATTERN='^[0-9]{8}T[0-9]{6}Z-(daily|pre-migrate|manual)$'
valid_backup_id() { printf '%s' "$1" | grep -Eq "$BACKUP_ID_PATTERN"; }

# The backup tool (deploy/backup/openvalens-backup.sh) in a one-off container on
# the internal db network. Its output is ids, sizes and counts only.
tools() { compose run --rm --no-deps -T backup-tools "$@"; }

require_backup_key() {
  [ -s "$BACKUP_KEY" ] ||
    die "no backup key at deploy/secrets/backup/age-identity: run 'deploy/setup.sh upgrade' to create one, or (to restore) put your escrowed copy there (mode 0444)"
}

# Waits for a running backup or verify (it holds the lock), then stops the
# scheduler, so an upgrade or restore never races or cuts one short.
stop_scheduler() {
  if [ "$DRY_RUN" -eq 1 ]; then
    run compose stop backup-scheduler
    return 0
  fi
  if [ -s "$BACKUP_KEY" ]; then
    tools wait-idle || die "a backup or verify is still running; try again later"
  fi
  compose stop backup-scheduler >/dev/null 2>&1 || true
}

start_postgres() { compose up -d --wait postgres >/dev/null 2>&1 || die "postgres did not start"; }

cmd_backup() {
  local sub="${ARGS[0]:-}" id dir stamp
  preflight
  [ "$DRY_RUN" -eq 0 ] || die "backup has no --dry-run"
  require_installed
  [ -z "$KEY_FILE" ] || [ "$sub" = verify ] || die "--key-file applies to 'backup verify' only"
  # Checking an escrowed copy needs no live key (it may be the one to put back).
  [ -n "$KEY_FILE" ] || require_backup_key
  case "$sub" in
    now)
      [ ${#ARGS[@]} -eq 1 ] || die "usage: deploy/setup.sh backup now"
      start_postgres
      id="$(tools create manual)" || die "the backup failed; see the messages above"
      tools verify "$id" || die "the new backup did not verify"
      log "backup $id written and verified (kept until you delete it; daily backups rotate)"
      if offsite_configured; then
        if compose run --rm --no-deps -T backup-offsite offsite-upload "$id"; then
          log "off-site copy of $id written"
        else
          warn "the off-site copy of $id failed; the backup-offsite service retries it"
        fi
        tools offsite-sync || true
      fi
      ;;
    pull)
      [ ${#ARGS[@]} -le 2 ] || die "usage: deploy/setup.sh backup pull [<id>|latest]"
      offsite_configured ||
        die "the off-site copy is not configured (BACKUP_OFFSITE_S3_* in deploy/.env and the two credential files)"
      if [ ${#ARGS[@]} -eq 1 ]; then
        compose run --rm --no-deps -T backup-offsite offsite-list
      else
        id="${ARGS[1]}"
        [ "$id" = latest ] || valid_backup_id "$id" || die "not a backup id (see deploy/setup.sh backup pull)"
        id="$(compose run --rm --no-deps -T backup-offsite offsite-pull "$id")" || die "the pull failed"
        start_postgres
        tools verify "$id" --quick || die "the pulled backup did not verify (wrong key?)"
        log "pulled $id; restore it with: deploy/setup.sh restore $id"
      fi
      ;;
    list)
      [ ${#ARGS[@]} -eq 1 ] || die "usage: deploy/setup.sh backup list"
      tools list
      ;;
    verify)
      [ ${#ARGS[@]} -le 2 ] || die "usage: deploy/setup.sh backup verify [<id>] [--quick]"
      id="${ARGS[1]:-latest}"
      [ "$id" = latest ] || valid_backup_id "$id" || die "not a backup id (see deploy/setup.sh backup list)"
      if [ -n "$KEY_FILE" ]; then
        # The key travels on stdin into a private temp file in a one-off
        # container: it is never an argument, a mount or printed. Checksums
        # and decrypting every file prove it; nothing is recorded, so a wrong
        # key never marks the backups as failing.
        [ -f "$KEY_FILE" ] && [ -r "$KEY_FILE" ] || die "--key-file is not a readable file"
        tools verify-key "$id" <"$KEY_FILE" ||
          die "the key file did not decrypt the backup; see the step above (nothing was changed)"
        log "the key file decrypts the backup: it is a working copy of the backup key"
        return 0
      fi
      start_postgres
      if [ "$QUICK" -eq 1 ]; then tools verify "$id" --quick; else tools verify "$id"; fi
      ;;
    export)
      [ ${#ARGS[@]} -eq 3 ] || die "usage: deploy/setup.sh backup export <id> <directory>"
      id="${ARGS[1]}"
      dir="${ARGS[2]}"
      valid_backup_id "$id" || die "not a backup id (see deploy/setup.sh backup list)"
      [ ! -e "$dir/$id" ] || die "the destination already holds this backup"
      install -d -m 0700 "$dir"
      tools export "$id" | tar -x -C "$dir" || die "the export failed"
      log "copied backup $id (still encrypted) to $dir/$id"
      log "store it off this server; the key is NOT in it (deploy/secrets/backup/age-identity)"
      ;;
    import)
      [ ${#ARGS[@]} -eq 2 ] || die "usage: deploy/setup.sh backup import <backup directory>"
      dir="${ARGS[1]%/}"
      id="$(basename "$dir")"
      valid_backup_id "$id" || die "the directory must be named like a backup id (<YYYYMMDDTHHMMSSZ>-<trigger>)"
      [ -f "$dir/SHA256SUMS" ] || die "not a backup directory (no SHA256SUMS)"
      COPYFILE_DISABLE=1 tar -C "$(dirname "$dir")" --no-xattrs -cf - "$id" | tools import "$id" ||
        die "the import failed"
      ;;
    cleanup)
      [ ${#ARGS[@]} -eq 1 ] || die "usage: deploy/setup.sh backup cleanup [--force]"
      start_postgres
      if [ "$FORCE" -eq 1 ]; then tools cleanup --force; else tools cleanup; fi
      ;;
    undo-restore)
      [ ${#ARGS[@]} -eq 2 ] || die "usage: deploy/setup.sh backup undo-restore <stamp>"
      stamp="${ARGS[1]}"
      printf '%s' "$stamp" | grep -Eq '^[0-9]{14}$' || die "the stamp is the 14 digits printed by restore"
      confirm_undo "$stamp"
      RESTORE_STAMP="$(date -u +%Y%m%d%H%M%S)"
      start_postgres
      log "stopping the app (caddy, web, server, backup-scheduler)"
      stop_scheduler
      compose stop caddy web server >/dev/null 2>&1 || true
      tools undo-restore "$stamp" "$RESTORE_STAMP" ||
        die "undo failed; nothing was swapped (stamp $RESTORE_STAMP). The server is stopped: deploy/setup.sh upgrade starts it"
      finish_restore "undo of restore $stamp"
      ;;
    *) die "usage: deploy/setup.sh backup now|list|verify|export|import|pull|cleanup|undo-restore (see --help)" ;;
  esac
}

confirm_restore() {
  if [ "$FORCE" -eq 1 ]; then return 0; fi
  [ "$INTERACTIVE" -eq 1 ] || die "a --non-interactive restore needs --force"
  local answer=""
  cat >&2 <<EOF

Restore replaces the database and the stored files with backup $1.
Everything written after that backup is lost from the live instance (the
current database and files are KEPT, renamed, until you run
'deploy/setup.sh backup cleanup --force'). People who deleted their data
after the backup stay deleted: the erasure ledger is re-applied.
EOF
  printf 'Type RESTORE to continue: ' >&2
  IFS= read -r answer || true
  [ "$answer" = RESTORE ] || die "cancelled; nothing was changed"
}

confirm_undo() {
  if [ "$FORCE" -eq 1 ]; then return 0; fi
  [ "$INTERACTIVE" -eq 1 ] || die "a --non-interactive undo-restore needs --force"
  local answer=""
  cat >&2 <<EOF

Undo puts back the database and stored files that restore $1 kept. Everything
written since that restore leaves the live instance (it is KEPT, renamed, and
can be brought back with another undo-restore). People who deleted their data
in the meantime stay deleted: the erasure ledger is re-applied.
EOF
  printf 'Type UNDO to continue: ' >&2
  IFS= read -r answer || true
  [ "$answer" = UNDO ] || die "cancelled; nothing was changed"
}

# After the database and files are swapped (restore or undo): migrate, merge
# the erasure ledgers of every kept database and backup, replay them, start.
finish_restore() {
  log "applying migrations"
  compose run --rm --no-deps -T migrate || restore_halted "migrations failed"
  echo # drizzle-kit ends its progress line without a newline
  log "merging the erasure ledgers"
  tools ledger-merge || restore_halted "merging the erasure ledger failed"
  log "re-applying the erasure ledger"
  compose run --rm --no-deps -T --workdir /app server \
    bun --no-env-file scripts/erasure-replay.ts --allow-remote ||
    restore_halted "re-applying the erasure ledger failed"
  tools record restore manual ok "${RESTORED_ID:-}" "$1" || true
  log "starting the stack (it takes a fresh pre-migrate backup)"
  start_chain
  cat <<EOF

Done: $1, at https://$(env_get OPENVALENS_DOMAIN)
  Kept from before (stamp $RESTORE_STAMP):
    database  openvalens_pre_restore_$RESTORE_STAMP
    files     .pre-restore-$RESTORE_STAMP in the 'storage' volume
  These copies hold live data and later erasures do NOT reach them: check the
  instance, then delete them with: deploy/setup.sh backup cleanup --force
  Or go back to them: deploy/setup.sh backup undo-restore $RESTORE_STAMP
EOF
}

restore_halted() {
  echo >&2
  warn "$1"
  warn "the server is NOT running. The database and stored files from before the"
  warn "restore are kept (stamp $RESTORE_STAMP). Fix the cause and run the restore again,"
  warn "or put everything back: deploy/setup.sh backup undo-restore $RESTORE_STAMP"
  exit 1
}

cmd_restore() {
  [ ${#ARGS[@]} -eq 1 ] || die "usage: deploy/setup.sh restore <backup id> (see deploy/setup.sh backup list)"
  local id="${ARGS[0]}"
  valid_backup_id "$id" || die "not a backup id (see deploy/setup.sh backup list)"
  preflight
  [ "$DRY_RUN" -eq 0 ] ||
    die "restore has no --dry-run; 'deploy/setup.sh backup verify <id>' checks a backup without changing anything"
  require_installed
  require_backup_key
  if [ "$NO_BUILD" -eq 0 ]; then
    # The restored database is migrated, and the ledger replayed, by the
    # checked-out version: for a rollback that is the previous release.
    set_image_version
    validate_compose
    log "building images for $(image_version)"
    compose build || die "building the images failed; nothing was changed"
  fi
  start_postgres
  log "verifying $id before changing anything (decrypt, checksums, scratch restore)"
  tools verify "$id" || die "backup $id did not verify; nothing was changed"
  confirm_restore "$id"

  RESTORE_STAMP="$(date -u +%Y%m%d%H%M%S)"
  RESTORED_ID="$id"
  log "stopping the app (caddy, web, server, backup-scheduler); restore stamp $RESTORE_STAMP"
  stop_scheduler
  compose stop caddy web server >/dev/null 2>&1 || true
  local status=0
  tools restore-db "$id" "$RESTORE_STAMP" || status=$?
  case "$status" in
    0) ;;
    2)
      warn "the restore failed (stamp $RESTORE_STAMP) and was rolled back: see the lines above for what was put back."
      warn "the server is stopped; start it again with: deploy/setup.sh upgrade"
      exit 1
      ;;
    3)
      warn "the restore failed (stamp $RESTORE_STAMP) and the rollback is INCOMPLETE: see the lines above."
      warn "do not start the server; the previous database is openvalens_pre_restore_$RESTORE_STAMP,"
      warn "the previous files are .pre-restore-$RESTORE_STAMP in the storage volume."
      exit 1
      ;;
    *)
      warn "the restore did not start (stamp $RESTORE_STAMP); nothing was swapped. See the lines above."
      warn "the server is stopped; start it again with: deploy/setup.sh upgrade"
      exit 1
      ;;
  esac
  finish_restore "restored backup $id"
}

case "$command" in
  install) cmd_install ;;
  upgrade) cmd_upgrade ;;
  mint-token) cmd_mint_token ;;
  catalogs) cmd_catalogs ;;
  backup) cmd_backup ;;
  restore) cmd_restore ;;
  help | -h | --help | "") usage ;;
  *)
    echo "setup: unknown command (see deploy/setup.sh --help)" >&2
    exit 2
    ;;
esac
