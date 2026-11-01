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

**If a run fails** part-way, the workspace holds some records but no
completion record, so a rerun refuses ("already holds records"). Start over:
sign in as the review account, delete it in **Settings › Delete account and all
data**, create it again through the sign-up, and rerun the seed.

**Refreshing the dates** works the same way: the data does not move forward on
its own, so for a review months later, delete the account, sign up again and
reseed.

## What to give the reviewers

In App Store Connect (App Review Information › Sign-in required) and the Play
Console (App access › All or some functionality is restricted):

- **Username:** the review email.
- **Password:** the code.
- **Notes:** "OpenValens Cloud. On the sign-in screen, tap **Have a sign-in
  code?**, enter the email above and this code, then **Sign in with code**. In
  the app, keep the server on OpenValens Cloud."

## Keep in mind

- **The trial ends 30 days after sign-up.** After that the workspace is
  read-only (reviewers can still see everything, but cannot add entries). For
  a later review, recreate the account as above.
- **Rotate the code** after each review round, or if it leaks: change
  `REVIEW_ACCOUNT_CODE` and redeploy. Sessions already started stay valid
  until they are signed out or expire.
- **Turn it off** by clearing either setting and redeploying. The link on the
  sign-in screen stays, and every code is refused.
- Only the code path is special. The account is otherwise an ordinary Cloud
  account: email links, export and deletion all work.
