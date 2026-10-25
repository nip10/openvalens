# Deployment

Last updated: 2026-10-06

> This document mirrors the structure of `anchovy/docs/deployment.md` for the
> OpenValens stack (Hono + oRPC server in `apps/server`, TanStack web in
> `apps/web`). The readiness probe, cron schedule and bearer-secret guard
> described here were implemented in Issue #11.

## 1. Overview

> **Self-hosting on your own server?** Use the supported Docker Compose install
> in [docs/self-hosting/](self-hosting/README.md) (`deploy/setup.sh`): Caddy/HTTPS,
> generated secrets, setup token, and backup-gated automatic migrations. This
> document covers platform (Coolify/Dokploy) deployments and operations
> reference.

This repo runs two deployable services:

- `apps/server` — Hono + oRPC API on port `3000` (`/rpc`, `/api-reference`,
  `/api/auth/*`).
- `apps/web` — static/TanStack web app served on port `80` (proxied to `3001`
  locally by `docker-compose.yml`).

Provision PostgreSQL separately (managed by the platform or external); the app
containers do **not** run Postgres in production.

## 2. Recommended Hetzner shape

| Component | Recommendation                                              |
| --------- | ----------------------------------------------------------- |
| VPS       | Hetzner Cloud CX21 or larger                                |
| CPU / RAM | 2 vCPU / 4 GB minimum                                       |
| Disk      | 40 GB+ SSD                                                  |
| Network   | Public IPv4 + private network if DB is on the same platform |

If you expect heavier ingestion, AI features, or frequent cron activity, size up
to 4 vCPU / 8 GB.

## 3. Coolify/Dokploy setup

Platform build settings:

| Setting                | Value                    |
| ---------------------- | ------------------------ |
| Build pack / type      | Dockerfile               |
| Build context          | Repository root          |
| Server Dockerfile path | `apps/server/Dockerfile` |
| Web Dockerfile path    | `apps/web/Dockerfile`    |
| Server exposed port    | `3000`                   |
| Web exposed port       | `80`                     |
| Health check path      | `/` (server liveness)    |

Notes:

- Point the platform at the repository root.
- The web image embeds `VITE_SERVER_URL` at build time. Set it to the public API
  origin (including `https://`) when building the web service; changing a
  runtime environment variable alone does not change the compiled web bundle.
- Build-time `.env` values are supplied only through BuildKit secret mounts.
  The image install uses the committed Bun lockfile in frozen mode. Runtime
  secrets and configuration must be set separately as platform environment
  variables and are not loaded from those build mounts.
- Add PostgreSQL as a separate service or use an external database.
- Prefer internal/private networking for the database when app and DB live on
  the same platform.
- Production must be served over HTTPS/TLS via the platform reverse proxy,
  Let's Encrypt, or an equivalent TLS terminator.
- Do not expose plain HTTP except for local development.
- Runtime environment variables must be set in the platform; secrets are never
  baked into the image (the Dockerfile mounts `.env` files as BuildKit secrets
  only for install/build).
- On a platform deployment, run database migrations as a one-off command,
  never automatically on boot. See [docs/migration-safety.md](migration-safety.md)
  and section 5. (The self-host Compose install instead migrates on start, gated
  on a pre-migrate backup; see [self-hosting/upgrading.md](self-hosting/upgrading.md).)

## 4. Required environment variables

See `apps/server/.env.schema` for the canonical, validated runtime settings.
In addition to the application settings below, that schema currently requires
`TELEGRAM_WEBHOOK_SECRET` even when Telegram delivery is disabled. Runtime
settings with schema defaults still receive those defaults when not overridden.
The full generated list, with types, defaults and `_FILE` support, is in
[`docs/reference/env.md`](reference/env.md).

Production checklist:

