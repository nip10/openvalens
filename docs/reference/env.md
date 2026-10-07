# Environment reference

> **Generated file — do not edit by hand.** Regenerate with `bun run docs:generate`; CI fails if this file is stale (`bun run docs:check`).

Each section below is generated from the committed `.env.schema` file linked in its heading. Defaults are the schema defaults only; at runtime the process environment supplies the actual values.

## Legend

- **Required** — the schema marks the variable required (`@defaultRequired` / `@optional`). This is independent of whether a default exists.
- **Sensitive** — marked as sensitive for Varlock redaction; sensitive defaults are never included here.
- **Type** — the `@type` constraint declared in the schema.
- **Default** — the schema default. `—` means unset; `Hidden (sensitive)` means a sensitive default exists but is not shown.
- **\_FILE** — `Yes` when a `<KEY>_FILE` companion is supported for this variable.

## Server — [`apps/server/.env.schema`](../../apps/server/.env.schema)

| Variable                             | Required | Sensitive | Type                                | Default                    | Description                                                                                                                                                                                                                                    | _FILE |
| ------------------------------------ | -------- | --------- | ----------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `NODE_ENV`                           | Yes      | No        | enum(development, production, test) | `development`              |                                                                                                                                                                                                                                                | No    |
| `BETTER_AUTH_SECRET`                 | Yes      | Yes       | string(minLength=32)                | —                          |                                                                                                                                                                                                                                                | Yes   |
| `BETTER_AUTH_URL`                    | Yes      | Yes       | url                                 | —                          |                                                                                                                                                                                                                                                | Yes   |
| `CORS_ORIGIN`                        | Yes      | Yes       | url                                 | —                          |                                                                                                                                                                                                                                                | Yes   |
| `DATABASE_URL`                       | Yes      | Yes       | string(minLength=1)                 | —                          |                                                                                                                                                                                                                                                | Yes   |
| `CRON_SECRET`                        | Yes      | Yes       | string(minLength=16)                | —                          | Bearer token required by cron-only oRPC procedures (`cronProcedure`).                                                                                                                                                                          | Yes   |
| `RESEND_API_KEY`                     | No       | Yes       | string                              | —                          | Resend API key. When unset, email sends are dry-run only.                                                                                                                                                                                      | Yes   |
| `EMAIL_FROM`                         | Yes      | No        | string(minLength=5)                 | —                          | Sender address, e.g. `Health <noreply@health.example>`.                                                                                                                                                                                        | No    |
| `EMAIL_REPLY_TO`                     | No       | No        | email                               | —                          | Reply-to address. Defaults to the sender address when unset.                                                                                                                                                                                   | No    |
| `EMAIL_AUDIT_BCC`                    | No       | Yes       | email                               | —                          | Compliance mailbox that receives a BCC receipt of sensitive flows.                                                                                                                                                                             | Yes   |
| `EMAIL_DRY_RUN`                      | Yes      | No        | boolean                             | `true`                     | Skip the provider call and log a dry-run event. Forced on when no API key.                                                                                                                                                                     | No    |
| `AUTH_DEV_MAGIC_LINK_CONSOLE`        | No       | No        | boolean                             | `false`                    | Local development only: print magic sign-in links to the server console when<br>email is a dry run (no RESEND_API_KEY). This exposes a sign-in credential in<br>console output, which may be retained; enabled only when NODE_ENV=development. | No    |
| `TELEGRAM_BOT_TOKEN`                 | No       | Yes       | string                              | —                          | Bot token from @BotFather. When unset, Telegram delivery is disabled.                                                                                                                                                                          | Yes   |
| `TELEGRAM_WEBHOOK_SECRET`            | Yes      | Yes       | string(minLength=16)                | —                          | Secret echoed by Telegram in `X-Telegram-Bot-Api-Secret-Token`.                                                                                                                                                                                | Yes   |
| `TELEGRAM_CONNECT_TOKEN_TTL_SECONDS` | Yes      | No        | number                              | `600`                      | Connect-token TTL in seconds.                                                                                                                                                                                                                  | No    |
| `TELEGRAM_API_BASE_URL`              | Yes      | No        | string(minLength=1)                 | `https://api.telegram.org` | Telegram Bot API base URL (override for local testing).                                                                                                                                                                                        | No    |
| `ANTHROPIC_API_KEY`                  | No       | Yes       | string                              | —                          | Anthropic API key. When unset, AI features degrade gracefully: readiness<br>reports `anthropic: false` and `ai.chat` fails closed.                                                                                                             | Yes   |
| `AI_MODEL`                           | Yes      | No        | string(minLength=1)                 | `claude-sonnet-5-5`        | Model id used for chat. Must be a current Claude API model id.                                                                                                                                                                                 | No    |
| `AI_RATE_LIMIT_PER_MINUTE`           | Yes      | No        | number                              | `20`                       | Per-(userId, organizationId) chat budget, in requests per minute.                                                                                                                                                                              | No    |

## Web — [`apps/web/.env.schema`](../../apps/web/.env.schema)

| Variable          | Required | Sensitive | Type                                | Default       | Description | _FILE |
| ----------------- | -------- | --------- | ----------------------------------- | ------------- | ----------- | ----- |
| `NODE_ENV`        | Yes      | No        | enum(development, production, test) | `development` |             | No    |
| `VITE_SERVER_URL` | Yes      | No        | url                                 | —             |             | No    |

## Native — [`apps/native/.env.schema`](../../apps/native/.env.schema)

| Variable                 | Required | Sensitive | Type                                | Default       | Description | _FILE |
| ------------------------ | -------- | --------- | ----------------------------------- | ------------- | ----------- | ----- |
| `NODE_ENV`               | Yes      | No        | enum(development, production, test) | `development` |             | No    |
| `EXPO_PUBLIC_SERVER_URL` | Yes      | No        | url                                 | —             |             | No    |

## Database — [`packages/db/.env.schema`](../../packages/db/.env.schema)

| Variable       | Required | Sensitive | Type                                | Default       | Description | _FILE |
| -------------- | -------- | --------- | ----------------------------------- | ------------- | ----------- | ----- |
| `NODE_ENV`     | Yes      | No        | enum(development, production, test) | `development` |             | No    |
| `DATABASE_URL` | Yes      | Yes       | string(minLength=1)                 | —             |             | Yes   |

## File-based secrets

Every sensitive server variable whose `_FILE` column is `Yes` also accepts a `<KEY>_FILE` companion pointing at a file whose contents become the value (Docker/Kubernetes secret mounts, systemd `LoadCredential`, etc.). The database profile resolves only `DATABASE_URL` through `DATABASE_URL_FILE`.

- `_FILE` values are read from the **runtime environment**; a standalone `varlock load` / `varlock run` does **not** resolve them.
- Relative paths resolve against the process working directory; absolute paths such as `/run/secrets/<key>` are recommended in containers.
- File-resolution errors fail closed and name keys only — never paths or contents. Values must be strict UTF-8, non-empty, at most 64 KiB, and free of NUL bytes.

See [File-based secrets in CONTRIBUTING.md](../../CONTRIBUTING.md#file-based-secrets) for the full policy.

## Bootstrap runtime environment

The defaults listed above are the schema defaults only. At runtime the process environment (or a `.env` file loaded by Bun) supplies the actual values, and Varlock validates them against the same schema. `_FILE` companions are not a Varlock feature — this repository's bootstrap code resolves them before Varlock runs.
