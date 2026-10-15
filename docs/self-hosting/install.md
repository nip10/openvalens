# Install

**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-14

This is the **one supported self-host install** (Issue #63): a pinned Docker
Compose stack (`deploy/compose.yml`) driven by an interactive setup script
(`deploy/setup.sh`). Helm charts, single binaries and platform templates are not
supported. The root `docker-compose.yml` is the **development** stack; never use
it for a real installation.

> **Backup status.** The install takes a **plain, unencrypted `pg_dump`** before
> every migration and nothing else. Encrypted backups, off-host copies and a
> tested restore procedure are **not** part of this release; they are tracked
> in Issue #64. Read [Backups](backup.md) before you store real health data.

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
- `<version>` is `git describe --tags --always --dirty` of your checkout (a
  commit hash until a release is tagged). Images are built from your checkout;
  published registry images are tracked separately (#129).
- Named volumes: `postgres_data`, `backups`, `caddy_data`, `caddy_config`.

## Requirements

- A Linux host (Ubuntu 24.04 LTS is the reference) with Docker Engine, the
  Compose v2 plugin (`docker compose`) and `git`.
- A domain whose DNS A/AAAA record points at the host, and inbound TCP 80/443
  (plus UDP 443 for HTTP/3) open. Port 80 is needed for the certificate
  challenge.
- A [Resend](https://resend.com) API key and a verified sender. Account setup
  and invitations deliver a one-time code **by email**; without a key, email is
  dry-run only and the first administrator cannot complete setup. See
  [Email](email.md).

### Resources

Observed on 2026-10-14 on a development machine (arm64, Docker via OrbStack),
fresh install with an empty database, idle. This is **not** a measurement on a
reference VPS; treat it as a floor, not a sizing guarantee.

| Item                          | Observed                                                                |
| ----------------------------- | ----------------------------------------------------------------------- |
| Memory, idle                  | server ~89 MiB, postgres ~29 MiB, caddy ~14 MiB, web ~14 MiB (~150 MiB) |
| First install (build + start) | ~95–140 s, depending on the Docker build cache                          |
| Images on disk                | server 2.2 GB, postgres 0.7 GB, web 0.1 GB, caddy 0.1 GB                |
| Fresh database volume         | ~71 MB                                                                  |

Plan for at least 2 vCPU, 2 GB RAM (4 GB if you use AI features or heavy
ingestion) and 20 GB free disk, plus room for at least three database-sized
dumps in the `backups` volume. Measuring minimums on a reference VPS is still
outstanding.

## Install

No release has been tagged yet. Until the first release exists, install from
`main`, which tracks unreleased code; once releases exist, check out the
release tag instead.

```bash
git clone https://github.com/nip10/openvalens.git
cd openvalens
git checkout main            # or a release tag, once one exists
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
4. writes the non-secret settings to `deploy/.env` (mode `0600`);
5. builds the images and starts the stack (`postgres → backup → migrate →
server → web → caddy`);
6. mints the **one-time setup token** into `deploy/secrets/setup-token`
   (mode `0600`).

Re-running `install` is safe for secrets and the core settings: existing
secrets are never regenerated, and the domain and email settings are reused.
It does, however, **rewrite `deploy/.env`** with only the keys it manages (see
[Configuration](configuration.md#deployenv)), and it restarts the stack
through the backup → migrate chain.

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
deploy/setup.sh mint-token --dry-run
```

A dry run generates the configuration and throwaway secrets in a private
temporary directory, validates `deploy/compose.yml` with `docker compose
config`, checks that only Caddy publishes ports, prints the Docker commands it
would run, and deletes the temporary directory. It changes nothing in `deploy/`
and does not start containers. `deploy/setup.sh --help` prints the full usage.

## First administrator and invitations

1. Read the token locally: `cat deploy/secrets/setup-token`. It is valid for
   **24 hours** and works once.
2. Open `https://<domain>/setup`, enter the token and your email address, then
   the code emailed to you. That account becomes the global instance
   administrator. Sign in afterwards through the normal email sign-in.
3. Registration is then closed (`invite_only`): there is no public sign-up, and
   everyone else joins by an administrator invitation at `/join`. This is
   enforced server-side — see "Instance admission" in
   [deployment.md](../deployment.md#instance-admission-issue-63).

If the token expires or is lost, mint a new one (this invalidates the old one;
it is refused once an administrator exists):

```bash
deploy/setup.sh mint-token
```

## Verify the install

```bash
curl -fsS -X POST https://<domain>/api-reference/health/readiness \
  -H 'Content-Type: application/json' -d '{}'          # "status":"ok"
docker compose -f deploy/compose.yml ps                 # only caddy lists host ports
```

The readiness body also reports each optional integration (`email`, `ai`,
`messaging`) as `configured`, `dry-run` or `off`; see
[Configuration](configuration.md#optional-providers).

From **another machine**, confirm that only 80/443 answer, for example
`nmap -Pn -p 80,443,3000,3001,5432 <host>` (3000, 3001 and 5432 must not be
open).

Then follow [Configuration](configuration.md#scheduled-jobs) to schedule the
daily jobs: the stack does not run them by itself.

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
[the environment reference](../reference/env.md)). The `0444`-inside-`0700`
layout is the documented fallback for host/container UID mismatches: other host
users cannot traverse `deploy/secrets/`, while the containers' non-root users
can read their own read-only mount. `deploy/secrets/` is git-ignored and
excluded from the image build context.

Keep a private copy of `deploy/.env` and `deploy/secrets/` alongside your
database dumps: rebuilding an instance from a dump is simplest with the same
settings and secrets. Treat that copy like the secrets themselves.

## Next steps

- [Configuration](configuration.md) — optional providers, scheduled jobs,
  product settings.
- [Backups](backup.md) — what is and is not protected today.
- [Security model](security.md) — what the stack does for you and what remains
  your responsibility.
