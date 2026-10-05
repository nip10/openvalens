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
