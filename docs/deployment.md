# Deployment

Last updated: 2026-09-29

> This document mirrors the structure of `anchovy/docs/deployment.md` for the
> openhealth stack (Hono + oRPC server in `apps/server`, TanStack web in
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
| Server Dockerfile path | `apps/server/Dockerfile` |
| Web Dockerfile path    | `apps/web/Dockerfile`    |
| Server exposed port    | `3000`                   |
| Health check path      | `/` (server liveness)    |

Notes:

- Point the platform at the repository root.
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

See `apps/server/.env.schema` for the canonical, validated list
(`NODE_ENV`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CORS_ORIGIN`,
`DATABASE_URL`, `CRON_SECRET`).

Production checklist:

| Variable             |    Required | Notes                                                                    |
| -------------------- | ----------: | ------------------------------------------------------------------------ |
| `DATABASE_URL`       |         yes | Use internal/private URL when possible.                                  |
| `BETTER_AUTH_SECRET` |         yes | Auth signing secret, minimum 32 characters.                              |
| `BETTER_AUTH_URL`    |         yes | Public auth base URL.                                                    |
| `CORS_ORIGIN`        |         yes | Allowed browser origin for the web app.                                  |
| `CRON_SECRET`        |         yes | Bearer token for the cron endpoints, minimum 16 characters.              |
| `TELEGRAM_BOT_TOKEN` | conditional | Capability flag only until Issue #14; required when Telegram is enabled. |
| `RESEND_API_KEY`     | conditional | Capability flag only until Issue #15; required for real email delivery.  |
| `ANTHROPIC_API_KEY`  | conditional | Capability flag only until Issue #13; required when AI is enabled.       |

The three integration variables above are optional and are **not** yet declared
in `.env.schema`; they arrive with their integration issues. The readiness
probe reports each as a capability flag (`telegram`, `resend`, `anthropic`) and
treats a missing value as "capability disabled" (HTTP 200 `degraded` is not
raised for these — only missing required secrets degrade readiness).

## 5. Database and migrations

- Provision PostgreSQL as a separate service.
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

Run these after deploy:

- App opens in the browser.
- Migration command succeeds: `bun run db:migrate`.
- `curl -fsS -X POST https://<your-domain>/api-reference/health/readiness -H 'Content-Type: application/json' -d '{}'` returns `status: "ok"`.
- `curl -fsS -X POST https://<your-domain>/rpc/cron/remindersDailyRun -H "Authorization: Bearer $CRON_SECRET" -H 'Content-Type: application/json' -d '{"json":{}}'` returns `status: "ok"`.
- A cron call without the bearer token returns `401`.

## 9. Observability baseline

- Structured logs are PHI-safe and machine-readable (JSON to stdout for
  info/debug, stderr for warn/error) via `@openhealth/observability`.
- Every log line carries a `correlationId` resolved from
  `x-correlation-id` → `x-request-id` → UUID and echoed back on the response.
- Capture and search both stdout and stderr.
- Use platform log search/retention for cron and webhook incidents.
- Sentry is not configured by default; do not assume external error reporting
  exists.

## 10. Operational notes

- Keep secrets out of the image; use platform environment variables.
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
