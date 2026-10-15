# Self-hosting OpenValens

Last updated: 2026-10-14

This is the **one supported self-host install** (Issue #63): a pinned Docker
Compose stack (`deploy/compose.yml`) driven by an interactive setup script
(`deploy/setup.sh`). Helm charts, single binaries and platform templates are not
supported. The root `docker-compose.yml` is the **development** stack; never use
it for a real installation.

> **Backup status.** The upgrade path takes a **plain, unencrypted `pg_dump`**
> before every migration. Encrypted backups, off-host copies and a tested
> restore procedure are **not** part of this release; they are tracked in
> Issue #64. Do not treat this install as backup-ready: until #64 lands, you are
> responsible for protecting and copying the `backups` volume yourself.

## What you get

| Service    | Image                                       | Network     | Published ports |
| ---------- | ------------------------------------------- | ----------- | --------------- |
| `caddy`    | `caddy:2.11.7@sha256:…` (pinned)            | `app`       | 80, 443 (+UDP)  |
| `web`      | `openvalens-web:<version>` (built locally)  | `app`       | none            |
| `server`   | `openvalens-server:<version>` (built)       | `app`, `db` | none            |
| `migrate`  | same image as `server`, one-shot            | `db`        | none            |
| `backup`   | `postgres:18.6@sha256:…` (pinned), one-shot | `db`        | none            |
| `postgres` | `postgres:18.6@sha256:…` (pinned)           | `db` only   | none            |

- **Caddy is the only service that publishes ports.** Docker-published ports
  bypass host firewalls such as ufw, so nothing else may publish one. Caddy
  obtains and renews the TLS certificate automatically and redirects HTTP to
  HTTPS.
- The `db` network is `internal: true`: Postgres has no published port and no
  route to the internet. The server also joins `app` because it needs outbound
  access to email/AI providers.
- Web and API share **one origin** (`https://<domain>`): Caddy routes `/api/*`,
  `/rpc/*` and `/api-reference/*` to the server and everything else to the web
  app.
- `<version>` is the checked-out git tag/commit. Images are built from your
  checkout; published registry images are tracked separately (#129).
- Named volumes: `postgres_data`, `backups`, `storage`, `caddy_data`,
  `caddy_config`. `storage` holds uploaded objects (progress photos, lab PDFs,
  export bundles) at `/var/lib/openvalens/storage` in the server container; see
  [Object storage](storage.md).

## Requirements

- A Linux host (Ubuntu 24.04 LTS is the reference) with Docker Engine and the
  Compose v2 plugin (`docker compose`).
- A domain whose DNS A/AAAA record points at the host, and inbound TCP 80/443
  (plus UDP 443 for HTTP/3) open. Port 80 is needed for the certificate
  challenge.
- A [Resend](https://resend.com) API key and a verified sender. Account setup
  and invitations deliver a one-time code **by email**; without a key, email is
  dry-run only and the first administrator cannot complete setup.

### Resources

Observed on 2026-10-14 on a development machine (arm64, Docker via OrbStack),
fresh install with an empty database, idle. This is **not** a measurement on a
reference VPS; treat it as a floor, not a sizing guarantee.

| Item                          | Observed                                                                |
| ----------------------------- | ----------------------------------------------------------------------- |
| Memory, idle                  | server ~89 MiB, postgres ~29 MiB, caddy ~14 MiB, web ~14 MiB (~150 MiB) |
| First install (build + start) | ~95 s with a warm Docker cache                                          |
| Images on disk                | server 2.2 GB, postgres 0.7 GB, web 0.1 GB, caddy 0.1 GB                |
| Fresh database volume         | ~71 MB                                                                  |

Plan for at least 2 vCPU, 2 GB RAM (4 GB if you use AI features or heavy
ingestion) and 20 GB free disk, plus room for at least three database-sized
dumps in the `backups` volume. Measuring minimums on a reference VPS is still
outstanding.

## Install

```bash
git clone https://github.com/nip10/openvalens.git
cd openvalens
git checkout <release tag>
deploy/setup.sh install
```

The script:

1. checks Docker and Compose;
2. asks for the domain, a Let's Encrypt contact email and the app's sender
   address, and (hidden input) the optional Resend API key;
3. **generates** every secret — database password, `BETTER_AUTH_SECRET`,
   `CRON_SECRET`, `TELEGRAM_WEBHOOK_SECRET` — into `deploy/secrets/` and never
   prints one. No default or placeholder secret ships, and the server rejects
   known placeholders in production;
4. writes the non-secret settings to `deploy/.env`;
5. builds the images and starts the stack (`postgres → backup → migrate →
server → web → caddy`);
6. mints the **one-time setup token** into `deploy/secrets/setup-token`
   (mode `0600`).

Re-running `install` is safe: existing settings and secrets are reused, never
regenerated.

**Never paste secrets into chat, tickets or logs** — not the setup token, not
`deploy/.env`, not anything under `deploy/secrets/`. The installer never asks
you to: every secret is either generated on the host or typed into a hidden
local prompt.

### Headless install

```bash
OPENVALENS_DOMAIN=health.example.org \
ACME_EMAIL=ops@example.org \
EMAIL_FROM='OpenValens <noreply@example.org>' \
RESEND_API_KEY_SOURCE=/root/resend-key \
  deploy/setup.sh install --non-interactive
```

`RESEND_API_KEY_SOURCE` is the path to a private file containing the key; the
key is never accepted as an argument or environment value.

### Dry run

```bash
deploy/setup.sh install --dry-run --non-interactive   # with the variables above
deploy/setup.sh upgrade --dry-run
```

A dry run generates the configuration and throwaway secrets in a private
temporary directory, validates `deploy/compose.yml` with `docker compose
config`, checks that only Caddy publishes ports, prints the Docker commands it
would run, and deletes the temporary directory. It changes nothing in `deploy/`
and does not start containers.

## First administrator and invitations

1. Read the token locally: `cat deploy/secrets/setup-token`. It is valid for
   **24 hours** and works once.
2. Open `https://<domain>/setup`, enter the token and your email address, then
   the code emailed to you. That account becomes the global instance
   administrator. Sign in afterwards through the normal email sign-in.
3. Registration is then closed (`invite_only`): there is no public sign-up, and
   everyone else joins by an administrator invitation at `/join`. This is
   enforced server-side — see "Instance admission" in
   [deployment.md](deployment.md#instance-admission-issue-63).

If the token expires or is lost, mint a new one (this invalidates the old one;
it is refused once an administrator exists):

```bash
deploy/setup.sh mint-token
```

## Upgrades

```bash
git fetch --tags
git checkout <new release tag>
deploy/setup.sh upgrade
```

`upgrade` rebuilds the images, **stops the running server** (so it never serves
a half-migrated database), then starts the gated chain:

1. `backup` — runs the pre-migrate backup hook (below). If it fails, nothing
   else runs.
2. `migrate` — applies pending tracked Drizzle migrations
   (`drizzle-kit migrate`).
3. `server`, `web`, `caddy` — start only if `migrate` exited `0`.

**A failed backup or migration leaves the server stopped** and never deletes a
backup. Inspect with
`docker compose -f deploy/compose.yml logs backup migrate`, fix the cause, and
run `deploy/setup.sh upgrade` again (it takes a fresh backup first). There are
no downgrades: rolling back means restoring the pre-upgrade dump into a fresh
database and checking out the previous tag. A documented, tested restore
procedure is part of Issue #64.

A plain `docker compose -f deploy/compose.yml up -d` follows the same
backup → migrate → server order, but prefer `deploy/setup.sh upgrade`, which
stops the old server first.

## Pre-migrate backup hook

`deploy/pre-migrate-backup.sh` runs in the one-shot `backup` service on every
start of the chain. Select its behavior in `deploy/.env`:

| `OPENVALENS_PRE_MIGRATE_BACKUP` | Behavior                                                                                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pg_dump` (default)             | Plain `pg_dump --format=custom` into the `backups` volume as `pre-migrate-<UTC timestamp>.dump` (mode `0600`), verified with `pg_restore --list` before it counts. Skipped only for an empty (fresh) database. |
| `hook`                          | Runs your executable `deploy/hooks/pre-migrate` (see `deploy/hooks/pre-migrate.example`) with `PG*` connection variables set. It must exit `0` only after a backup you trust exists.                           |
| `none`                          | Takes no backup and is **refused** unless `OPENVALENS_ALLOW_MIGRATE_WITHOUT_BACKUP=I_HAVE_A_BACKUP` is also set. Use only when you have just taken your own verified backup.                                   |

`OPENVALENS_BACKUP_RETAIN` (default `10`) keeps the newest N `pre-migrate-*`
dumps; `0` keeps all of them.

**These dumps are unencrypted health data** protected only by the Docker
volume's host permissions. Copy them off the host yourself and protect them
accordingly. Encrypted backups, off-host storage and restore drills are Issue
#64.

The pre-migrate dump covers the database only. With the default local object
storage, also back up the `storage` volume — the database indexes those files
and a restore needs both from the same point in time. See
[Object storage → Backups](storage.md#backups).

List or copy dumps:

```bash
docker compose -f deploy/compose.yml run --rm --no-deps --entrypoint ls backup -l /backups
docker compose -f deploy/compose.yml cp backup:/backups/<file>.dump ./  # while a backup container exists
```

## Secrets layout

```
deploy/secrets/            0700  host-private
  server/                  0755  mounted read-only at /run/secrets in server/migrate
    DATABASE_URL           0444
    BETTER_AUTH_SECRET     0444
    CRON_SECRET            0444
    TELEGRAM_WEBHOOK_SECRET 0444
    RESEND_API_KEY         0444  (optional)
  postgres/                0755  mounted read-only in postgres/backup
    POSTGRES_PASSWORD      0444
  setup-token              0600  operator only, never mounted
```

The server reads each secret through its `<KEY>_FILE` variable (see
[reference/env.md](reference/env.md)). The `0444`-inside-`0700` layout is the
documented fallback for host/container UID mismatches: other host users cannot
traverse `deploy/secrets/`, while the containers' non-root users can read their
own read-only mount. `deploy/secrets/` is git-ignored and excluded from the
image build context.

Optional providers: put the key in `deploy/secrets/server/<KEY>` (mode `0444`)
and set `<KEY>_FILE=/run/secrets/<KEY>` in `deploy/.env` for
`ANTHROPIC_API_KEY` or `TELEGRAM_BOT_TOKEN`, then run `deploy/setup.sh upgrade`.

## Verify an install

```bash
curl -fsS -X POST https://<domain>/api-reference/health/readiness \
  -H 'Content-Type: application/json' -d '{}'          # status "ok"
docker compose -f deploy/compose.yml ps                 # only caddy lists host ports
```

From **another machine**, confirm that only 80/443 answer, for example
`nmap -Pn -p 80,443,3000,3001,5432 <host>` (3000, 3001 and 5432 must not be
open).

## Not covered yet

- Encrypted backup/restore and restore drills — Issue #64.
- Published, signed registry images (installs build from source) — #129.
- Resource minimums measured on a reference VPS.