| Variable                  |    Required | Notes                                                                                                                                    |
| ------------------------- | ----------: | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                |         yes | Set to `production`.                                                                                                                     |
| `DATABASE_URL`            |         yes | Use an internal/private URL when possible.                                                                                               |
| `BETTER_AUTH_SECRET`      |         yes | Use a non-placeholder secret of at least 32 characters.                                                                                  |
| `BETTER_AUTH_URL`         |         yes | Public API/auth base URL; align with the API origin compiled into the web bundle.                                                        |
| `CORS_ORIGIN`             |         yes | Exact browser origin serving the deployed web app.                                                                                       |
| `CRON_SECRET`             |         yes | Use a non-placeholder bearer token of at least 16 characters.                                                                            |
| `TELEGRAM_WEBHOOK_SECRET` |         yes | Required by the schema even when Telegram is disabled; use a private synthetic value if not configured.                                  |
| `EMAIL_FROM`              |         yes | Sender address; configure a verified sender for real outbound mail.                                                                      |
| `RESEND_API_KEY`          | conditional | Required for real magic-link delivery (with `EMAIL_DRY_RUN=false`). Without it, mail is dry-run only and sign-in email is not delivered. |
| `TELEGRAM_BOT_TOKEN`      | conditional | Needed to enable Telegram delivery.                                                                                                      |
| `AI_PROVIDER`             | conditional | `anthropic` or `openai-compatible`; unset leaves AI off. See [AI providers](ai-providers.md).                                            |
| `AI_API_KEY`              | conditional | Provider key; required for Anthropic (legacy `ANTHROPIC_API_KEY` also works), optional for local OpenAI-compatible servers.              |
| `AI_BASE_URL`, `AI_MODEL` | conditional | Both required for `openai-compatible`.                                                                                                   |

`EMAIL_DRY_RUN`, `TELEGRAM_CONNECT_TOKEN_TTL_SECONDS`, `TELEGRAM_API_BASE_URL`,
and `AI_RATE_LIMIT_PER_MINUTE` have schema defaults; `AI_MODEL` defaults to
`claude-sonnet-5-5` for Anthropic. Do not set
`AUTH_DEV_MAGIC_LINK_CONSOLE=true` in production. Readiness reports provider
capabilities; it does not verify that external provider credentials are usable.
Set `BETTER_AUTH_URL` and build-time `VITE_SERVER_URL` to the public API origin;
set `CORS_ORIGIN` to the distinct, exact public web origin.

### File-based secrets

Every sensitive key above also accepts a `<KEY>_FILE` variant, so platform
secret mounts can replace plain environment values. This covers
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CORS_ORIGIN`, `DATABASE_URL`,
`CRON_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_AUDIT_BCC`,
`TELEGRAM_BOT_TOKEN`, `AI_API_KEY` and `ANTHROPIC_API_KEY`; the same-origin rules for
`BETTER_AUTH_URL` and `CORS_ORIGIN` apply to their file contents.

- Point `<KEY>_FILE` at a mounted secret path such as `/run/secrets/<key>`.
  Relative paths resolve against the process working directory; use absolute
  paths in containers. `_FILE` values come from the **runtime environment**
  (standard Bun `.env` autoloading and platform variables); a standalone
  `varlock load`/`varlock run` does not resolve them.
- The runtime process runs as the non-root `bun` user (uid 1000). Prefer secret
  files owned by that UID with mode `0400`/`0600` and a directory readable only
  by it (`0700`/`0500`). If host and container UIDs differ, fall back to mode
  `0444` files inside a `0755` subdirectory under a `0700` host parent; the
  read-only mount exposes only `/run/secrets`.
- A non-empty `<KEY>` together with a non-empty `<KEY>_FILE` fails before the
  process starts. An empty `<KEY>_FILE` is treated as unset.
- Files must be regular (symlinked targets are followed), strict UTF-8 without
  NUL bytes, non-empty and at most 64 KiB. Only trailing CR/LF is stripped.
  Varlock schema failures are reported with masked values; file-resolution
  failures name keys only, never paths or contents.

See `CONTRIBUTING.md` ("File-based secrets") for examples.

## 5. Database and migrations

- Provision PostgreSQL as a separate service.
- The standalone deployment smoke test creates a fresh project-scoped Postgres
  18 volume and network. It deliberately does not merge the legacy root
  `docker-compose.yml`, whose named volume is retained for existing installs.
  Never reuse the smoke test's generated project or database for real data.
- Use an internal/private `DATABASE_URL` when the app and database are on the
  same platform/network.
- Before storing real PHI, configure encrypted Postgres backups (your
  platform's or provider's database backups; OpenValens's own backup service
  is part of the self-host stack only) and complete a restore drill, including
  the erasure-ledger replay below ([Database rollback](#database-rollback)).
- Before production migrations, take a volume/server snapshot or a `pg_dump`
  backup and store it outside the app container.
- Run migrations during a quiet/maintenance window as a one-off command:

```bash
bun run db:migrate
```

- Do **not** run migrations automatically on every container start of a
  platform deployment. The self-host Compose install is the exception: its
  one-shot `migrate` service runs only after the pre-migrate backup hook
  succeeds, and a failure leaves the server stopped
  ([self-hosting/upgrading.md](self-hosting/upgrading.md)).
- Destructive migrations must follow the quarantine-over-DELETE and
  `NOT VALID` → `VALIDATE CONSTRAINT` rules in
  [docs/migration-safety.md](migration-safety.md).
- Keep the previous image/tag available so you can roll back if needed.

## 6. Health readiness

The readiness probe is a public oRPC procedure (no auth) at
`/api-reference/health/readiness`. It performs a database ping (`SELECT 1`,
5-second timeout), a secret-presence check and capability flags, and always
returns HTTP 200 with the status in the body:

```bash
curl -fsS http://localhost:3000/api-reference/health/readiness \
  -X POST -H 'Content-Type: application/json' -d '{}'
