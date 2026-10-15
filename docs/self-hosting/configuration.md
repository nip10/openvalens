# Configuration

**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-14

A self-hosted instance is configured in three places:

1. **`deploy/.env`** — the non-secret settings of the Compose stack, written by
   `deploy/setup.sh`.
2. **`deploy/secrets/`** — one file per secret, read by the server through
   `<KEY>_FILE` variables ([secrets layout](install.md#secrets-layout)).
3. **Product settings** — display preferences an instance administrator edits in
   the web app.

The complete list of server, web, native and database variables, with types,
defaults and `_FILE` support, is the generated
[environment reference](../reference/env.md). It describes every variable the
code accepts; the Compose stack exposes only the subset below.

## `deploy/.env`

Every variable that `deploy/compose.yml` reads from `deploy/.env` (CI checks
that this table and the Compose file list the same variables):

| Variable                                  | Written by `install` | Default   | Purpose                                                                                                     |
| ----------------------------------------- | -------------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| `OPENVALENS_DOMAIN`                       | yes                  | —         | Bare domain served over HTTPS; also sets `BETTER_AUTH_URL`, `CORS_ORIGIN` and the web build's API origin.   |
| `ACME_EMAIL`                              | yes                  | —         | Contact address for Let's Encrypt certificate notices.                                                      |
| `EMAIL_FROM`                              | yes                  | —         | Sender of app email, e.g. `OpenValens <noreply@example.org>`. See [Email](email.md).                        |
| `OPENVALENS_VERSION`                      | yes (every run)      | —         | Tag of the locally built images; `upgrade` refreshes it from `git describe`.                                |
| `RESEND_API_KEY_FILE`                     | yes                  | empty     | `/run/secrets/RESEND_API_KEY` when that secret file exists; empty means email is dry-run.                   |
| `OPENVALENS_PRE_MIGRATE_BACKUP`           | yes                  | `pg_dump` | Pre-migrate backup mode: `pg_dump`, `hook` or `none`. See [Backups](backup.md).                             |
| `OPENVALENS_BACKUP_RETAIN`                | yes                  | `10`      | Number of `pre-migrate-*` dumps to keep; `0` keeps all.                                                     |
| `OPENVALENS_ALLOW_MIGRATE_WITHOUT_BACKUP` | no                   | empty     | Must be exactly `I_HAVE_A_BACKUP` for `OPENVALENS_PRE_MIGRATE_BACKUP=none` to be accepted.                  |
| `EMAIL_DRY_RUN`                           | no                   | `false`   | `true` logs email instead of sending it. Without a Resend key email is dry-run regardless.                  |
| `ANTHROPIC_API_KEY_FILE`                  | no                   | empty     | `/run/secrets/ANTHROPIC_API_KEY` to enable AI features ([optional providers](#optional-providers)).         |
| `TELEGRAM_BOT_TOKEN_FILE`                 | no                   | empty     | `/run/secrets/TELEGRAM_BOT_TOKEN` to enable Telegram delivery ([optional providers](#optional-providers)).  |
| `OPENVALENS_HTTP_PORT`                    | no                   | `80`      | Host port Caddy publishes for HTTP. Let's Encrypt needs the public port 80; change only behind another NAT. |
| `OPENVALENS_HTTPS_PORT`                   | no                   | `443`     | Host port Caddy publishes for HTTPS (TCP and UDP).                                                          |

### Applying a change

Edit `deploy/.env`, then run:

```bash
deploy/setup.sh upgrade
```

`upgrade` keeps every key in `deploy/.env` and only refreshes
`OPENVALENS_VERSION`. Like every start of the stack, it takes a pre-migrate
backup first ([Upgrading](upgrading.md)).

**Re-running `deploy/setup.sh install` rewrites `deploy/.env`** and keeps only
the keys marked "yes" above; any key you added by hand (for example
`EMAIL_DRY_RUN` or `ANTHROPIC_API_KEY_FILE`) is dropped. Re-add it and run
`upgrade` afterwards.

### What the stack does not expose

The server reads several other variables from
[the environment reference](../reference/env.md) — for example `CSP_MODE`,
`AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_RATE_LIMIT_PER_MINUTE`, `API_MAX_BODY_BYTES`, `EMAIL_REPLY_TO`
and `EMAIL_AUDIT_BCC`. `deploy/compose.yml` does not pass them through, so on
this stack they always use their schema defaults, and the production rules
that apply on top of them (for example, content security policy is enforced
because `NODE_ENV=production`; see [Security model](security.md)). Changing
them means editing `deploy/compose.yml`, which is not supported and is
overwritten when you check out a new version.

## Optional providers

A default install needs no vendor account. Each optional integration is off or
dry-run until you add its key, and the readiness probe reports its state
without revealing any value:

| Family      | Provider  | Enable                                                  | Default   |
| ----------- | --------- | ------------------------------------------------------- | --------- |
| `email`     | Resend    | `RESEND_API_KEY` secret (see [Email](email.md))         | `dry-run` |
| `ai`        | Anthropic | `ANTHROPIC_API_KEY` secret + `ANTHROPIC_API_KEY_FILE`   | `off`     |
| `messaging` | Telegram  | `TELEGRAM_BOT_TOKEN` secret + `TELEGRAM_BOT_TOKEN_FILE` | `off`     |

To add a key, write it to a file the containers can read, point the matching
`_FILE` variable at the mount path, and apply:

```bash
# bash: the key is read from a hidden prompt, never from the command line
read -rs -p 'Anthropic API key: ' key && echo &&
  printf '%s\n' "$key" >deploy/secrets/server/ANTHROPIC_API_KEY && unset key
chmod 0444 deploy/secrets/server/ANTHROPIC_API_KEY
echo 'ANTHROPIC_API_KEY_FILE=/run/secrets/ANTHROPIC_API_KEY' >>deploy/.env
deploy/setup.sh upgrade
```

Then check the result:

```bash
curl -fsS -X POST https://<domain>/api-reference/health/readiness \
  -H 'Content-Type: application/json' -d '{}'
```

`checks.integrations.ai.state` reads `configured` once a key is present. It
shows that a key is configured, not that the provider accepts it.

AI features send data to the provider only behind the in-app consent gate.
On this stack AI means Anthropic through `ANTHROPIC_API_KEY`: the
OpenAI-compatible provider (Ollama, vLLM and others) described in
[docs/ai-providers.md](../ai-providers.md) needs `AI_PROVIDER`, `AI_BASE_URL`
and `AI_MODEL`, which `deploy/compose.yml` does not pass through yet.
Registering the Telegram webhook (`https://<domain>/api/integrations/telegram/webhook`,
authenticated with `TELEGRAM_WEBHOOK_SECRET`) with Telegram is not automated and
is not yet covered by these docs. The adapter rules and the planned families
(storage #62, OIDC #65, wearables #60) are in
[docs/integrations.md](../integrations.md).

## Product settings

An instance administrator sets installation-wide display preferences in the
web app at `https://<domain>/admin/settings`:

| Setting | Values                    | Default  |
| ------- | ------------------------- | -------- |
| Units   | `metric`, `imperial`      | `metric` |
| Locale  | `en-US`, `en-GB`, `en-CA` | `en-US`  |

They change how values are displayed, never how they are stored (storage stays
metric). Saving requires a live, non-impersonated session of an instance
administrator, whose authority is re-checked on every save, and
each change is recorded in a dedicated audit that stores the changed setting
names and revision, never the values. The same page shows, read-only, which
server configuration keys are present; it never shows a value and cannot
change one.

## Scheduled jobs

The Compose stack does **not** schedule anything. Two daily jobs must be
triggered from the host, authenticated with the generated `CRON_SECRET`:

| Endpoint                      | Suggested schedule | Job                                       |
| ----------------------------- | ------------------ | ----------------------------------------- |
| `/rpc/cron/remindersDailyRun` | `5 8 * * *`        | Daily reminders                           |
| `/rpc/cron/ingestionRun`      | `15 9 * * *`       | Retry and replay of queued ingestion work |

Add them to the crontab of the user who ran `deploy/setup.sh` (that user can
read `deploy/secrets/`); replace both placeholders:

```bash
5 8 * * *  curl -fsS -X POST https://<domain>/rpc/cron/remindersDailyRun -H "Authorization: Bearer $(cat /path/to/openvalens/deploy/secrets/server/CRON_SECRET)" -H 'Content-Type: application/json' -d '{"json":{}}' >/dev/null
15 9 * * * curl -fsS -X POST https://<domain>/rpc/cron/ingestionRun -H "Authorization: Bearer $(cat /path/to/openvalens/deploy/secrets/server/CRON_SECRET)" -H 'Content-Type: application/json' -d '{"json":{}}' >/dev/null
```

A call without the bearer token is rejected with HTTP `401`. A successful call
returns `{"json":{"status":"ok",...}}`. Response details and logs are in
[deployment.md](../deployment.md#7-scheduled-jobs).

### Admission maintenance

Expired setup and invitation grants are not removed automatically. Prune them
occasionally (bounded to 500 per run):

```bash
docker compose -f deploy/compose.yml run --rm --no-deps -T --workdir /app migrate \
  bash scripts/admission.sh prune --limit 500 --allow-remote
```

`--allow-remote` is required because the database host is the `postgres`
service, not loopback. The command prints `Pruned expired admission grants.`
