# Install

**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-24

This is the **one supported self-host install** (Issue #63): a pinned Docker
Compose stack (`deploy/compose.yml`) driven by an interactive setup script
(`deploy/setup.sh`). Helm charts, single binaries and platform templates are not
supported. The root `docker-compose.yml` is the **development** stack; never use
it for a real installation.

> **Backups.** The install takes an encrypted backup of the database and
> stored files every day and before every migration, and generates the backup
> key `deploy/secrets/backup/age-identity`. **Copy that key off the server**:
> without it no backup can be restored. Backups stay on the host until you copy
> them off. Read [Backups](backup.md) before you store real health data.

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
- Named volumes: `postgres_data`, `backups`, `storage`, `caddy_data`,
  `caddy_config`. `storage` holds uploaded objects (today, progress photos) at `/var/lib/openvalens/storage` in the server container; see
  [Object storage](../storage.md).

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

Measured on 2026-10-23 on a fresh cloud VM: Ubuntu 24.04.5 LTS, x86_64 (AMD
EPYC), 2 vCPU, 8 GB RAM, Docker 29.1.3 with Compose 2.40.3. It ran a headless
install of `main` and two upgrades: one across three migrations, one
recovering from a failed migration.

| Item                               | Measured                                                                |
| ---------------------------------- | ----------------------------------------------------------------------- |
| First install (build + start)      | 289 s, cold build cache                                                 |
| Upgrade, three new migrations      | 284 s (full image rebuild, backup, migrate, start)                      |
| Upgrade, warm build cache          | 48 s                                                                    |
| Memory, idle after start           | server ~95 MiB, postgres ~47 MiB, caddy ~31 MiB, web ~12 MiB (~190 MiB) |
| Memory, peak while building images | ~3.5 GB used on the host                                                |
| Images on disk                     | server 2.75 GB, web 0.1 GB (plus the postgres and caddy base images)    |
| Docker build cache                 | ~12 GB after the first install, ~23 GB after two upgrades               |
| Fresh database volume              | ~72 MB                                                                  |
| Pre-migrate dump, fresh database   | ~0.5 MB each                                                            |

Plan for:

- **2 vCPU and 4 GB RAM.** Running the stack needs well under 1 GB, but
  building the images peaks around 3.5 GB. On a 2 GB host, add at least 2 GB
  of swap before `install` or `upgrade`, or the build may be killed. (A 2 GB
  host was not tested.)
- **40 GB free disk.** That covers the images, the build cache (which grows
  with every upgrade; see [Upgrading](upgrading.md#disk-space)) and at least
  three database-sized dumps in the `backups` volume.

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

Re-running `install` is safe: existing secrets are never regenerated, the
domain and email settings are reused, and every other key in `deploy/.env` —
including keys you added by hand — is kept
([Applying a change](configuration.md#applying-a-change)). To answer the domain
and email questions again, run `deploy/setup.sh install --reconfigure`. A
re-run restarts the stack through the backup → migrate chain.

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

### Behind a TLS-terminating proxy

By default Caddy obtains the certificate itself, which needs ports 80 and 443
to reach the host directly. If a load balancer, tunnel or hosting edge in front
of the host already terminates HTTPS and forwards plain HTTP to port 80, set
`OPENVALENS_SITE_SCHEME=http` when you run `install` (or add it to
`deploy/.env` and run `deploy/setup.sh upgrade`):

```bash
OPENVALENS_SITE_SCHEME=http deploy/setup.sh install
```

Caddy then serves plain HTTP on port 80 for `OPENVALENS_DOMAIN`, asks for no
certificate and does not redirect. The public URL stays
`https://<domain>`, so the proxy must serve HTTPS for that name. Only use this
when the proxy is the sole route to port 80: anyone who reaches port 80
directly talks to OpenValens without TLS. Firewall the host so only the proxy
can connect.

### Dry run

```bash
deploy/setup.sh install --dry-run --non-interactive   # with the variables above
deploy/setup.sh upgrade --dry-run
deploy/setup.sh mint-token --dry-run
```

A dry run generates the configuration and throwaway secrets in a private
temporary directory, validates `deploy/compose.yml` with `docker compose
config`, checks that only Caddy publishes ports, prints the Docker commands it
would run, and deletes the temporary directory. On an existing install it
starts from a private copy of `deploy/.env`, so the validation covers your
settings. It changes nothing in `deploy/` and does not start containers. `deploy/setup.sh --help` prints the full usage.

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
recurring jobs: the stack does not run them by itself.

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

- [Food catalogs](food-catalogs.md) — **the food catalogs start empty.** Until
  you import them, food search finds only members' custom foods and barcode
  scans miss. `deploy/setup.sh catalogs --source fdc` (~14 MB) adds generic
  foods; `--source off` (~13 GB) adds product barcodes.
- [Configuration](configuration.md) — optional providers, scheduled jobs,
  product settings.
- [Backups](backup.md) — what is and is not protected today.
- [Security model](security.md) — what the stack does for you and what remains
  your responsibility.
