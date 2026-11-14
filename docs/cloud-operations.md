# OpenValens Cloud operations

**Applies to:** `app.openvalens.com` and `openvalens.com` · Last updated: 2026-11-14

How the hosted service is run day to day (#308). Credentials and private
details are not in this file. They live with the owner, in
`~/.config/openvalens/deployment.env` (Coolify API URL and token, Resend key)
and in Coolify itself.

## What runs where

| Piece                 | Coolify resource      | Builds from                      | Domain                                                                                                                                                                       |
| --------------------- | --------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API (`apps/server`)   | `openvalens-api`      | `main`, `apps/server/Dockerfile` | `app.openvalens.com` paths `/api`, `/rpc`, `/api-reference`, `/.well-known/openvalens`, `/.well-known/oauth-protected-resource*`, `/.well-known/oauth-authorization-server*` |
| Web app (`apps/web`)  | `openvalens-web`      | `main`, `apps/web/Dockerfile`    | `app.openvalens.com` (everything else)                                                                                                                                       |
| Website (`apps/site`) | `openvalens-site`     | `main`, `apps/site/Dockerfile`   | `openvalens.com`, `www.openvalens.com`                                                                                                                                       |
| Database              | `openvalens-postgres` | `postgres:18`                    | not public                                                                                                                                                                   |

The server is a netcup VPS in Nuremberg, Germany, managed with self-hosted
Coolify. Email goes through Resend (`openvalens.com`, region eu-west-1).

Billing runs on its own Stripe account ("OpenValens"), in live mode since
2026-11-03; preview deployments use its test mode. The five `STRIPE_*` settings
are in Coolify (see [billing.md](billing.md)). Push notifications use the Expo
push service (`PUSH_PROVIDER=expo`); the APNs and FCM keys are on the EAS
project.

A new path the API must answer on `app.openvalens.com` has to be added to the
`openvalens-api` domains. Otherwise the web app's catch-all serves it.

## Deploy

Auto-deploy is off. Merge to `main`, let CI pass, then deploy each changed
resource:

```sh
# cf.sh: curl wrapper that reads COOLIFY_API_URL and COOLIFY_API_TOKEN
cf.sh POST /deploy '{"uuid":"<resource uuid>"}'
cf.sh GET /deployments/<deployment uuid>   # until status is finished
```

The API runs `bun run db:migrate:deploy` as its Coolify post-deployment
command, so pending Drizzle migrations apply on every API deploy. Check
the deployment log for `migrations applied successfully`. Then check:

- `https://app.openvalens.com/api/auth/ok` returns `{"ok":true}`;
- `https://app.openvalens.com/.well-known/openvalens` returns the API's JSON
  (with `"mode"`), not the web app's HTML;
- `https://app.openvalens.com/api/health` returns `{"status":"ok","database":"ok"}`;
- with connected AI apps on, `https://app.openvalens.com/.well-known/oauth-protected-resource/api/mcp`
  and `https://app.openvalens.com/.well-known/oauth-authorization-server/api/auth`
  return JSON from the API, not the web app's HTML (see [connected AI apps](ai-apps.md));
- the API log shows `Started server` and no errors.

Coolify builds each image on the VPS itself (2 vCPU, 3.9 GB RAM). During a
build the load and swap go up and the live services slow down, so deploy one
resource at a time.

**Before a deploy with a destructive migration**, run a manual backup first
(below) and confirm it succeeded.

## Rollback

The fastest rollback is to **pin** the resource to the last good commit, then
deploy:

```sh
cf.sh PATCH /applications/<uuid> '{"git_commit_sha":"<full sha of the good commit>"}'
cf.sh POST /deploy '{"uuid":"<uuid>","force":true}'
```

Fix forward on `main`, then unpin (`"git_commit_sha":"HEAD"`) and deploy
again. Reverting the merge on `main` works too. A migration that already ran
is not undone either way: older code must tolerate the newer schema (new
tables and columns usually are), or write a forward migration, or restore the
pre-deploy backup if data was damaged.

Example (2026-11-03): #356 broke every templated email. The API was pinned to
v1.0.1 for about an hour, #358 fixed it, and the pin was removed.

## Backups

- **Schedule:** daily at 03:00 UTC, keeping 14, on the server
  (`openvalens-postgres` › Backups). Enabled 2026-10-29.
- **Manual backup:** `PATCH /databases/<uuid>/backups/<backup uuid>` with
  `{"backup_now":true}`, then check the newest execution is `success`.
- **Off-site copy: deferred by the owner (2026-11-03).** Losing the VPS loses
  the backups too. When it is wanted, add an EU S3-compatible bucket to
  Coolify as S3 storage and turn it on for the schedule.
- **Restore drill:** restore the newest dump into a throwaway container on the
  server (no network), compare row counts per table with production, then
  remove the container:

  ```sh
  F=$(ls -t /data/coolify/backups/databases/*/openvalens-postgres-*/pg-* | head -1)
  docker run -d --name ov-restore-drill --network none --memory 512m \
    -e POSTGRES_PASSWORD=drill -v "$F":/backup.dmp:ro postgres:18
  docker exec ov-restore-drill createdb -U postgres openvalens
  docker exec ov-restore-drill pg_restore -U postgres -d openvalens \
    --no-owner --no-acl --exit-on-error /backup.dmp
  # count rows per table here and in production, then:
  docker rm -f ov-restore-drill
  ```

  A real restore uses the same `pg_restore`, with `--clean --if-exists`,
  into the production database while the API is stopped.

| Date       | Backup                        | Result                                                                                                             |
| ---------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 2026-11-03 | 2026-11-03 03:00 UTC (1.5 MB) | Passed: 140 tables in 2 s, no errors; 25,093 rows vs 25,135 live, every difference written after the backup (#308) |

## Monitoring and alerts

- **Uptime (UptimeRobot, free plan):** every 5 minutes it checks the website,
  the web app, the API (`/api/health`, which pings the database) and mail
  (IMAP 993), and emails hello@openvalens.com on a failure and on recovery.
  Public status page: https://stats.uptimerobot.com/hYgbJCzAWr (linked from
  [Support](https://openvalens.com/support#status)). Its API key is with the
  owner. The alert was tested on 2026-11-03 by forcing the API check to fail.
- **Uptime (GitHub Actions, backup):** `.github/workflows/uptime.yml` checks
  the same URLs plus the Stripe webhook route. It is scheduled every 5
  minutes, but GitHub runs scheduled workflows only every few hours, so it
  is a backstop, not the alert. A failure opens an `outage` issue and emails
  `ALERT_EMAIL_TO`.
- **What uptime checks miss:** they don't send email or take payments. The
  2026-11-03 email outage passed every check. After a deploy that touches
  email or billing, try a sign-in link and look at the API log.
- **Errors:** Sentry is wired but off until `SENTRY_DSN`, `VITE_SENTRY_DSN`
  and `EXPO_PUBLIC_SENTRY_DSN` are set (see
  [observability.md](observability.md)).
- **Coolify:** turn on email notifications for failed deployments and failed
  backups in Coolify › Notifications, sending to the same address.

## Onboarding totals

How new accounts get started (#444) is on
`https://app.openvalens.com/admin/settings`, section **Onboarding**, for an
instance administrator (an account whose `user.role` includes `admin`). Of the
accounts created in the last 30, 90 or 365 days, it shows the share with a
first entry within 10 minutes, 1 day and 7 days of sign-up, and with any entry
on days 2–7.

The figures come from timestamps already in the database (account creation
and when entries were saved); there is no tracking and PostHog is not used.
Counts and shares only, never a per-person row, and a figure for fewer than 5
accounts is hidden. What counts as an entry and the limits of the small-group
rule are in
[self-hosting/privacy.md › Onboarding totals](self-hosting/privacy.md#onboarding-totals).

## Data-rights requests

Most requests are self-service: **Settings › Export records** (complete ZIP)
and **Settings › Delete account and all data**. For a request by email to
hello@openvalens.com:

1. Confirm it comes from the account's email address. If it does not, ask the
   person to sign in or to write from that address.
2. Access or portability: ask them to use the export. If they cannot sign in,
   an administrator can run the export for them.
3. Erasure: an instance administrator can delete the account. The erasure
   ledger re-applies the deletion if a backup is ever restored.
4. Answer within one month and keep the email for 2 years.

## Incidents

1. Find out what is broken: the uptime issue, the API log in Coolify, and
   `docker ps` on the server.
2. If a deploy caused it, roll back (above).
3. If personal data may have been exposed, write down what, when and whose.
   Notify the CNPD within 72 hours where required, and tell the people
   affected when the risk to them is high (privacy policy, section 11).
4. Afterwards, add what you learned to this file.
