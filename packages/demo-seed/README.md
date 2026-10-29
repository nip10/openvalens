# Demo seed (Issue #301)

`bun run demo:seed` fills a disposable database with one synthetic person,
**Alex Morgan**, and about 90 days of data in every module, so screenshots,
end-to-end tests, the landing page and the App Review demo account all show
the same believable account. Nothing in it comes from a real person.

```sh
docker run -d --rm --name openvalens-demo -e POSTGRES_PASSWORD=pw -p 127.0.0.1:5432:5432 postgres:17
docker exec openvalens-demo createdb -U postgres openvalens_demo
DEMO_DATABASE_URL=postgres://postgres:pw@127.0.0.1:5432/openvalens_demo \
  bun run demo:seed [--today YYYY-MM-DD] [--cloud]
```

## Safety

- It reads only `DEMO_DATABASE_URL`, never `DATABASE_URL`, and refuses to run
  unless the host is loopback and the database is named `openvalens_demo` or
  `openvalens_demo_<suffix>` (the same kind of guard the integration suites
  use). The refusal never prints the URL.
- **Every run resets the database**: it drops the `public` and `drizzle`
  schemas and applies all migrations (recorded the way `bun run db:migrate`
  records them), then seeds. Running it twice gives the same result. It never
  merges into existing data.

## Determinism

- One fixed seed (`DEMO_SEED` in `src/random.ts`) and one forked stream per
  module, so a change to one module does not shift the values of another.
- Every date is an offset from one "today": `2026-10-28` by default, or
  `--today YYYY-MM-DD` / `DEMO_SEED_TODAY`. The app reads the real clock to
  decide what "today" and "the last 30 days" are, so seed with today's date
  (`--today "$(date -u +%F)"`) when you want the screens to show the data.
- Client mutation ids and device ids are derived from fixed labels.
- Account and workspace ids come from the admission core, which generates
  random ids by design; they differ between runs. Everything the person sees
  is identical, which `demo-seed.integration.test.ts` checks with
  `demoFingerprint` (all tables, UUIDs masked, write times left out).

## Who is in it

| Person      | Email                     | Role                                                                 |
| ----------- | ------------------------- | -------------------------------------------------------------------- |
| Alex Morgan | `alex.morgan@example.com` | Instance admin (setup token), owner of their workspace, all the data |
| Sam Rivera  | `sam.rivera@example.com`  | Admitted by Alex's invitation; own workspace, and `member` of Alex's |

There is also one pending admission invitation (`jordan.lee@example.com`) so
the admin screen has something to list. Both people finished setup with every
module on, so they land on the dashboard, not `/welcome`.

## How the data is written

Accounts go through the admission core (`createAdmissionService`): setup
token, emailed code (captured in memory), invitation. Workspaces come from the
same bootstrap a first sign-in runs. Sam joins Alex's workspace with the rows
`sharing.createInvitation` and Better Auth's accept write.

Everything else goes through the real oRPC router in process (`src/api.ts`),
so it passes the same validation, ownership checks, audit and derived writes
as the apps. Only the session lookup is replaced: it resolves the acting
person from the database and checks permissions with the Better Auth roles.

- Phone and watch data (`mobile.ingestBatch`, as the Android app syncs Health
  Connect): steps, distance, active energy, heart rate, sleep with stages,
  cardio workouts, weight and body fat.
- Resting heart rate and HRV, and lab readings (`healthRecord.*`).
- Strength training: custom exercises, two routines, twice-weekly sessions
  with progressing sets (`exerciseCatalog`, `plans.routines`, `plans.workouts`).
- Meal diary, plain water and nutrition targets.
- Goals, supplements and a medication, cycle logging, preventive care, family
  history, private body measurements, and the wellness profile.

A few rows have no app write path yet and are inserted the way an import
would store them: lab marker definitions (with their units), the muscles of
the custom exercises (the wger catalog carries them), one DEXA scan, one ECG
and one imaging study.

The last week is deliberately better than the four before it (more sleep, more
steps, lower resting heart rate), so the insights screen has changes to report.

## Signing in

Run the server against the seeded database with the dev magic-link sink:

```sh
DATABASE_URL=postgres://postgres:pw@127.0.0.1:5432/openvalens_demo \
NODE_ENV=development EMAIL_DRY_RUN=true AUTH_DEV_MAGIC_LINK_CONSOLE=true \
  bun run dev:server
```

Ask for a sign-in link for `alex.morgan@example.com` (or Sam) on `/login`. The
server prints it; Varlock masks the `BETTER_AUTH_URL` origin in console output,
so put that origin back before opening it. `apps/site/scripts/capture-screenshots.ts`
takes the same link as `SITE_SCREENSHOT_MAGIC_LINK`.

## Cloud variant

`--cloud` prepares the App Review demo account: Alex, the workspace owner,
gets the same local, card-free 30-day trial a Cloud sign-up starts (#297),
through `startTrial` in `@openvalens/billing/trial` (`src/cloud.ts`). The trial
runs from the time you seed, not from `--today`, so it is still running while
reviewers use the account. No Stripe customer is created. Run the server with
`DEPLOYMENT_MODE=cloud` (and the Stripe test-mode keys) to see Plan & billing.

## Tests

- `demo-seed.test.ts`: guard, options, determinism helpers, and the CLI
  refusing a non-disposable database.
- `demo-seed.integration.test.ts` (`DEMO_SEED_TEST_DATABASE_URL`, database
  `openvalens_demo_test`, run by `scripts/test-integration.sh`): seeds, checks
  that every screen's read has content, seeds again and compares fingerprints.