```

Response shape:

```json
{
  "status": "ok",
  "checks": {
    "database": "ok",
    "secrets": { "betterAuthSecret": "ok", "cronSecret": "ok" },
    "capabilities": {
      "telegram": false,
      "anthropic": false,
      "resend": false,
      "mobilePairing": true,
      "sentry": false
    },
    "storage": "ok",
    "backups": "ok",
    "backupOffsite": "off",
    "integrations": {
      "email": { "provider": "resend", "state": "dry-run" },
      "ai": { "provider": null, "state": "off" },
      "messaging": { "provider": null, "state": "off" },
      "storage": { "provider": "local", "state": "configured" },
      "foodLookup": { "provider": null, "state": "off" }
    }
  },
  "timestamp": "2026-09-29T00:00:00.000Z"
}
```

Status semantics:

- `ok` — database reachable and all required secrets present.
- `degraded` — database reachable but a required secret is missing or too
  short, object storage is not writable, backups are `failing` or `stale`, or
  the off-site backup copy is `failing`.
- `unready` — database unreachable.

Each check emits a structured `health.readiness.checked` log line carrying the
correlation id, status, database status and any missing secret names.

`checks.integrations` reports every optional external service family as a
value-free `{ provider, state }` pair (`configured`, `dry-run` or `off`). The
example above is a default install with no vendor accounts; `dry-run` and `off`
are safe defaults and never degrade the status. See
[docs/integrations.md](integrations.md) for the adapter set and how to enable
each one.

`checks.storage` is `ok` when the selected object storage accepted a
write/read/delete round trip on a reserved key (cached for 30 seconds),
`unwritable` when it did not, and `off` when S3 is selected without a bucket or
credentials. Which storage is in use is `checks.integrations.storage.provider`.
See [docs/storage.md](storage.md).

`checks.backups` reports the self-host backups (Issue #64): `failing` when the
newest backup or verify failed, `stale` when no good backup is under 48 hours
old or the scheduled run is overdue, `ok` otherwise, `off` when no backup
service ever reported (a platform deployment, or development) and `unknown`
when the status could not be read. Only `failing` and `stale` degrade the
status. `checks.backupOffsite` reports the optional off-site copy: `failing`
when the newest upload failed (degrades the status; the local backups stay
`ok`), `ok`, or `off` when no upload was ever recorded. See
[Backups](self-hosting/backup.md).

`capabilities.resend` is `true` only when email is actually delivered: a
`RESEND_API_KEY` is configured **and** `EMAIL_DRY_RUN=false`. With the default
`EMAIL_DRY_RUN=true`, sends are logged as `email.send.dry-run` and nothing is
delivered. Resend is the only email transport; there is no SMTP option.

A failed send emits an `email.send.failed` line (plus
`auth.magic-link.send.failed` / `auth.invitation.send.failed` from the auth
flows) with a masked recipient and these value-free fields:

| `errorCategory`        | Retryable | Meaning / operator action                                     |
| ---------------------- | --------- | ------------------------------------------------------------- |
| `auth`                 | no        | HTTP 401/403: check `RESEND_API_KEY` and the verified sender. |
| `rejected`             | no        | Other 4xx: Resend refused the message (see `providerError`).  |
| `rate_limited`         | yes       | HTTP 429: rate or quota exceeded.                             |
| `provider_unavailable` | yes       | HTTP 5xx from Resend.                                         |
| `timeout`              | yes       | No response within 10 seconds.                                |
| `network`              | yes       | DNS, TLS or connection failure before any response.           |
| `unknown`              | no        | Not a typed provider failure.                                 |

Each line also carries `errorCode` (`EMAIL_TRANSIENT`, `EMAIL_PERMANENT`,
`EMAIL_UNKNOWN`), `retryable`, `status` and, when it is identifier-shaped,
Resend's error name as `providerError`. The API key, recipient address, message
body and provider error message are never logged.

## 7. Scheduled jobs

Authenticated cron endpoints are exposed as oRPC procedures:

| Endpoint                      | Schedule       | Job                 |
| ----------------------------- | -------------- | ------------------- |
| `/rpc/cron/remindersDailyRun` | `5 * * * *`    | `reminders.daily`   |
| `/rpc/cron/ingestionRun`      | `15 9 * * *`   | `ingestion.daily`   |
| `/rpc/cron/insightsRun`       | `20 * * * *`   | `insights.delivery` |
| `/rpc/cron/wearablesSync`     | `*/15 * * * *` | `wearables.sync`    |
| `/rpc/cron/photoCleanupRun`   | `40 * * * *`   | `photo.cleanup`     |

The schedules are suggestions; nothing in the stack runs them (see
[self-hosting configuration](self-hosting/configuration.md#scheduled-jobs) for
a ready-made crontab).

All require a bearer token equal to `CRON_SECRET`:

```bash
curl -fsS -X POST "https://<your-domain>/rpc/cron/remindersDailyRun" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"json":{}}'

