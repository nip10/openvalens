# Public read-only demo

The public demo is separate from the App Store / Play review account. Visitors
choose **Try the demo** on the landing page or web/mobile sign-in. No email or
code is requested. The landing page opens `/login?demo=true`, which starts a
POST through the auth client. An existing signed-in person keeps their account.

The banner identifies the data as synthetic and offers **Create your own
account** and **Leave demo**. Leaving revokes only that visitor's session.
Mobile changes reach devices with the next app release.

## Provision and schedule

Set `DEMO_ACCOUNT_EMAIL` in the API container to a dedicated address such as
`demo@openvalens.com`, different from `REVIEW_ACCOUNT_EMAIL`. Then run:

```sh
cd /app
bun run demo:seed:public --time-zone Europe/Lisbon
```

The command creates an isolated account and workspace, marks the account with
the durable `demo` role, and seeds 90 days of synthetic history through the
existing fixture. It refuses to convert any existing ordinary or review account.
The workspace must have exactly one member, its owner. It creates neither a
subscription nor a legal consent record for visitors.

Add a Coolify scheduled task on `openvalens-api`:

| Field          | Value                                                           |
| -------------- | --------------------------------------------------------------- |
| Name           | `publicDemoRefresh`                                             |
| Schedule (UTC) | `20 9 * * *`                                                    |
| Command        | `cd /app && bun run demo:seed:public --time-zone Europe/Lisbon` |
| Timeout        | `600` seconds                                                   |

Every run atomically replaces the synthetic records, prunes expired demo
sessions, and keeps active sessions and the account identity. Readers see a
complete history throughout; a failed record stage rolls back. Afterwards the
CLI adds two labeled synthetic progress photos to configured private storage.
This separate stage is retryable and preserves existing photos across refreshes
(see `packages/demo-seed/assets/README.md`). As with the store seed,
the reused fixture records `REVIEW_DEMO_SEEDED` / `REVIEW_DEMO_REFRESHED` events
in this separate workspace. Do not run the disposable `demo:seed` command on
production: that command resets an entire local demo database.

Dates end on today in the selected time zone. Today's samples stop at the run
time. The inherited persona uses US preventive-care guidance. Run the job
after breakfast in its time zone so today's dashboard has data.

## Enforcement

- The public endpoint selects only a provisioned, seeded `demo` account in an
  isolated workspace. Disabled, missing, banned or non-demo accounts cannot
  sign in through it. Better Auth limits demo starts to 10 per minute per IP.
- Visitors get independent one-hour sessions. They cannot list or revoke
  another visitor's sessions, change the account or workspace, connect sign-in
  methods, invite members, or authorize an AI app.
- The server reads the database role on each request. The main API permits
  classified reads and a small set of status reads. Writes, AI, exports,
  consent changes, billing actions and unknown procedures default to denied
  with `403 DEMO_READ_ONLY`. Direct HTTP routes and Better Auth endpoints have
  their own guards. These protections remain when `DEMO_ACCOUNT_EMAIL` is unset.
- The account cannot be invited into another workspace. Demo requests cannot
  capture analytics, register push devices, upload files or ingest phone data.
  Phone sync pauses on the demo access state. Magic links, daily reminders,
  insight pushes and digest emails exclude demo accounts.
- Only synthetic fixture data belongs here. Never connect a real wearable,
  grant an AI app access, add a subscription or upload a real person's files
  using operator credentials.

`packages/api/src/demo-policy.test.ts` walks the real router to verify every
non-read procedure fails before validation or database access.
`packages/demo-seed/src/public.integration.test.ts` covers provisioning, reads,
auth mutations, refresh, disabled sign-in, email suppression and independent
sign-out against a disposable Postgres database.
