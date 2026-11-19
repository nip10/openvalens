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

## Exercise catalog sample

Before the accounts, the seed imports the small committed exercise sample from
`packages/exercise-catalog/sample/` (Issue #400): 12 wger exercises with their
Workout Guide frames. It also marks the database as a _sample instance_, so
when the server starts it publishes those frames from disk and never fetches
the full catalog, which keeps e2e and screenshots offline. The demo routines and
workouts use these catalog exercises, so they show their images; the review
seed does the same when the instance has the catalog and falls back to
workspace exercises when it doesn't. Licences are in
`DATA-LICENSES.md` and `REUSE.toml`.

## How the data is written

Accounts go through the admission core (`createAdmissionService`): setup
token, emailed code (captured in memory), invitation. Workspaces come from the
same bootstrap a first sign-in runs. Sam joins Alex's workspace with the rows
`sharing.createInvitation` and Better Auth's accept write.

Everything else goes through the real oRPC router in process (`src/api.ts`),
so it passes the same validation, ownership checks, audit and derived writes
as the apps. Only the session lookup is replaced: it resolves the acting
person from the database and checks permissions with the Better Auth roles.

Both entry points run the same list of module seeders, `seedPersonData` in
`src/person.ts`: `seedDemo` for Alex in the disposable instance, and
`seedReviewAccount` for the review account.

- Phone and watch data (`mobile.ingestBatch`, as the Android app syncs Health
  Connect): steps, distance, active energy, heart rate, sleep with stages,
  cardio workouts, weight and body fat.
- Resting heart rate and HRV, overnight SpO₂ and respiration rate, blood
  pressure typed in twice a week, and lab readings
  (`healthRecord.ingestMetricSample`).
- Strength training: custom exercises, two routines, twice-weekly sessions
  with progressing sets (`exerciseCatalog`, `plans.routines`, `plans.workouts`).
- Meal diary, plain water and nutrition targets; favourite foods, two saved
  meals (`nutritionTemplates`), and a morning coffee with the caffeine totals
  on, so the drinks summary and the sleep screen's caffeine note show.
- Two goals in the goal model the Goals screens read (`goals.*`): "Reach 65 kg"
  (a target with two milestones that reads the scale's weigh-ins) and "Sleep 7.5
  hours a night" (a rolling average fed by the synced sleep).
- Supplements and a medication with four weeks of actual intakes
  (`supplementIntake`), cycle logging, preventive care, family history and
  private body measurements.
- Custom trackers: Meditation, linked to the Health Connect mindfulness feed
  and filled by a feed import (`trackers.importFeed`), and a typed-in 1–5 mood.
- The pain layer of the body map: lower-back stiffness after the deadlift day
  and an occasional knee ache after a run (`pain.*`).
- Opt-ins: reference comparisons for every metric (Scores) and nutrition
  observations on the insights panel; the micronutrient summary, the logging
  streak and a height (168 cm) in the nutrition settings; and the wellness
  profile.
- One short, past coach conversation about the "Sleep higher than your usual"
  insight: fixed synthetic text, inserted as `ai.chat` stores it. No AI call
  is made.

Entries with a time (intakes, tracker entries, pain) end yesterday, because
those procedures refuse a time in the future and the default demo never reads
the clock.

Clock times are hours on the person's wall clock. The default demo's hours are
UTC and its records say `Europe/London` (as they always have). The review
variant passes its `--time-zone` and the moment it runs (`createCalendar` in
`src/dates.ts`): hours are then that zone's wall clock, and nothing is dated
later than that moment. Today's steps stop at the current hour, today's meals,
water and readings at the moment of seeding, and a night still going has not
synced yet.

The seed writes 90 days at once, so every diary entry's `created_at` would be
the moment of seeding, and the logging streak (which counts a day only when it
was logged by the next day) would show two days. `backdateDiaryEntries` moves
each entry's write time to its own time on its day.

A few rows have no app write path yet and are inserted the way an import
would store them: lab marker definitions (with their units), the muscles of
the custom exercises (the wger catalog carries them), two DEXA scans (80 days
and 6 days ago, so the body map can compare them), one ECG and one imaging
study, a few label micronutrients on the custom foods (`createFood` takes the
core nutrients only), and the coach conversation.

After the guarded record transaction commits, all three CLI variants add two
clearly labeled synthetic progress photos through the normal sanitization and
private-storage lifecycle (`src/photos.ts`). They use the server's storage
settings, including mounted S3 secret files; relative local paths resolve from
`apps/server`, matching the server. Incomplete S3 settings skip this stage
without inventing photo metadata. The account must have private body tracking
on. Existing photos are kept and matching fixture hashes are not uploaded
again. Daily refreshes retain the same objects. If a photo upload fails, the
records are already committed; rerunning the command safely retries photos.
The assets and generation prompts are in `assets/README.md`.

Not seeded, because they need an external service or have no write path the
seed can use: wearable connections (OAuth), Telegram, connected AI apps,
and drink presets (catalog foods).

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

## Review account variant

`bun run demo:seed:review` writes the same synthetic data (Alex Morgan's
history, ending today) into the existing app store review account on a real
database, for example inside the production API container. Its region is the
United States (`REVIEW_REGION`), so Preventive care shows the USPSTF cervical
screening item instead of the NHS one. It reads the
server's `DATABASE_URL`, `REVIEW_ACCOUNT_EMAIL` and `REVIEW_ACCOUNT_CODE`, never
resets anything, writes only to that account's own workspace, refuses unless
the account is the sole owner of exactly one empty workspace, and a second run
changes no records (`src/review.ts`). Record seeding is one transaction, so a
record-stage failure leaves the workspace as it was. The separate photo stage
can fill missing synthetic fixtures even on an already-seeded account.

`--refresh` is the nightly scheduled task. It erases the records of a workspace
it seeded before (data rights' `eraseSubjectRecords`, which keeps the account,
its sessions, consents, subscription and audit log), writes a fresh 90 days
ending today (`--time-zone Area/City` picks whose "today" and whose wall clock,
and the data stops at the moment it runs), names the account Alex Morgan, and
keeps the local trial running. See
[docs/store-review-account.md](../../docs/store-review-account.md).

## Tests

- `demo-seed.test.ts`: guard, options, determinism helpers, and the CLI
  refusing a non-disposable database.
- `demo-seed.integration.test.ts` (`DEMO_SEED_TEST_DATABASE_URL`, database
  `openvalens_demo_test`, run by `scripts/test-integration.sh`): seeds, checks
  that every screen's read has content, seeds again and compares fingerprints.
- `review.integration.test.ts` (`DEMO_SEED_REVIEW_TEST_DATABASE_URL`, database
  `review_seed_test`): seeds a real Cloud sign-up's workspace, reruns as a
  no-op, checks every refusal, refreshes (records replaced, sessions and the
  audit log kept, trial extended, a Stripe-managed subscription left alone),
  checks that a `--time-zone` run dates nothing after its `now` and that its
  nights end in the morning on that zone's clock, and checks that a run
  failing part-way changes nothing. `review-cli.test.ts` covers the command's
  refusals before it opens a database.
