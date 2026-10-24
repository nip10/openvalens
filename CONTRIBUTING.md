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

The same rule applies to npm dependencies. CI runs `bun run licenses:check`,
which fails on any installed package whose licence is missing or outside the
allowlist in [`scripts/license-audit.ts`](scripts/license-audit.ts). If a
dependency genuinely needs an exception, document the reason there.

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
`RESEND_API_KEY`, `EMAIL_AUDIT_BCC`, `TELEGRAM_BOT_TOKEN`, `AI_API_KEY`,
`ANTHROPIC_API_KEY`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY`. Non-sensitive settings (for example `NODE_ENV`,
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
printf '%s\n' 'postgresql://user:pass@db:5432/openvalens' > ./secrets/database_url
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

### Integration adapters

Every external service (email, AI, messaging, object storage, and later OIDC
and wearables) is an optional adapter that is off or dry-run by default, so a
default install needs no vendor account. Follow the adapter contract in
[`docs/integrations.md`](docs/integrations.md): vendor SDK imports belong only
in `packages/*/src/providers/*` (enforced by `oxlint`), configuration is parsed
by the package and bound by the server, and each family reports a value-free
status on the readiness probe.

### Email configuration (explicit, no ambient env)

`@openvalens/email` no longer reads the environment at send time:
`parseEmailConfig` validates an explicit five-field object (`RESEND_API_KEY`,
`EMAIL_FROM`, `EMAIL_REPLY_TO`, `EMAIL_AUDIT_BCC`, `EMAIL_DRY_RUN`), and
`createEmailService(config, defaults?)` returns a frozen `EmailService` that
exposes only `sendEmail` and `organizationName`. The unbound `sendEmail`
requires an explicit `config`; per-call overrides (`config`, `provider`,
`dryRun`, `logger`, `correlationId`) are retained. The ambient
`getEmailConfig`/`resetEmailConfigCache` getters were removed. `createAuth(env,
db, { email, desktopOrigins? })` now takes the bound service as a required
third argument, and template render functions accept an optional
`{ organizationName }` that is presentation-only.

Resend is the only email transport (Issue #61); do not add SMTP or another
provider (`packages/email/src/resend-only.test.ts` guards this). Provider
failures are `EmailTransientError` (retryable: `network`, `timeout`,
`rate_limited`, `provider_unavailable`) or `EmailPermanentError` (`auth`,
`rejected`). Log them with `describeEmailDeliveryError(error)`, which returns
only the typed code, category, retryability, HTTP status and a sanitized
provider error name — never the message, recipient, body or key. Tests inject a
fake `EmailProvider` or `EmailService`; never call the live provider.

## Schema changes

1. Edit `packages/db/src/schema/*`.
2. `bun run db:generate` to create a migration; review the SQL.
3. Follow `docs/migration-safety.md` for tables that hold health data:
   additive first, quarantine instead of delete, no destructive statements in
   the same migration as a rename.
4. Classify every new table in `packages/data-rights/src/registry.ts`
   (`registry.test.ts` fails otherwise). If it holds a member's data, add one
   row for it to `seedEveryModule` in `packages/data-rights/src/testing.ts`:
   the export and erasure suites fail when an exported table has no seeded
   rows, so every module proves its own export and delete coverage (#89).

Never use `db:push` against a database with real data.

## Checks

Run before opening a pull request (CI runs the same):

```bash
bunx oxlint
bunx oxfmt --check .
bun run check-types
bun run i18n:check
bun test
```

User-facing text goes through Lingui macros and needs a pt-PT translation; see
[docs/translations.md](docs/translations.md).

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

## Roles and permissions

- **Workspace roles are organization-scoped.** `owner`, `admin`, `collaborator`
  and `viewer` (see `@openvalens/auth/access/roles`) grant authority inside a
  single workspace and never imply installation-wide authority.
- **Instance administrators are a separate, global authority.** An instance
  administrator is an explicit operator role for the whole installation. It is
  assigned deliberately by a trusted operator; the application never
  auto-promotes a user — not the first user, not a workspace owner, and not the
  creator of an organization.
- **The global settings surface is read-only.** It reports only whether each
  known server configuration key is present and whether it is sensitive; it
  never returns a configuration value. There are no settings writes, tables or
  toggles in this foundation.
- **There is no global read audit yet.** The existing access audit is
  organization-scoped, so global settings reads and future global mutations are
  not audited. Closing that gap (with an organization-independent audit path) is
  tracked separately.

## Pull requests

Keep them focused, link the issue, and describe how you verified the change.

## Accounts and instance admission

OpenValens has no public sign-up. Accounts are created only by the admission
flow: a one-time setup token bootstraps the first global instance administrator,
after which only a global administrator may invite accounts. When contributing
to auth, keep these invariants:

- Do **not** add a Better Auth sign-up, magic-link provisioning, or admin
  create-user path — the auth factory intentionally rejects every SDK account
  creation, and this must not reopen even if the last administrator is removed.
- Global admission (`/join`) may admit a **new** account: proof completion
  atomically creates a verified `user` role with no prior session. An
  **existing** global recipient additionally needs a matching live,
  non-impersonated, verified, unbanned account/session, and its role is
  preserved.
- Workspace invitations (SDK `/organization/invite-member` and the oRPC sharing
  surface) may target an **existing** unambiguous account only. The shared
  lookup confirms the account exists at **issuance**; the live, verified,
  unbanned session is required at **acceptance** by the current auth SDK guard.
  Do not require the target to be logged in at issuance, and never let an
  invitation create an account.
- A workspace `owner` has organization-scoped powers only; never grant
  instance-administrator authority through an organization role or invite.
- This admission change leaves current instance configuration read-only startup
  `ENV`. Editable database-backed product settings remain separate Issue #58
  work — do not introduce a UI-write or database-editable settings surface here.
- Secrets: the setup token is minted privately by the operator and is never
  emailed. Admission invitation bearers and proof codes are delivered in the
  message body only — never as a URL — and admission secrets are never echoed in
  logs or generated in the client.
- Never phrase a change as closing the remaining admission work: use
  **Related:** #63 and describe remaining work explicitly.

Related: #63 — the self-host installer (`deploy/setup.sh`, see
`docs/self-hosting/install.md`) mints the setup token; encrypted backup/restore remains
deferred to #64 and reference-VPS resource measurement is outstanding; editable product
settings and settings-change auditing remain separate Issue #58 work. The admission
web UI has passed its independent security gate; deployment is separately authorized.
