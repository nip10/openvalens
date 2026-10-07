# Contributing to OpenValens

Thanks for helping. OpenValens handles personal health data, so a few rules
below are strict.

## Licensing and sign-off (DCO)

OpenValens is licensed under **AGPL-3.0-or-later** with an additional
permission for app-store distribution ([`LICENSE`](LICENSE),
[`LICENSE-APP-STORE`](LICENSE-APP-STORE)). There is no CLA.

Every commit must carry a [Developer Certificate of Origin](https://developercertificate.org/)
sign-off. By signing off you license your contribution under
AGPL-3.0-or-later together with the additional permission in
`LICENSE-APP-STORE`.

```bash
git commit -s -m "feat(x): ..."
```

This adds `Signed-off-by: Your Name <you@example.com>`, matching your commit
author. CI rejects pull requests with unsigned commits. To fix a branch:
`git rebase --signoff origin/main` and force-push.

Only contribute code you wrote or that is under a licence compatible with
AGPL-3.0 **and** the app-store permission (MIT, Apache-2.0, BSD and similar are
fine; GPL/AGPL code from other projects is not, unless it carries an
equivalent permission). Bundled datasets keep their own licences and must be
recorded; non-commercial (CC BY-NC) data is not accepted.

## Development setup

```bash
bun install
bun run db:start      # local Postgres via Docker (bound to localhost only)
bun run db:migrate    # apply migrations
bun run dev           # web on :3001, API on :3000
```

Environment variables are validated by Varlock from each app's `.env.schema`;
copy values into `apps/*/.env` (never commit them).
The server also rejects a bounded set of obvious placeholder values for
`BETTER_AUTH_SECRET` and `CRON_SECRET` at production startup. Configure real
secrets before deploying; this check is not a general secret-strength test.

The complete variable list, with types, defaults and `_FILE` support, is generated into [`docs/reference/env.md`](docs/reference/env.md); run `bun run docs:generate` after editing a schema.

### File-based secrets

Every sensitive key in `apps/server/.env.schema` accepts a `<KEY>_FILE` variant,
so secrets can come from Docker/Kubernetes secret mounts instead of plain
environment values. Supported keys: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`CORS_ORIGIN`, `DATABASE_URL`, `CRON_SECRET`, `TELEGRAM_WEBHOOK_SECRET`,
`RESEND_API_KEY`, `EMAIL_AUDIT_BCC`, `TELEGRAM_BOT_TOKEN`,
`ANTHROPIC_API_KEY`. Non-sensitive settings (for example `NODE_ENV`,
`EMAIL_FROM`, `AI_MODEL`) are not file-resolved; an unknown `*_FILE` such as
`NODE_ENV_FILE` is ignored.

- The file's contents become the value. An empty `<KEY>_FILE` path is treated as
  unset. Setting both a non-empty `<KEY>` and a non-empty `<KEY>_FILE` is
  ambiguous and fails before any file is opened.
- Paths are resolved relative to the process working directory; prefer absolute
  paths such as `/run/secrets/<key>` in containers.
- The target must be a regular file (symlinks to regular files are followed, so
  Kubernetes mounts work). Directories, FIFOs, unreadable or missing files,
  invalid UTF-8, NUL bytes, empty/whitespace-only contents, and files larger than
  64 KiB are rejected.
- Only trailing CR/LF is stripped (so `echo value > file` works); other
  whitespace is preserved.
- All selected files are validated before the process starts, and errors name
  keys only — never paths or contents. Configure secrets before deploying.

`_FILE` values are read from the **runtime environment**: standard Bun `.env`
autoloading and platform environment variables populate `process.env`. A
standalone `varlock load`/`varlock run` invocation does **not** resolve `*_FILE`
variants; only the server and database entrypoints do. Varlock reports normal
schema-validation failures with masked values; this project's file resolution
failures additionally name keys only.

Bind-mount a private directory read-only and point `<KEY>_FILE` at the mount
path:

```yaml
services:
  server:
    environment:
      DATABASE_URL_FILE: /run/secrets/database_url
    volumes:
      - ./secrets:/run/secrets:ro
```

```bash
install -d -m 0700 ./secrets
printf '%s\n' 'postgresql://user:pass@db:5432/openhealth' > ./secrets/database_url
chmod 0600 ./secrets/database_url
```

The server image runs as the non-root `bun` user (uid 1000). Prefer secret files
owned by that UID with mode `0400`/`0600` and a directory readable only by that
UID (`0700`/`0500`). When host and container UIDs differ (for example a local
bind-mount fixture), the fallback is mode `0444` files inside a `0755`
subdirectory under a `0700` host parent: Docker mounts the subdirectory
read-only, so the container only sees `/run/secrets` and the host parent stays
private. `docker secret create` is a Docker Swarm feature and does not populate
a Compose bind mount.

The `auth:generate` script runs the Better Auth CLI against
`apps/server/src/services.ts`, which imports `src/env.server.ts`; it therefore
uses the same checked Varlock bootstrap (including `*_FILE`) and needs no
separate `varlock run` wrapper.

## Schema changes

1. Edit `packages/db/src/schema/*`.
2. `bun run db:generate` to create a migration; review the SQL.
3. Follow `docs/migration-safety.md` for tables that hold health data:
   additive first, quarantine instead of delete, no destructive statements in
   the same migration as a rename.

Never use `db:push` against a database with real data.

## Checks

Run before opening a pull request (CI runs the same):

```bash
bunx oxlint
bunx oxfmt --check .
bun run check-types
bun test
```

Database integration suites: `PG_ADMIN_URL=postgres://postgres:pw@127.0.0.1:5432 scripts/test-integration.sh`
against a disposable Postgres.

## Health data rules

- **Fixtures and tests use synthetic data only.** No real names, dates of
  birth, lab results, screenshots or exports, even your own.
- **No health values in logs**, error messages or analytics. Log identifiers
  and counts, not payloads.
- Keep queries scoped to the active organization; derive tenant and user from
  the server session, never from client input.
- AI features stay behind the existing consent gate.
- Copy follows the wording rules in
  `docs/research/reports/Legal and clinical gate decisions.md`: describe what
  the app records and shows; never claim to diagnose, detect, predict or treat.

## Pull requests

Keep them focused, link the issue, and describe how you verified the change.
