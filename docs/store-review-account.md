# Store review account

Apple App Review and Google Play review need a login they can type in.
OpenValens signs people in with emailed links, so a server can name **one**
existing account that may also sign in with a fixed code. This page covers the
settings, creating and seeding the account, and what to give the reviewers.

## How it works

- Two server settings turn it on: `REVIEW_ACCOUNT_EMAIL` and
  `REVIEW_ACCOUNT_CODE` (at least 12 characters; a shorter code stops the
  server at startup). It is off unless both are set.
- The sign-in screens on the web and in the app always show a small **Have a
  sign-in code?** link under the email field. It reveals a code field. Only
  the review email can use a code: a wrong code, any other email and the
  feature being off all give the same "That email and code do not match."
  error, so the screen never tells anyone which email is the review account.
- The code signs in through Better Auth (`POST /api/auth/sign-in/review-code`)
  and starts a normal session, exactly like a magic link. The account must
  already exist; this path never creates one.
- The email and the code are compared in constant time. Attempts are limited
  to 5 a minute per IP address. Every attempt while the feature is on is
  written to the audit log of the review account's own workspace
  (`REVIEW_SIGN_IN_SUCCEEDED` / `REVIEW_SIGN_IN_FAILED` with a reason), with
  ids only: never the submitted email or code.

## Set it up on OpenValens Cloud

1. **Create the account through the normal sign-up** at
   `https://app.openvalens.com/signup`, with an address you control (for
   example `appreview@openvalens.com`). It accepts the terms and the
   health-data consent and starts the 30-day trial like any Cloud account.
   Open the emailed link once, then sign out. Do not invite anyone into its
   workspace.
2. **Set the two settings** on the `openvalens-api` resource in Coolify
   (Environment variables), then redeploy the API:

   | Setting                | Value                                                         |
   | ---------------------- | ------------------------------------------------------------- |
   | `REVIEW_ACCOUNT_EMAIL` | the account's email                                           |
   | `REVIEW_ACCOUNT_CODE`  | a long random code, e.g. the output of `openssl rand -hex 12` |

   Mark the code as a secret in Coolify. With Docker Compose, put it in
   `deploy/secrets/server/REVIEW_ACCOUNT_CODE` and set
   `REVIEW_ACCOUNT_CODE_FILE=/run/secrets/REVIEW_ACCOUNT_CODE` instead.

3. **Seed the demo data** (next section).
4. **Check it:** on `https://app.openvalens.com/login`, choose **Have a
   sign-in code?**, enter the email and the code, and confirm the dashboard
   shows the demo data. Do the same in the app.

## Seed the demo data

