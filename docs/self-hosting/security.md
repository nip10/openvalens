# Security model and reporting

**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-14

OpenValens stores personal health data. This page describes what the supported
install ([Install](install.md)) does to protect it, what it leaves to you, and
how to report a vulnerability.

## Reporting a vulnerability

Do **not** open a public issue. Report privately through GitHub: the
repository's **Security** tab → **Report a vulnerability**. The full policy,
response targets and disclosure process are in
[SECURITY.md](../../SECURITY.md). Security fixes go into `main`; keep your
instance [up to date](upgrading.md).

## What the install does for you

**Network**

- Only Caddy publishes ports (80 and 443). The server, web app and database
  have none; a CI test and `deploy/setup.sh` both refuse a Compose file where
  another service publishes one.
- Postgres sits on an `internal` Docker network with no published port and no
  route to the internet.
- Caddy obtains and renews TLS certificates automatically, redirects HTTP to
  HTTPS and sends `Strict-Transport-Security: max-age=31536000`.
- Web app and API share one origin, so the browser never needs cross-origin
  credentials.

**Secrets**

- `deploy/setup.sh` generates every secret on the host, writes it to
  `deploy/secrets/` (a `0700` directory) and never prints it. No default or
  placeholder secret ships; the server refuses to start in production with a
  known placeholder `BETTER_AUTH_SECRET` or `CRON_SECRET`.
- Secrets reach the containers only as read-only files referenced by
  `<KEY>_FILE`; none is interpolated into the Compose file or the images.
- Third-party images (Caddy, Postgres) are pinned by version and digest.

**Accounts and authority**

- There is no public sign-up and no password. The first administrator is
  created with a one-time, 24-hour setup token that only someone with shell
  access to the host can read; everyone else is invited by an administrator.
  Sign-in is by emailed magic link.
- **Instance administrator** (installation-wide) and **workspace owner**
  (one workspace) are separate authorities; owning a workspace never grants
  installation-wide rights ([GLOSSARY.md](../../GLOSSARY.md)).
- Health data is scoped to a workspace on the server, from the signed-in
  session, never from client input. Joining someone else's workspace requires
  an invitation from that workspace, and only to an existing account.

**Application**

- A Content Security Policy is enforced on the web app and the API because the
  stack runs with `NODE_ENV=production`
  ([docs/security-csp.md](../security-csp.md)).
- Request bodies over 1 MiB are rejected before parsing.
- Logs are structured JSON without health values, email bodies, tokens or
  provider keys; each line carries a correlation id. No error-reporting or
  analytics service is configured, so nothing is sent off the host by default.
- Optional providers are off until you add a key. AI features send data only
  after the user consents in the app.
- Containers run with `no-new-privileges`; the server runs as a non-root user.
  Container logs are rotated (3 × 10 MB per service).

## What remains your responsibility

- **The host.** Anyone with root or Docker access on the host can read every
  record, secret and backup. Keep the OS and Docker updated, restrict SSH
  (keys only), and limit who can use Docker.
- **Backups.** The only backups are plain, **unencrypted** dumps on the same
  host ([Backups](backup.md)). Encrypt and copy them off the host yourself
  until Issue #64 lands.
- **Secrets.** Never paste the setup token, `deploy/.env` or anything under
  `deploy/secrets/` into chat, tickets or logs. If you suspect a leak, rotate
  the affected secret: replace the file (mode `0444`) and run
  `deploy/setup.sh upgrade`. Do not replace `POSTGRES_PASSWORD` or
  `DATABASE_URL` this way — Postgres keeps the old password in its data
  volume.
- **Email.** Use a sender domain you control and keep the Resend key private.
- **Updates.** Apply new versions promptly; only `main` receives security
  fixes.
- **Legal duties.** You operate the instance and are responsible for the
  people whose data it holds ([Privacy and data rights](privacy.md)).

## Known limitations at 0.1.0

- Backups are unencrypted, unscheduled and on the same host (#64).
- Images are built from source on your host; signed, published images are
  #129.
- Reads of installation-wide settings are not audited yet; the existing access
  audit is per workspace.
- The server trusts Expo development origins (`exp://`,
  `http://localhost:8081`) in addition to your domain and the app scheme
  `openvalens://`, pending the final mobile app sign-in work.
- Resource minimums have not been measured on a reference VPS.
