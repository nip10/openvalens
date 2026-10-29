# OpenValens Cloud operations

**Applies to:** `app.openvalens.com` and `openvalens.com` · Last updated: 2026-10-29

How the hosted service is run day to day (#308). Credentials and private
details are not in this file. They live with the owner, in
`~/.config/openvalens/deployment.env` (Coolify API URL and token, Resend key)
and in Coolify itself.

## What runs where

| Piece                 | Coolify resource      | Builds from                      | Domain                                                                                 |
| --------------------- | --------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| API (`apps/server`)   | `openvalens-api`      | `main`, `apps/server/Dockerfile` | `app.openvalens.com` paths `/api`, `/rpc`, `/api-reference`, `/.well-known/openvalens` |
| Web app (`apps/web`)  | `openvalens-web`      | `main`, `apps/web/Dockerfile`    | `app.openvalens.com` (everything else)                                                 |
| Website (`apps/site`) | `openvalens-site`     | `main`, `apps/site/Dockerfile`   | `openvalens.com`, `www.openvalens.com`                                                 |
| Database              | `openvalens-postgres` | `postgres:18`                    | not public                                                                             |

The server is a netcup VPS in Nuremberg, Germany, managed with self-hosted
Coolify. Email goes through Resend (`openvalens.com`, region eu-west-1).

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
- the API log shows `Started server` and no errors.

**Before a deploy with a destructive migration**, run a manual backup first
(below) and confirm it succeeded.

## Rollback

Redeploy the previous good commit: revert the merge on `main` and deploy. A
migration that already ran is not undone by this. Write a forward migration,
or restore the pre-deploy backup if data was damaged.

## Backups

- **Schedule:** daily at 03:00 UTC, keeping 14, on the server
  (`openvalens-postgres` › Backups). Enabled 2026-10-29.
- **Manual backup:** `PATCH /databases/<uuid>/backups/<backup uuid>` with
  `{"backup_now":true}`, then check the newest execution is `success`.
- **Off-site copy: not set up yet.** Needs an EU S3-compatible bucket (netcup
  or Hetzner Object Storage) added to Coolify as S3 storage and turned on for
  the schedule. Until then, losing the VPS loses the backups too.
- **Restore drill:** restore the newest dump into a scratch database, run the
  migrations, count rows in `user` and a few health tables, then drop it.
  Write down the date and result here.

| Date | Backup | Result |
| ---- | ------ | ------ |
| —    | —      | —      |

## Monitoring and alerts

- **Uptime:** `.github/workflows/uptime.yml` checks the website, the web app,
  the API, the server check and the Stripe webhook route every 5 minutes. The
  first failure opens an `outage` issue and emails `ALERT_EMAIL_TO`; recovery
  closes it and emails again. Configure the `RESEND_API_KEY` secret and the
  `ALERT_EMAIL_TO` and `ALERT_EMAIL_FROM` variables in the repository.
- **Errors:** Sentry is wired but off until `SENTRY_DSN`, `VITE_SENTRY_DSN`
  and `EXPO_PUBLIC_SENTRY_DSN` are set (see
  [observability.md](observability.md)).
- **Coolify:** turn on email notifications for failed deployments and failed
  backups in Coolify › Notifications, sending to the same address.

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