`bun run demo:seed:review` fills the review account's workspace with the same
synthetic history as the demo instance (#301): 90 days in every module, ending
today. Run it inside the production API container, which already has
`DATABASE_URL`, `REVIEW_ACCOUNT_EMAIL` and `REVIEW_ACCOUNT_CODE`:

```sh
# Coolify: openvalens-api › Terminal (or `docker exec -it <api container> sh`)
cd /app && bun run demo:seed:review

# Docker Compose (self-hosted):
docker compose -f deploy/compose.yml exec -w /app server bun run demo:seed:review
```

`--today YYYY-MM-DD` sets the newest day; the default is the current UTC day.
Add `--time-zone America/Los_Angeles` (any IANA zone) to put the clock times
on the reviewers' wall clock; without it the hours are UTC.
The data ends on that day and the screens read the real clock, so seed shortly
before you submit a build.

It refuses, changing nothing, unless:

- review sign-in is configured (both settings set);
- exactly one account has `REVIEW_ACCOUNT_EMAIL` (it never creates one);
- that account is not an instance administrator;
- the account belongs to exactly one workspace, which it owns alone;
- that workspace holds no records yet (only setup rows such as onboarding and
  preferences).

It never deletes anything and only writes to that one workspace, through the
same procedures as the apps (a few import-only rows, such as a DEXA scan, are
inserted the way an import stores them).

**Idempotent:** a successful run records `REVIEW_DEMO_SEEDED` in the
workspace's audit log. Running it again prints "already seeded" and writes
nothing.

**All or nothing:** the whole run is one database transaction. If it fails,
the workspace is left as it was, and you can simply run it again.

## Keep it fresh: the nightly refresh

The data does not move forward on its own. Screens such as today's diary,
readiness and insights read the real clock, so after a week or two the account
looks empty. The `--refresh` mode fixes that. Run it every night as a
scheduled task:

```sh
cd /app && bun run demo:seed:review --refresh --time-zone America/Los_Angeles
```

Each run, in one transaction:

1. checks the same account rules as above (one account, not an admin, sole
   owner of exactly one workspace);
2. if the workspace was seeded before (`REVIEW_DEMO_SEEDED` is in its audit
   log), erases its records. This is the records-only erasure from
   `@openvalens/data-rights`, which keeps the account, its sessions and
   sign-in methods, consents, legal acceptances, subscription, setup state,
   connections, stored files and the audit log. Reviewers stay signed in.
   Anything a reviewer entered is erased, and so are the record-level audit
   rows (`RECORD_*`) that describe the erased records;
3. if the workspace was never seeded and is empty, it seeds it. That covers a
   newly created review account. If it holds records the seed did not write,
   it refuses and changes nothing;
4. writes a fresh 90 days ending today in `--time-zone`, and records
   `REVIEW_DEMO_REFRESHED` in the audit log. Clock times are that zone's
   wall clock (nights run about 22:30 to 07:00 there, blood pressure is a
   07:30 reading), and nothing is dated after the moment the task runs:
   today's steps, meals and readings stop there, and a night still going has
   not synced yet. The account is named Alex Morgan;
5. keeps a local trial running for another 30 days, so the workspace never
   turns read-only. A subscription that Stripe manages is left alone.

A run takes well under a minute. Readers never see a half-written workspace, and a
failed run changes nothing (the next day's run simply tries again).

**Schedule it** in Coolify: `openvalens-api` › Scheduled Tasks › Add:

| Field     | Value                                                                           |
| --------- | ------------------------------------------------------------------------------- |
| Name      | `reviewAccountRefresh`                                                          |
| Command   | `cd /app && bun run demo:seed:review --refresh --time-zone America/Los_Angeles` |
| Frequency | `10 17 * * *`                                                                   |
| Timeout   | `600` seconds                                                                   |

At 17:10 UTC it is 09:10 in Los Angeles in winter and 10:10 in summer.
Apple's reviewers are mostly in California, so they start their day with last
night's sleep, the morning weigh-in, breakfast and the morning readings
already in. A run just after midnight would leave today empty and last night
missing all day, because the seed writes nothing later than the moment it
runs. With Docker
Compose, put the same command in the host's crontab, through `docker compose
exec -T -w /app server`.

`--time-zone` takes any IANA zone, and `--today YYYY-MM-DD` still works; the
default is the current UTC day.

## What to give the reviewers

In App Store Connect (App Review Information › Sign-in required) and the Play
Console (App access › All or some functionality is restricted):

- **Username:** the review email.
- **Password:** the code.
- **Notes:** "OpenValens Cloud. On the sign-in screen, tap **Have a sign-in
  code?**, enter the email above and this code, then **Sign in with code**. In
  the app, keep the server on OpenValens Cloud."

## Keep in mind

- **The trial ends 30 days after sign-up** unless the nightly refresh is
  scheduled: each run moves its end 30 days ahead. Without it, the workspace
  turns read-only once the trial ends (reviewers can still see everything, but
  cannot add entries).
- **Rotate the code** after each review round, or if it leaks: change
  `REVIEW_ACCOUNT_CODE` and redeploy. Sessions already started stay valid
  until they are signed out or expire.
- **Turn it off** by clearing either setting and redeploying. The link on the
  sign-in screen stays, and every code is refused.
- Only the code path is special. The account is otherwise an ordinary Cloud
  account: email links, export and deletion all work.