curl -fsS -X POST "https://<your-domain>/rpc/cron/ingestionRun" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"json":{}}'

curl -fsS -X POST "https://<your-domain>/rpc/cron/photoCleanupRun" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"json":{}}'
```

`remindersDailyRun` runs hourly and works per workspace. For each member whose
local reminder hour (`insight_preference.daily_reminder_hour`, 0–23, default 8,
in `insight_preference.time_zone`, UTC when unset) has arrived on their local
date, it first creates that date's `daily_reminder` rows: active supplements and
medications taken daily or with no frequency, weekly and training-day items on
their chosen ISO weekdays (`days_of_week`), and scheduled events that recur that
day. It then delivers those members' pending rows for their local date by
Telegram or, without a connected chat or without a configured bot, by email.
Only members who connected Telegram, or turned on "Daily reminders by email" in
their notification settings (`insight_preference.daily_reminder_email`, off by
default), get reminders.

- **Once per day.** Each (member, date, item) slot is created once, so
  rerunning the job, overlapping runs and a repeated DST hour create and send
  nothing twice. "Hour reached" means local hour ≥ reminder hour, so a skipped
  DST hour fires at the next run.
- **Missed runs.** A member's reminders go out at the first run on or after
  their hour, the same local day.
- **Stale reminders.** Undelivered rows dated before the member's local today
  are never sent and stay `pending`; an outage does not end in a burst of
  old reminders. A failed send is retried at the next hourly run that day.
- **Time zone changes.** A member who moves west after today's reminders went
  out (so their local date steps back) gets nothing for the earlier date.

Members in different zones within one workspace are each handled on their own
clock. Keep the schedule hourly: with less frequent runs, a member whose hour
falls between runs gets the day's reminders at the next run that is still on
their local day, or not at all that day.

`wearablesSync` claims at most 25 due connections per call and is a no-op when
no wearable vendor is configured (see [wearables.md](wearables.md)). The photo
cleanup worker is bounded to 25 items per call and reports pending, blocked,
skipped, and failed work (see [storage.md](storage.md)).

- A missing or incorrect bearer token is rejected with `401 UNAUTHENTICATED`.
- The other cron endpoints emit their lifecycle logs; photo cleanup emits one
  `cron.photo_cleanup.completed` event with status and counters only (no keys,
  URLs, or subject identifiers). Responses include the correlation id and job
  envelope; a reminder response looks like:

```json
{
  "status": "ok",
  "job": "reminders.daily",
  "startedAt": "2026-09-29T08:05:00.000Z",
  "finishedAt": "2026-09-29T08:05:01.000Z",
  "organizations": 2,
  "created": 5,
  "organizationsSucceeded": 2,
  "organizationsFailed": 0,
  "sent": 5,
  "skipped": 0,
  "failed": 0,
  "correlationId": "..."
}
```

**Envelope note.** The `/rpc` transport (used by the web/native clients) wraps
the body in a `{"json": ...}` envelope, so a raw cron caller must send
`{"json":{}}`. The `/api-reference/...` OpenAPI mount accepts raw JSON
(`-d '{}'`) and is convenient for manual runs and smoke checks.

## 8. Smoke checks

For a local production-image smoke test, run `bun scripts/deployment-smoke.ts`.
It builds both Dockerfiles from the repository-root context, provisions an
isolated synthetic Postgres database, applies tracked migrations as a one-off,
then checks API readiness, web static assets, and configured-origin CORS. It
binds app ports to loopback only and removes only resources carrying its unique
ownership labels. Migrations run directly through the `packages/db` workspace
script, not the root interactive Turbo task. Generated secret files are kept
outside the build context with private permissions and removed during cleanup;
uniquely tagged images and image-ID records are retained for audit. Sanitized
progress is printed while detailed command logs remain in the private temp
artifact folder.
Unknown command-line arguments are rejected before temporary files or Docker
are accessed; `--help` is the only accepted option. Artifacts use a unique
mode-`0700` child of the OS temporary directory. Set `OPENVALENS_SMOKE_TMPDIR`
to an absolute parent path to select another location; the script does not
delete or chmod that parent. The resolved path (including symlink targets) must
remain outside the repository and Docker build context. Synthetic env files are mode-`0600` and removed in
a finalizer even when Docker cleanup fails. Catchable SIGINT/SIGTERM stop the
active child command and attempt cleanup; SIGKILL and host failure cannot run
finalizers.

Before building or starting containers, the script checks for project-name and
ownership-label collisions and fails closed if any exist. Services, volume, and
network have run-unique ownership labels. Cleanup re-inspects exact resource
identities and project/run labels, then removes verified containers followed by
the unreferenced owned network and volume; it does not use project-wide
`compose down`.
The test does not configure Resend, AI, Telegram, TLS, backups, or production
provisioning, and does not prove external email delivery.

For a deployed environment, `bun scripts/verify-readiness.ts --base-url
https://<your-domain>` runs the read-only web, API, anonymous/protected RPC and
integration-state checks in one go; see [release.md](release.md#5-readiness-verification).
Authenticated and provider flows are verified with
[production-verification.md](production-verification.md).

Run these after deploy:

- App opens in the browser.
- Migration command succeeds: `bun run db:migrate`.
- `curl -fsS -X POST https://<your-domain>/api-reference/health/readiness -H 'Content-Type: application/json' -d '{}'` returns `status: "ok"`.
- `curl -fsS -X POST https://<your-domain>/rpc/cron/remindersDailyRun -H "Authorization: Bearer $CRON_SECRET" -H 'Content-Type: application/json' -d '{"json":{}}'` returns `status: "ok"`.
- A cron call without the bearer token returns `401`.

## 9. Observability baseline

- Structured logs are PHI-safe and machine-readable (JSON to stdout for
  info/debug, stderr for warn/error) via `@openvalens/observability`.
- Every log line carries a `correlationId` resolved from
  `x-correlation-id` → `x-request-id` → UUID and echoed back on the response.
- Capture and search both stdout and stderr.
- Use platform log search/retention for cron and webhook incidents.
- Sentry error reporting (Issue #54) is off unless `SENTRY_DSN` is set; see
  [Error reporting](self-hosting/configuration.md#error-reporting-sentry). Events
  carry only error types and code frames, so keep relying on logs for context.

## 10. Operational notes

- Keep secrets out of the image; use platform environment variables.
- Use production values rather than the `.env.schema` development defaults.
  The server rejects known placeholder `BETTER_AUTH_SECRET` and `CRON_SECRET`
  values in production; this is not a general entropy check. Use at least 32 and
  16 characters respectively, and never rely on the default compose password.
- Prefer one server container and one database service per environment.
- If you rotate `CRON_SECRET`, update the scheduler and the platform together;
  the readiness probe will report `cronSecret: "missing"` until both agree.
- Re-run migrations only when schema files change or a fresh environment is
  provisioned.
- Check platform logs for cron failures and readiness degradation after each
  deploy.

## 11. Rollback runbook

When a deploy goes wrong (broken migrations, failing readiness, AI regression,
etc.), roll back with the smallest possible change first.

Releases are built, approved (deployment and migration approval separately)
and rolled back per [release.md](release.md), which also has the self-host
restore-rollback commands and a local rollback rehearsal
(`scripts/rollback-rehearsal.sh`).

For a CSP enforcement regression (a supported flow blocked after Issue #127
made `CSP_MODE=enforce` the production default), set `CSP_MODE=report-only` and
redeploy — see [docs/security-csp.md](security-csp.md).

### Image rollback

The Hetzner/Coolify platform keeps every successful build tagged with its
commit SHA. To roll back the server:

1. In the platform UI, stop the running `server` service.
2. Set the image tag to the previous known-good SHA (the prior deploy's
   commit).
3. Start the service and watch the readiness probe:
   `curl -fsS https://<your-domain>/api-reference/health/readiness -H 'Content-Type: application/json' -d '{}'`.
   The response should show `status: "ok"`.
4. Repeat for the `web` service if the regression is UI-side.

The platform keeps the rolled-back tag live so you can re-promote it later.

### Database rollback

Schema migrations are append-only. A destructive migration in the migration
queue is the only case where a database rollback is required; see
[docs/migration-safety.md](migration-safety.md) for the exact rules
(quarantine-over-DELETE, `NOT VALID` → `VALIDATE CONSTRAINT`).

When you do need to revert a schema change:

1. Restore the most recent pre-migration snapshot/pg_dump to a side database.
2. Run the application's `bun run db:migrate` against that side DB until it
   catches up to the prior schema.
3. Re-apply the erasure ledger to the side database (below).
4. Swap `DATABASE_URL` to the restored DB and roll the server image back as
   above.
5. If the rollback affects retention or supersession, run the dedupe
   procedures manually before re-enabling cron.

Before the restored database takes traffic, re-apply the erasure ledger, or
people who used "Delete everything" after the dump come back. The server
image has the tool; run it once, as a one-off command in the server's
environment, with the replaced database's URL in an environment variable
(never on the command line):

```bash
# DATABASE_URL = the restored side database; OLD_DATABASE_URL = the one it replaces
OLD_DATABASE_URL=postgres://... DATABASE_URL=postgres://... \
  bun --no-env-file scripts/erasure-replay.ts --merge-from-env OLD_DATABASE_URL --allow-remote
```

It copies the replaced database's `erasure_ledger` rows into the restored
database (skipping rows it already has), then erases every person in the
ledger again, including their stored objects (it uses the server's `STORAGE_*`
settings). It prints counts only. If the replaced database is gone, run it
without `--merge-from-env`: it then replays only the ledger the dump contains,
so deletions made after the dump must be repeated by hand.

The same applies to any restore of a platform database from a backup, not
only rollbacks.

Never run destructive SQL against production without a verified backup and
the rollback image tag pinned in the platform.

### Crash-only rollback (faster)

For most regressions (UI bug, AI chat edge case, missing env var), a code-only
rollback is enough — no DB change. The image rollback procedure above
covers this path.

### After rollback

1. Open an issue referencing the failing commit SHA and the symptom.
2. Re-run the post-deploy smoke checks (section 8).
3. Once the regression is fixed in a follow-up commit, re-deploy as normal;
   the prior broken image stays in the platform for traceability.

## Instance admission (Issue #63)

> **Release status.** Admission is merged on `main` and runs in every Compose
> install (`deploy/setup.sh` mints the setup token). It needs working email:
> the setup and invitation codes are emailed, so with no Resend key (email in
> dry-run) `/rpc/admission/status` reports `emailDeliveryAvailable: false`,
> `/setup` says so, and `begin` / `issueInvitation` refuse with
> `EMAIL_UNAVAILABLE` (HTTP 503) before writing anything. Automatic deployment
> stays disabled; rolling a release out is still an authorized, manual step
> (#129).

A fresh installation starts `pending`: no account can sign in until the first
global instance administrator is bootstrapped with a one-time setup token.

`/setup` is a web-app route, so it loads either way. To check whether setup is
still open, call the public status procedure. It is an oRPC procedure: `POST`
with the input wrapped in `json` (a `GET` answers 405, an empty body 400):

```bash
curl -sS -X POST https://<domain>/rpc/admission/status \
  -H 'Content-Type: application/json' -d '{"json":{}}'
# {"json":{"setupAvailable":true,"emailDeliveryAvailable":true}}
```

### 1. Mint the setup token (operator)

The setup token is an operator secret and is minted only from a host with
database access — never through the API. Always use the supported launcher
(it suppresses Bun's `.env` autoload so an ambient developer file can never
select the database implicitly):

```bash
DATABASE_URL='postgres://USER:PASSWORD@HOST:PORT/DBNAME' \
  scripts/admission.sh mint --output /path/to/private/setup-token
DATABASE_URL_FILE=/path/to/private/db-url \
  scripts/admission.sh mint --stdout
```

- `mint` requires **exactly one** output selector:
  - `--output <path>` — private `0600` file, created exclusively (fails if it
    already exists); the file is reserved before the token is generated, so a
    pre-existing file never advances the generation.
  - `--stdout` — explicit, intentional terminal output of a live secret. Do
    **not** paste it into chat, tickets or logs.
- Supply the database explicitly with `DATABASE_URL` or `DATABASE_URL_FILE` (a
  private local file). Never use `bun run` or a bare `bun scripts/admission.ts`;
  both may load `.env`.
- A non-loopback host is refused unless `--allow-remote` is passed explicitly.
  The launcher rejects unknown/secret-like flags without echoing their values.
- Minting again advances the generation and **invalidates any previously
  reserved** setup token.
- The setup token is never emailed: the operator obtains it from the private file
  or terminal. Only admission invitation bearers and proof codes are delivered
  by email, and only in the message body.

On the self-host Compose install, `deploy/setup.sh install` mints the token
into `deploy/secrets/setup-token` for you (and `deploy/setup.sh mint-token`
re-mints it) by running this same launcher inside the server image; see
[self-hosting/install.md](self-hosting/install.md#first-administrator-and-invitations).

### 2. Create the first administrator (web)

Open `/setup` and paste the token. A high-entropy email proof code is then
delivered to the address you enter, **in the message body only** (never as a
URL); enter it to complete. The outcome depends on the address:

- **New address** (no account): completion creates the first global
  administrator (verified, role `admin`); sign in afterwards through the normal
  existing-account magic-link flow. Completion does **not** auto-log-in.
- **Existing account**: completion additionally requires a matching live,
  non-impersonated, verified, unbanned account/session _before_ completing, and
  promotes that account to the global admin claim (organization roles
  untouched).

The entered secrets are volatile: if the page is closed or reloaded before
completion they must be re-pasted/re-requested; they are never kept in browser
storage.

While the installation is `pending`, the bootstrap does not disable ordinary
sign-in for existing accounts — relevant on a legacy installation that has users
but no administrator. A fresh empty installation has no such accounts.

### 3. Global invitations (`/join`)

Once any global administrator exists the installation is `invite_only`. A global
administrator may invite **new** addresses as well as existing ones:

- **New address**: the invitation bearer plus email proof code complete the
  admission and atomically create a verified account with role `user` — no prior
  session is required for a new recipient.
- **Existing account**: completion additionally requires a matching live,
  non-impersonated, verified, unbanned account/session; the existing role is
  preserved.

Better Auth sign-up, magic-link provisioning and admin create-user stay closed
and do **not** reopen even if the last administrator is later removed. The
invitation bearer and proof code are delivered in the message body only (never a
copyable URL, never generated in the browser).

### 4. Workspace invitations (`/accept-invitation/{id}`)

Workspace (organization) invitations are a **separate** flow: they target an
**existing** account only and never admit a new account. A workspace `owner`
keeps its organization-scoped sharing powers but cannot admit a new account or
grant instance-administrator authority.

### Resend and verification limits

- At most **3 sends** per grant per **10 minutes**.
- At most **5 failed proof attempts**; the proof code expires after **10
  minutes**.
- Setup token TTL **24 hours**; invitation TTL **2 days**.

During global admission, resending a proof issues a new code **within the
original bearer/grant expiry** — it does not renew the credential or its
invitation TTL, and admission grants carry no organization or role fields. Only
the workspace Better Auth resend (`/organization/invite-member` with
`resend: true`) refreshes the two-day invitation expiry for the same invitation
id, organization and role. If a global admission issuer is demoted or banned, an
in-flight global completion is invalidated; workspace invitation policy is
separate and is not transferred.

### Maintenance: prune expired grants

An operator-scheduled command removes expired **pending and consumed** grants,
bounded to **500**:

```bash
DATABASE_URL='postgres://USER:PASSWORD@HOST:PORT/DBNAME' \
  scripts/admission.sh prune --limit 500
```

Opaque security events are retained and survive deletion of the referenced
recipient or issuer (their user references are anonymized). Schedule this
bounded command from the operator runbook; there is no background job. Backup
and restore handling for this data is out of scope here.

### Database migration

The admission feature adds exactly **one** migration (the 40th) on top of the
existing 39 production migrations. It is applied only by a normal, explicitly
approved `db:migrate` — this document does not run it. On an installation whose
`user.role` already carries the exact CSV token `admin` (banned included) the
migration closes the bootstrap to `invite_only`; otherwise it stays `pending`.
It preserves all existing users, roles, organizations and sessions and grants no
role.

### Configuration and native

Current instance configuration stays read-only startup `ENV` (Issue #58): this
admission change does not make it database-editable, and it is not a UI write
surface. Editable database-backed product settings remain separate Issue #58
work (other product areas already use their own database tables). Email delivery
is **Resend-only** (no SMTP). Admission is a **web-only** flow; existing native
accounts keep signing in as before (native handoff is assumed, not verified).
CI/production provider credentials and live email delivery are outside this
document's scope.

Related: #63. The setup-token minting path and the self-host installer
(`deploy/setup.sh`, [self-hosting/](self-hosting/README.md)) are implemented. The
self-host stack takes encrypted daily and pre-migrate backups and restores them
with `deploy/setup.sh restore` ([Backups](self-hosting/backup.md)), and resource minimums still need measuring on a
reference VPS. Editable product settings and settings-change
auditing remain separate Issue #58 work. The admission web UI has passed its
independent security gate; production activation requires separate authorization.
