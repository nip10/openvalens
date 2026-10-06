# Deployment

Last updated: 2026-10-06

> This document mirrors the structure of `anchovy/docs/deployment.md` for the
> OpenValens stack (Hono + oRPC server in `apps/server`, TanStack web in
> `apps/web`). The readiness probe, cron schedule and bearer-secret guard
> described here were implemented in Issue #11.

## 1. Overview

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
- Run database migrations as a one-off command, never automatically on boot.
  See [docs/migration-safety.md](migration-safety.md) and section 5.

## 4. Required environment variables

See `apps/server/.env.schema` for the canonical, validated runtime settings.
In addition to the application settings below, that schema currently requires
`TELEGRAM_WEBHOOK_SECRET` even when Telegram delivery is disabled. Runtime
settings with schema defaults still receive those defaults when not overridden.

Production checklist:

| Variable                  |    Required | Notes                                                                                                       |
| ------------------------- | ----------: | ----------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                |         yes | Set to `production`.                                                                                        |
| `DATABASE_URL`            |         yes | Use an internal/private URL when possible.                                                                  |
| `BETTER_AUTH_SECRET`      |         yes | Use a non-placeholder secret of at least 32 characters.                                                     |
| `BETTER_AUTH_URL`         |         yes | Public API/auth base URL; align with the API origin compiled into the web bundle.                           |
| `CORS_ORIGIN`             |         yes | Exact browser origin serving the deployed web app.                                                          |
| `CRON_SECRET`             |         yes | Use a non-placeholder bearer token of at least 16 characters.                                               |
| `TELEGRAM_WEBHOOK_SECRET` |         yes | Required by the schema even when Telegram is disabled; use a private synthetic value if not configured.     |
| `EMAIL_FROM`              |         yes | Sender address; configure a verified sender for real outbound mail.                                         |
| `RESEND_API_KEY`          | conditional | Required for real magic-link delivery. Without it, mail is dry-run only and sign-in email is not delivered. |
| `TELEGRAM_BOT_TOKEN`      | conditional | Needed to enable Telegram delivery.                                                                         |
| `ANTHROPIC_API_KEY`       | conditional | Needed to enable AI-provider calls.                                                                         |

`EMAIL_DRY_RUN`, `TELEGRAM_CONNECT_TOKEN_TTL_SECONDS`, `TELEGRAM_API_BASE_URL`,
`AI_MODEL`, and `AI_RATE_LIMIT_PER_MINUTE` have schema defaults. Do not set
`AUTH_DEV_MAGIC_LINK_CONSOLE=true` in production. Readiness reports provider
capabilities; it does not verify that external provider credentials are usable.
Set `BETTER_AUTH_URL` and build-time `VITE_SERVER_URL` to the public API origin;
set `CORS_ORIGIN` to the distinct, exact public web origin.

## 5. Database and migrations

- Provision PostgreSQL as a separate service.
- The standalone deployment smoke test creates a fresh project-scoped Postgres
  18 volume and network. It deliberately does not merge the legacy root
  `docker-compose.yml`, whose named volume is retained for existing installs.
  Never reuse the smoke test's generated project or database for real data.
- Use an internal/private `DATABASE_URL` when the app and database are on the
  same platform/network.
- Before storing real PHI, configure encrypted Postgres backups and complete a
  restore drill.
- Before production migrations, take a volume/server snapshot or a `pg_dump`
  backup and store it outside the app container.
- Run migrations during a quiet/maintenance window as a one-off command:

```bash
bun run db:migrate
```

- Do **not** run migrations automatically on every container start.
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
      "mobilePairing": true
    }
  },
  "timestamp": "2026-09-29T00:00:00.000Z"
}
```

Status semantics:

- `ok` — database reachable and all required secrets present.
- `degraded` — database reachable but a required secret is missing or too short.
- `unready` — database unreachable.

Each check emits a structured `health.readiness.checked` log line carrying the
correlation id, status, database status and any missing secret names.

## 7. Scheduled jobs

Two authenticated cron endpoints are exposed as oRPC procedures:

| Endpoint                      | Schedule     | Job               |
| ----------------------------- | ------------ | ----------------- |
| `/rpc/cron/remindersDailyRun` | `5 8 * * *`  | `reminders.daily` |
| `/rpc/cron/ingestionRun`      | `15 9 * * *` | `ingestion.daily` |

Both require a bearer token equal to `CRON_SECRET`:

```bash
curl -fsS -X POST "https://<your-domain>/rpc/cron/remindersDailyRun" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"json":{}}'

curl -fsS -X POST "https://<your-domain>/rpc/cron/ingestionRun" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"json":{}}'
```

- A missing or incorrect bearer token is rejected with `401 UNAUTHENTICATED`.
- On success the endpoint emits `cron.job.started` and `cron.job.finished`
  structured logs (tagged with the correlation id) and returns:

```json
{
  "status": "ok",
  "job": "reminders.daily",
  "startedAt": "2026-09-29T08:05:00.000Z",
  "finishedAt": "2026-09-29T08:05:00.000Z",
  "correlationId": "..."
}
```

**Envelope note.** The `/rpc` transport (used by the web/native clients) wraps
the body in a `{"json": ...}` envelope, so a raw cron caller must send
`{"json":{}}`. The `/api-reference/...` OpenAPI mount accepts raw JSON
(`-d '{}'`) and is convenient for manual runs and smoke checks.

**Deferred work.** Issue #11 ships the endpoint contract, the bearer-secret
guard and the structured logs only. The real reminder delivery logic lands in
Issues #14/#24 and the real ingestion logic in Issues #16/#17. Until then both
jobs are no-op stubs.

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
- Sentry is not configured by default; do not assume external error reporting
  exists.

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
3. Swap `DATABASE_URL` to the restored DB and roll the server image back as
   above.
4. If the rollback affects retention or supersession, run the dedupe
   procedures manually before re-enabling cron.

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
