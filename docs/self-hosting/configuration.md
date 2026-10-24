# Configuration

**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-24

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
that this table and the Compose file list the same variables). "Written by
`install`" means `deploy/setup.sh install` writes the key on every run, keeping
the value already in `deploy/.env`; add any other key by hand
([Applying a change](#applying-a-change)).

| Variable                                     | Written by `install` | Default             | Purpose                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | -------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENVALENS_DOMAIN`                          | yes                  | —                   | Bare domain served over HTTPS; also sets `BETTER_AUTH_URL`, `CORS_ORIGIN` and the web build's API origin.                                                                                                                                                                                                                                      |
| `ACME_EMAIL`                                 | yes                  | —                   | Contact address for Let's Encrypt certificate notices.                                                                                                                                                                                                                                                                                         |
| `EMAIL_FROM`                                 | yes                  | —                   | Sender of app email, e.g. `OpenValens <noreply@example.org>`. See [Email](email.md).                                                                                                                                                                                                                                                           |
| `OPENVALENS_VERSION`                         | yes (every run)      | —                   | Tag of the locally built images; `upgrade` refreshes it from `git describe`.                                                                                                                                                                                                                                                                   |
| `OPENVALENS_PRE_MIGRATE_BACKUP`              | yes                  | `pg_dump`           | Pre-migrate backup mode: `pg_dump`, `hook` or `none`. See [Backups](backup.md).                                                                                                                                                                                                                                                                |
| `OPENVALENS_BACKUP_RETAIN`                   | yes                  | `10`                | Number of `pre-migrate-*` dumps to keep; `0` keeps all.                                                                                                                                                                                                                                                                                        |
| `STORAGE_PROVIDER`                           | yes                  | `local`             | Object storage: `local` (the `storage` volume) or `s3`. See [Object storage](../storage.md).                                                                                                                                                                                                                                                   |
| `STORAGE_S3_ENDPOINT`                        | yes                  | empty               | S3-compatible endpoint origin; empty means the AWS regional endpoint.                                                                                                                                                                                                                                                                          |
| `STORAGE_S3_REGION`                          | yes                  | empty               | Signing region (`auto` for Cloudflare R2); empty means `us-east-1`.                                                                                                                                                                                                                                                                            |
| `STORAGE_S3_BUCKET`                          | yes                  | empty               | Private bucket name. Without it (or the keys) `s3` storage is `off`.                                                                                                                                                                                                                                                                           |
| `STORAGE_S3_FORCE_PATH_STYLE`                | yes                  | `false`             | `true` for MinIO.                                                                                                                                                                                                                                                                                                                              |
| `STORAGE_S3_SSE`                             | yes                  | `AES256`            | Server-side encryption header: `AES256` or `none` (MinIO without KMS).                                                                                                                                                                                                                                                                         |
| `RESEND_API_KEY_FILE`                        | yes (secret file)    | empty               | `/run/secrets/RESEND_API_KEY` when that secret file exists; empty means email is dry-run.                                                                                                                                                                                                                                                      |
| `EMAIL_AUDIT_BCC_FILE`                       | yes (secret file)    | empty               | `/run/secrets/EMAIL_AUDIT_BCC`: a compliance mailbox that gets a BCC of sensitive access-control emails. See [Email](email.md).                                                                                                                                                                                                                |
| `AI_API_KEY_FILE`                            | yes (secret file)    | empty               | `/run/secrets/AI_API_KEY`, the key for `AI_PROVIDER`. Optional for local OpenAI-compatible servers. See [AI provider](#ai-provider).                                                                                                                                                                                                           |
| `ANTHROPIC_API_KEY_FILE`                     | yes (secret file)    | empty               | `/run/secrets/ANTHROPIC_API_KEY`, the legacy Anthropic key; on its own it selects Anthropic ([optional providers](#optional-providers)).                                                                                                                                                                                                       |
| `TELEGRAM_BOT_TOKEN_FILE`                    | yes (secret file)    | empty               | `/run/secrets/TELEGRAM_BOT_TOKEN` to enable Telegram delivery ([optional providers](#optional-providers)).                                                                                                                                                                                                                                     |
| `STORAGE_S3_ACCESS_KEY_ID_FILE`              | yes (secret file)    | empty               | `/run/secrets/STORAGE_S3_ACCESS_KEY_ID` when that secret file exists.                                                                                                                                                                                                                                                                          |
| `STORAGE_S3_SECRET_ACCESS_KEY_FILE`          | yes (secret file)    | empty               | `/run/secrets/STORAGE_S3_SECRET_ACCESS_KEY` when that secret file exists.                                                                                                                                                                                                                                                                      |
| `OIDC_CLIENT_SECRET_FILE`                    | yes (secret file)    | empty               | `/run/secrets/OIDC_CLIENT_SECRET`, the OIDC client secret. See [Single sign-on](oidc.md).                                                                                                                                                                                                                                                      |
| `WEARABLES_OURA_CLIENT_SECRET_FILE`          | yes (secret file)    | empty               | `/run/secrets/WEARABLES_OURA_CLIENT_SECRET`, your Oura app's client secret. See [Wearables](../wearables.md).                                                                                                                                                                                                                                  |
| `WEARABLES_WHOOP_CLIENT_SECRET_FILE`         | yes (secret file)    | empty               | `/run/secrets/WEARABLES_WHOOP_CLIENT_SECRET`, your WHOOP app's client secret. See [Wearables](../wearables.md).                                                                                                                                                                                                                                |
| `WEARABLES_POLAR_CLIENT_SECRET_FILE`         | yes (secret file)    | empty               | `/run/secrets/WEARABLES_POLAR_CLIENT_SECRET`, your Polar app's client secret. See [Wearables](../wearables.md).                                                                                                                                                                                                                                |
| `WEARABLES_POLAR_WEBHOOK_SECRET_FILE`        | yes (secret file)    | empty               | `/run/secrets/WEARABLES_POLAR_WEBHOOK_SECRET`, the Polar webhook signature key; without it Polar is polled.                                                                                                                                                                                                                                    |
| `WEARABLES_WITHINGS_CLIENT_SECRET_FILE`      | yes (secret file)    | empty               | `/run/secrets/WEARABLES_WITHINGS_CLIENT_SECRET`, your Withings app's client secret. See [Wearables](../wearables.md).                                                                                                                                                                                                                          |
| `WEARABLES_GOOGLE_HEALTH_CLIENT_SECRET_FILE` | yes (secret file)    | empty               | `/run/secrets/WEARABLES_GOOGLE_HEALTH_CLIENT_SECRET`, your Google Health app's client secret. See [Wearables](../wearables.md).                                                                                                                                                                                                                |
| `OPENVALENS_ALLOW_MIGRATE_WITHOUT_BACKUP`    | no                   | empty               | Must be exactly `I_HAVE_A_BACKUP` for `OPENVALENS_PRE_MIGRATE_BACKUP=none` to be accepted.                                                                                                                                                                                                                                                     |
| `CSP_MODE`                                   | no                   | `enforce`           | Content Security Policy for the web app and the API: `enforce` or `report-only` (the rollback). See [Content Security Policy](#content-security-policy).                                                                                                                                                                                       |
| `ANALYTICS_ENABLED`                          | no                   | `false`             | Optional product analytics; remains off unless explicitly enabled. Requires the PostHog token and IP-capture attestation below.                                                                                                                                                                                                                |
| `POSTHOG_PROJECT_TOKEN_FILE`                 | yes (secret file)    | empty               | Optional EU PostHog project token file path; keep the token in `deploy/secrets/server/POSTHOG_PROJECT_TOKEN`, not `deploy/.env`.                                                                                                                                                                                                               |
| `POSTHOG_IP_CAPTURE_DISABLED`                | no                   | `false`             | Operator attestation only; set `true` only after disabling IP capture in the EU PostHog project. This setting does not configure PostHog.                                                                                                                                                                                                      |
| `EXERCISE_CATALOG_ASSETS_ENABLED`            | no                   | `false`             | Metadata-gated own-origin exercise media publication; requires configured storage. See [exercise catalog assets](../exercise-catalog-assets.md).                                                                                                                                                                                               |
| `SENTRY_DSN`                                 | no                   | —                   | Optional server error reporting to Sentry; off when unset. See [error reporting](#error-reporting-sentry).                                                                                                                                                                                                                                     |
| `SENTRY_ENVIRONMENT`                         | no                   | `NODE_ENV`          | Sentry environment for server, web and mobile events, e.g. `production` or `staging`.                                                                                                                                                                                                                                                          |
| `SENTRY_RELEASE`                             | no                   | —                   | Release tag (e.g. the deployed commit) shared by server and web events.                                                                                                                                                                                                                                                                        |
| `SOURCE_CODE_URL`                            | no                   | upstream repository | Source link shown under Settings → About (AGPL-3.0 section 13). Set it to your fork's public repository if you run a modified version; see [licensing](licensing.md).                                                                                                                                                                          |
| `VITE_SENTRY_DSN`                            | no                   | —                   | Optional browser error reporting, built into the web image; also allowed in the web CSP.                                                                                                                                                                                                                                                       |
| `API_MAX_BODY_BYTES`                         | no                   | `1048576`           | Largest accepted API request body, in bytes; bigger bodies get `413` before parsing. Photo uploads have their own 11 MiB cap (10 MiB photo plus framing).                                                                                                                                                                                      |
| `EMAIL_REPLY_TO`                             | no                   | empty               | Reply-to address of app email; empty means the `EMAIL_FROM` address.                                                                                                                                                                                                                                                                           |
| `EMAIL_DRY_RUN`                              | no                   | `false`             | `true` logs email instead of sending it. Without a Resend key email is dry-run regardless.                                                                                                                                                                                                                                                     |
| `TELEGRAM_CONNECT_TOKEN_TTL_SECONDS`         | no                   | `600`               | Lifetime of a Telegram connect link, in seconds.                                                                                                                                                                                                                                                                                               |
| `AI_PROVIDER`                                | no                   | empty (off)         | `anthropic` or `openai-compatible`. Empty means AI is off unless `ANTHROPIC_API_KEY_FILE` is set. See [AI provider](#ai-provider).                                                                                                                                                                                                             |
| `AI_BASE_URL`                                | no                   | empty               | Provider API base URL, reachable from the `server` container. Required for `openai-compatible`; must not embed credentials.                                                                                                                                                                                                                    |
| `AI_MODEL`                                   | no                   | empty               | Model id. Required for `openai-compatible`; empty means `claude-sonnet-5-5` for `anthropic`.                                                                                                                                                                                                                                                   |
| `AI_SUPPORTS_STRUCTURED_OUTPUTS`             | no                   | empty (false)       | `true` only if the endpoint honours JSON-schema `response_format`.                                                                                                                                                                                                                                                                             |
| `AI_RATE_LIMIT_PER_MINUTE`                   | no                   | `20`                | Coach chat requests per user and workspace per minute.                                                                                                                                                                                                                                                                                         |
| `FOOD_LOOKUP_PROVIDER`                       | no                   | empty (off)         | `openfoodfacts` enables live barcode lookup for codes missing from the local catalogs. See [Food catalogs](food-catalogs.md#live-barcode-lookup).                                                                                                                                                                                              |
| `FOOD_LOOKUP_USER_AGENT`                     | no                   | empty               | `AppName/Version (contact)` sent to the provider; required for live lookup.                                                                                                                                                                                                                                                                    |
| `FOOD_LOOKUP_BASE_URL`                       | no                   | empty               | Provider or privacy-proxy origin; empty means the public Open Food Facts API.                                                                                                                                                                                                                                                                  |
| `PUSH_PROVIDER`                              | no                   | empty (off)         | `expo` enables insight push notifications through the Expo push service. The server needs no credential, but phones can only register with an app built with an EAS project ID and APNs/FCM credentials in that EAS project: see [Push notifications](mobile-app.md#push-notifications). Pushes carry only generic text, never a health value. |
| `STORAGE_MAX_OBJECT_BYTES`                   | no                   | `26214400`          | Largest stored object (today, a progress photo), in bytes; at most 100 MiB.                                                                                                                                                                                                                                                                    |
| `STORAGE_SIGNED_URL_TTL_SECONDS`             | no                   | `300`               | Lifetime of a signed download URL, in seconds; at most 3600.                                                                                                                                                                                                                                                                                   |
| `OIDC_PROVIDER_ID`                           | no                   | empty               | Id of the optional OIDC provider, used in its redirect URI. See [Single sign-on](oidc.md).                                                                                                                                                                                                                                                     |
| `OIDC_CLIENT_ID`                             | no                   | empty               | OIDC client id. See [Single sign-on](oidc.md).                                                                                                                                                                                                                                                                                                 |
| `OIDC_DISCOVERY_URL`                         | no                   | empty               | The IdP's `https` discovery document URL. See [Single sign-on](oidc.md).                                                                                                                                                                                                                                                                       |
| `OIDC_DISPLAY_NAME`                          | no                   | empty               | Sign-in button label; empty means "Single sign-on".                                                                                                                                                                                                                                                                                            |
| `WEARABLES_WEBHOOKS`                         | no                   | `false`             | `true` registers vendor webhooks on connect; needs public HTTPS. Otherwise wearables are polled. See [Wearables](../wearables.md).                                                                                                                                                                                                             |
| `WEARABLES_OURA_CLIENT_ID`                   | no                   | empty (off)         | Your Oura developer app client id; with its secret file it enables Oura.                                                                                                                                                                                                                                                                       |
| `WEARABLES_WHOOP_CLIENT_ID`                  | no                   | empty (off)         | Your WHOOP developer app client id; with its secret file it enables WHOOP.                                                                                                                                                                                                                                                                     |
| `WEARABLES_POLAR_CLIENT_ID`                  | no                   | empty (off)         | Your Polar developer app client id; with its secret file it enables Polar.                                                                                                                                                                                                                                                                     |
| `WEARABLES_WITHINGS_CLIENT_ID`               | no                   | empty (off)         | Your Withings developer app client id; with its secret file it enables Withings.                                                                                                                                                                                                                                                               |
| `WEARABLES_GOOGLE_HEALTH_ENABLED`            | no                   | `false`             | `true` allows the Google Health adapter (public preview). See [Wearables](../wearables.md).                                                                                                                                                                                                                                                    |
| `WEARABLES_GOOGLE_HEALTH_CLIENT_ID`          | no                   | empty (off)         | Your Google Cloud OAuth client id for the Google Health API.                                                                                                                                                                                                                                                                                   |
| `OPENVALENS_HTTP_PORT`                       | no                   | `80`                | Host port Caddy publishes for HTTP. Let's Encrypt needs the public port 80; change only behind another NAT.                                                                                                                                                                                                                                    |
| `OPENVALENS_HTTPS_PORT`                      | no                   | `443`               | Host port Caddy publishes for HTTPS (TCP and UDP).                                                                                                                                                                                                                                                                                             |

A "secret file" key is set to `/run/secrets/<KEY>` exactly when
`deploy/secrets/server/<KEY>` exists and is not empty, and emptied otherwise, so
the stack never points at a missing file. Secret values themselves never go in
`deploy/.env`: a key such as `AI_API_KEY=...` written there is ignored by the
stack, and `install` warns about it (by name only).

### Applying a change

Add or edit keys at the end of `deploy/.env`, below the line

```text
# --- Your settings: deploy/setup.sh install keeps everything below ---
```

then run:

```bash
deploy/setup.sh upgrade
```

`upgrade` keeps every key in `deploy/.env` and only refreshes
`OPENVALENS_VERSION`. Like every start of the stack, it takes a pre-migrate
backup first ([Upgrading](upgrading.md)).

Re-running `deploy/setup.sh install` is also safe. It rewrites the keys marked
"yes" above, keeping their current values (the secret-file keys follow
`deploy/secrets/server/`), and copies every other line — your keys and
comments below the marker, and any key you added elsewhere in the file —
unchanged. It never regenerates a secret. To change the domain or the email
settings through the installer's questions, run
`deploy/setup.sh install --reconfigure`; to preview the result first, add
`--dry-run`, which works on a private copy of `deploy/.env`.

### What the stack does not expose

`deploy/compose.yml` passes every server variable from the
[environment reference](../reference/env.md) through, except:

- the values the stack sets itself: `NODE_ENV` (`production`),
  `BETTER_AUTH_URL` and `CORS_ORIGIN` (from `OPENVALENS_DOMAIN`),
  `STORAGE_LOCAL_DIR` (the `storage` volume) and the generated secrets
  `DATABASE_URL`, `BETTER_AUTH_SECRET`, `CRON_SECRET` and
  `TELEGRAM_WEBHOOK_SECRET`;
- `AUTH_DEV_MAGIC_LINK_CONSOLE`, which works only in development;
- `TELEGRAM_API_BASE_URL`, an override for local testing.

CI checks this list against the server schema, so a new server variable cannot
be added without deciding whether the stack passes it through. Changing
`deploy/compose.yml` itself is not supported: it is overwritten when you check
out a new version.

## Optional providers

A default install needs no vendor account. Each optional integration is off or
dry-run until you add its key, and the readiness probe reports its state
without revealing any value:

| Family      | Provider                                    | Enable                                                                                                   | Default   |
| ----------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------- |
| `email`     | Resend                                      | `RESEND_API_KEY` secret (see [Email](email.md))                                                          | `dry-run` |
| `ai`        | Anthropic or OpenAI-compatible              | `AI_PROVIDER` and its settings (see [AI provider](#ai-provider)), or only the `ANTHROPIC_API_KEY` secret | `off`     |
| `messaging` | Telegram                                    | `TELEGRAM_BOT_TOKEN` secret + `TELEGRAM_BOT_TOKEN_FILE`                                                  | `off`     |
| `storage`   | Local disk or S3-compatible                 | `STORAGE_PROVIDER=s3`, `STORAGE_S3_*` and the two key secrets (see [Object storage](../storage.md))      | `local`   |
| `oidc`      | Generic                                     | OIDC settings + client secret (see [Single sign-on](oidc.md))                                            | `off`     |
| `wearables` | Oura, WHOOP, Polar, Withings, Google Health | `WEARABLES_<VENDOR>_CLIENT_ID` + client secret file (see [Wearables](../wearables.md))                   | `off`     |

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

Instead of appending the `_FILE` line yourself, you can re-run
`deploy/setup.sh install`: it sets the `_FILE` variable of every secret file
present in `deploy/secrets/server/`.

AI features send data to the provider only behind the in-app consent gates:
once a provider is configured, the workspace owner turns on **Settings → AI
for this workspace**, and each person turns on **Settings → AI processing**
for themselves. See [Turning AI on](../ai-providers.md#turning-ai-on).
Telegram also needs its webhook registered; see [Telegram](#telegram). Object storage defaults to private local
disk on the `storage` volume; to use an S3-compatible bucket (S3, R2, MinIO) set
`STORAGE_PROVIDER=s3` and the `STORAGE_S3_*` settings described in
[Object storage](../storage.md). The adapter rules and the planned families
(wearables #60) are in [docs/integrations.md](../integrations.md).

### AI provider

AI is off by default. To use Anthropic, add the key as the `AI_API_KEY` secret
(or the legacy `ANTHROPIC_API_KEY`, as above) and set:

```bash
AI_PROVIDER=anthropic
```

To use an OpenAI-compatible Chat Completions endpoint (Ollama, vLLM,
llama.cpp, LM Studio or a hosted compatible API), add to `deploy/.env`:

```bash
AI_PROVIDER=openai-compatible
AI_BASE_URL=http://ollama.internal:11434/v1
AI_MODEL=<a model the endpoint serves>
# AI_SUPPORTS_STRUCTURED_OUTPUTS=true   # only if it honours JSON-schema response_format
```

and, if the endpoint needs a key, write it to
`deploy/secrets/server/AI_API_KEY` (mode `0444`, as above) with
`AI_API_KEY_FILE=/run/secrets/AI_API_KEY`. Then run `deploy/setup.sh upgrade`.

`AI_BASE_URL` is resolved from inside the `server` container: `localhost`
there is the container itself, not the host. Use a host name the container can
reach, such as another service on a network `server` joins, or the host's
address. A misconfigured selection (for example `openai-compatible` without
`AI_BASE_URL` or `AI_MODEL`) stops the server at startup with
`AI_CONFIG_INVALID`; check `docker compose -f deploy/compose.yml logs server`.
Model choice, tool-calling and structured-output behaviour are in
[AI providers](../ai-providers.md).

### Telegram

Telegram delivers the daily reminders. Members connect their own chat from
**Settings → Telegram**, and react 👍 or 👎 to a reminder to mark it done or
skipped.

The `remindersDailyRun` job (see [Scheduled jobs](#scheduled-jobs)) runs
hourly. Each member's reminders for their local day are created and sent once,
from the **Reminder time** they chose in their notification settings (08:00 by
default), in the time zone of those settings (UTC when unset). A member gets
one reminder per active supplement or medication taken daily (or with no
frequency set), per weekly or training-day item on the weekdays the member
chose for it, and per scheduled event that recurs that day. Weekly and
training-day items with no days chosen are not reminded (the supplements page
says so). Training days are chosen by hand because the app has no per-member
training calendar to read them from. Only members who chose a channel get
reminders: those who connected Telegram, or who turned on **Daily reminders by
email** in their notification settings (off by default, and separate from the
weekly insight email, because each email names the item). Without a Telegram
bot, reminders still go out by email to the members who turned it on.

If the job misses runs, a member's reminders go out at the next run on the same
local day. Reminders for a day that has already ended are never sent, so an
outage does not end in a burst of old reminders.

1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and keep
   the token it gives you private.
2. Save the token as a secret and apply it:

   ```bash
   read -rs -p 'Telegram bot token: ' key && echo &&
     printf '%s\n' "$key" >deploy/secrets/server/TELEGRAM_BOT_TOKEN && unset key
   chmod 0444 deploy/secrets/server/TELEGRAM_BOT_TOKEN
   echo 'TELEGRAM_BOT_TOKEN_FILE=/run/secrets/TELEGRAM_BOT_TOKEN' >>deploy/.env
   deploy/setup.sh upgrade
   ```

3. Register the webhook with Telegram. Replace `<domain>` with your domain.
   `curl` reads its settings from standard input, so the token and the webhook
   secret never appear on a command line:

   ```bash
   curl -fsS -K - <<EOF
   url = "https://api.telegram.org/bot$(cat deploy/secrets/server/TELEGRAM_BOT_TOKEN)/setWebhook"
   data-urlencode = "url=https://<domain>/api/integrations/telegram/webhook"
   data-urlencode = "secret_token=$(cat deploy/secrets/server/TELEGRAM_WEBHOOK_SECRET)"
   data-urlencode = "allowed_updates=[\"message\",\"message_reaction\"]"
   EOF
   ```

   Telegram answers `{"ok":true,"result":true,...}`. `allowed_updates` must
   include `message` (for the `/start` that connects a chat) and
   `message_reaction` (for reminder reactions); Telegram does not send
   reactions unless they are listed.

`checks.integrations.messaging.state` in the readiness response reads
`configured` once the token is present. To connect, a member presses
**Connect** under Settings → Telegram, then **Open in Telegram** and **Start**.
The bot replies to confirm, and the settings page shows the chat as connected.
A connect link works once and expires after
`TELEGRAM_CONNECT_TOKEN_TTL_SECONDS` (10 minutes by default).

### Content Security Policy

The web app and the API send an enforced Content Security Policy by default
(`CSP_MODE=enforce`). If enforcement breaks sign-in or the app shell, roll back
to report-only while you investigate:

```bash
echo 'CSP_MODE=report-only' >>deploy/.env
deploy/setup.sh upgrade
```

The setting reaches both the `server` and the `web` containers. Remove the line
(or set `CSP_MODE=enforce`) and run `upgrade` again to re-enforce. The rollout
and the violation reports are described in
[docs/security-csp.md](../security-csp.md).

### Error reporting (Sentry)

Off by default: nothing is sent anywhere unless you set a DSN. To report server
errors to your own Sentry project (EU data residency is a Sentry project
setting):

```bash
echo 'SENTRY_DSN=https://<public-key>@<org>.ingest.de.sentry.io/<project>' >>deploy/.env
echo 'SENTRY_ENVIRONMENT=production' >>deploy/.env
echo "SENTRY_RELEASE=openvalens@$(git rev-parse --short HEAD)" >>deploy/.env
deploy/setup.sh upgrade
```

Add `VITE_SENTRY_DSN=...` as well to report browser errors; it is built into the
web image, and its origin is added to the web Content Security Policy. The
mobile app reads `EXPO_PUBLIC_SENTRY_DSN` at build time and reports JavaScript
errors only. Use a separate Sentry project (DSN) per app if you want them apart;
`SENTRY_ENVIRONMENT` and `SENTRY_RELEASE` apply to all of them.

Every event is reduced to the error type, code locations, release and
environment before it leaves the instance: no error messages, request data,
headers, cookies, URLs, user, device details or breadcrumbs, and no performance
tracing. The readiness probe reports `"sentry": true` while server reporting is
on. Uploading source maps is optional and happens on your build machine with
`SENTRY_AUTH_TOKEN`; never put that token in `deploy/.env` or the running stack.

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

The Compose stack does **not** schedule anything. Five jobs must be triggered
from the host, authenticated with the generated `CRON_SECRET`:

| Endpoint                      | Suggested schedule      | Job                                                        |
| ----------------------------- | ----------------------- | ---------------------------------------------------------- |
| `/rpc/cron/remindersDailyRun` | `5 * * * *` (hourly)    | Daily supplement, medication and event reminders           |
| `/rpc/cron/ingestionRun`      | `15 9 * * *` (daily)    | Retry and replay of queued ingestion work                  |
| `/rpc/cron/insightsRun`       | `20 * * * *` (hourly)   | Opt-in insight and preventive-care reminder push and email |
| `/rpc/cron/wearablesSync`     | `*/15 * * * *` (15 min) | Cloud wearable sync; a no-op without a wearable vendor     |
| `/rpc/cron/photoCleanupRun`   | `40 * * * *` (hourly)   | Finishes deleting removed progress photos (25 per run)     |

Add them to the crontab of the user who ran `deploy/setup.sh` (that user can
read `deploy/secrets/`); replace both placeholders:

```bash
5 * * * *    curl -fsS -X POST https://<domain>/rpc/cron/remindersDailyRun -H "Authorization: Bearer $(cat /path/to/openvalens/deploy/secrets/server/CRON_SECRET)" -H 'Content-Type: application/json' -d '{"json":{}}' >/dev/null
15 9 * * *   curl -fsS -X POST https://<domain>/rpc/cron/ingestionRun -H "Authorization: Bearer $(cat /path/to/openvalens/deploy/secrets/server/CRON_SECRET)" -H 'Content-Type: application/json' -d '{"json":{}}' >/dev/null
20 * * * *   curl -fsS -X POST https://<domain>/rpc/cron/insightsRun -H "Authorization: Bearer $(cat /path/to/openvalens/deploy/secrets/server/CRON_SECRET)" -H 'Content-Type: application/json' -d '{"json":{}}' >/dev/null
*/15 * * * * curl -fsS -X POST https://<domain>/rpc/cron/wearablesSync -H "Authorization: Bearer $(cat /path/to/openvalens/deploy/secrets/server/CRON_SECRET)" -H 'Content-Type: application/json' -d '{"json":{}}' >/dev/null
40 * * * *   curl -fsS -X POST https://<domain>/rpc/cron/photoCleanupRun -H "Authorization: Bearer $(cat /path/to/openvalens/deploy/secrets/server/CRON_SECRET)" -H 'Content-Type: application/json' -d '{"json":{}}' >/dev/null
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
