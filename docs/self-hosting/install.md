# Install

**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-25

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

| Service            | Image                                                      | Network     | Published ports           |
| ------------------ | ---------------------------------------------------------- | ----------- | ------------------------- |
| `caddy`            | `caddy:2.11.7@sha256:…` (pinned)                           | `app`       | 80, 443 (+UDP); see below |
| `web`              | `openvalens-web:<version>` (built locally)                 | `app`       | none                      |
| `server`           | `openvalens-server:<version>` (built locally)              | `app`, `db` | none                      |
| `migrate`          | same image as `server`, one-shot                           | `db`        | none                      |
| `backup`           | `openvalens-backup:<version>` (built locally), one-shot    | `db`        | none                      |
| `backup-scheduler` | `openvalens-backup:<version>`, long-running                | `db`        | none                      |
| `backup-tools`     | `openvalens-backup:<version>`, run by `setup.sh` only      | `db`        | none                      |
| `backup-offsite`   | `openvalens-backup:<version>`, only with the off-site copy | `offsite`   | none                      |
| `postgres`         | `postgres:18.6@sha256:…` (pinned)                          | `db` only   | none                      |

- **Caddy is the only service that publishes ports.** Docker-published ports
  bypass host firewalls such as ufw, so nothing else may publish one. Caddy
  obtains and renews the TLS certificate automatically and redirects HTTP to
  HTTPS. `OPENVALENS_HTTP_PORT` and `OPENVALENS_HTTPS_PORT` change the host
  side, and can bind one address
  ([Behind a TLS-terminating proxy](#behind-a-tls-terminating-proxy)).
- The backup services ([Backups](backup.md)) run the `openvalens-backup` image:
  the pinned Postgres image plus `age`, `jq` and `rclone`. `backup` takes the
  pre-migrate backup, `backup-scheduler` the daily one, `backup-tools` runs
  `deploy/setup.sh backup …` and `restore`, and `backup-offsite` uploads to a
  bucket when you turn on the off-site copy. Only `backup-offsite` has
  internet access.
- The `db` network is `internal: true`: Postgres has no published port and no
  route to the internet. The server also joins `app` because it needs outbound
  access to email/AI providers.
- Web and API share **one origin** (`https://<domain>`): Caddy routes `/api/*`,
  `/rpc/*`, `/api-reference/*` and `/.well-known/openvalens` (the server check
  the mobile app reads) to the server and everything else to the web app.
- `<version>` is `git describe --tags --always --dirty` of your checkout (a
  commit hash until a release is tagged). Images are built from your checkout;
  published registry images are tracked separately (#129).
- Named volumes: `postgres_data`, `backups`, `storage`, `caddy_data`,
  `caddy_config`. `storage` holds uploaded objects (today, progress photos) at `/var/lib/openvalens/storage` in the server container; see
  [Object storage](../storage.md).
- Docker names everything with the Compose project name,
  `openvalens-selfhost` (set in `deploy/compose.yml`): the volumes are
  `openvalens-selfhost_postgres_data`, `openvalens-selfhost_backups` and so on,
  the containers `openvalens-selfhost-<service>-1`, the networks
  `openvalens-selfhost_<network>`. The images are `openvalens-server`,
  `openvalens-web` and `openvalens-backup`, tagged with `<version>`. On a host
  you share, these names tell you which resources are yours:

  ```bash
  docker volume ls --filter label=com.docker.compose.project=openvalens-selfhost
  docker image ls --filter reference='openvalens-*'
  ```

## Requirements

- A Linux host (Ubuntu 24.04 LTS is the reference) with Docker Engine, the
  Compose v2 plugin (`docker compose`) and `git`.
- A user that may use Docker. Root is not required: a user in the `docker`
  group runs every command on these pages, with the checkout in its home
  directory. Membership of the `docker` group is equivalent to root on the
  host, so give it only to the people who administer the instance.
- A domain whose DNS A/AAAA record points at the host, and inbound TCP 80/443
  (plus UDP 443 for HTTP/3) open. Port 80 is needed for the certificate
  challenge. With a proxy in front that terminates TLS, the proxy needs these
  instead ([Behind a TLS-terminating proxy](#behind-a-tls-terminating-proxy)).
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

A second run, on 2026-10-25, used the recommended minimum on a busier host: a
shared Ubuntu 24.04 VM with 2 vCPU, 3.9 GB RAM and 4 GB swap (about 1.7 GB of
RAM free at the start, other tenants' containers running), Docker 29.6.0 with
Compose 5.1.4, behind an existing reverse proxy. It installed one commit of
`main`, upgraded to a newer one (which added encrypted backups), then backed
up and restored.

| Item                                     | Measured                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| First install (build + start)            | 18 min, cold build cache                                                              |
| Upgrade (full rebuild, backup, migrate)  | 9 min; the site was down for about 10–20 s of it                                      |
| `backup now` / `backup verify` / restore | 5.8 s / 3.2 s / 32 s (a new instance: ~0.6 MB per backup)                             |
| Images on disk                           | server 2.75 GB, backup 0.74 GB, web 0.1 GB, **per version**                           |
| Disk used, install + one upgrade         | +16 GB: two versions of the images (2.85 GB of the old ones left) and the build cache |

Plan for:

- **2 vCPU and 4 GB RAM.** Running the stack needs well under 1 GB, but
  building the images peaks around 3.5 GB. On a 4 GB host that runs other
  things, add swap (the second run had 4 GB) and expect an install to take
  15–20 minutes and an upgrade about 10. On a 2 GB host, add at least 2 GB of
  swap before `install` or `upgrade`, or the build may be killed. (A 2 GB
  host was not tested.)
- **40 GB free disk.** That covers the images, the build cache and at least
  three database-sized backups in the `backups` volume, but not for long:
  every upgrade adds a new set of images (about 3.6 GB) and more build cache,
  and the old images stay until you remove them. The second run went from
  40 GB free to 24 GB free after one install and one upgrade. Reclaim space
  after each upgrade ([Upgrading](upgrading.md#disk-space)).

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
RESEND_API_KEY_SOURCE=$HOME/resend-key \
  deploy/setup.sh install --non-interactive
```

`RESEND_API_KEY_SOURCE` is the path to a private file containing the key
(`chmod 600` it, and delete it once the install has copied it into
`deploy/secrets/`); the key is never accepted as an argument or environment
value. Any user that may use Docker can run this; it does not need root.

`ACME_EMAIL` is always required. Caddy gives it to Let's Encrypt for
certificate expiry notices. With `OPENVALENS_SITE_SCHEME=http` (below) Caddy
requests no certificate and never uses it, so any address of yours will do.

### Behind a TLS-terminating proxy

By default Caddy obtains the certificate itself, which needs ports 80 and 443
to reach the host directly. If a load balancer, tunnel, hosting edge or a
reverse proxy already running on the host terminates HTTPS and forwards plain
HTTP to OpenValens, set `OPENVALENS_SITE_SCHEME=http`. Caddy then serves plain
HTTP for `OPENVALENS_DOMAIN`, asks for no certificate and does not redirect.
The public URL stays `https://<domain>`, so the proxy must serve HTTPS for that
name.

In this mode, choose where Caddy listens with `OPENVALENS_HTTP_PORT` and
`OPENVALENS_HTTPS_PORT`. Each takes `<port>` (every interface) or
`<IP>:<port>` (one address). Two rules:

- **Bind the HTTP port to the address the proxy forwards to**, never to every
  interface: anyone who reaches it talks to OpenValens without TLS. A firewall
  does not help here: Docker-published ports bypass host firewalls such as ufw
  ([What you get](#what-you-get)), so binding the address is the control. For
  a proxy on the same host, use `127.0.0.1:<port>` or the address of the Docker
  bridge the proxy runs on (for example `10.0.0.1:18080` on `docker0`). For a
  proxy on another machine, use this host's private-network address.
- **Move the HTTPS port off every interface.** Caddy's HTTPS port is still
  published in http mode, although nothing uses it, and on a host where the
  proxy already owns 443 it would collide. Bind it to loopback on a free port,
  for example `127.0.0.1:18443`. `setup.sh` refuses to start http mode while
  the HTTPS port is published on every interface.

Pass all three to `install`; it writes them to `deploy/.env`, so every later
`upgrade` and `restore` keeps them:

```bash
OPENVALENS_SITE_SCHEME=http \
OPENVALENS_HTTP_PORT=10.0.0.1:18080 \
OPENVALENS_HTTPS_PORT=127.0.0.1:18443 \
  deploy/setup.sh install
```

Then point the proxy at `http://10.0.0.1:18080` (your address), passing the
original `Host` header. On an existing install, set the same keys in
`deploy/.env` and run `deploy/setup.sh upgrade`
([Applying a change](configuration.md#applying-a-change)). To set any other
key before the very first install, create `deploy/.env` with the marker line
first ([Before the first install](configuration.md#before-the-first-install)).

### Dry run

```bash
deploy/setup.sh install --dry-run --non-interactive   # with the variables above
deploy/setup.sh upgrade --dry-run
deploy/setup.sh mint-token --dry-run
```

A dry run generates the configuration and throwaway secrets in a private
temporary directory, validates `deploy/compose.yml` with `docker compose
config`, checks that only Caddy publishes ports and prints where it will
publish them, prints the Docker commands it would run, and deletes the
temporary directory. Check the ports line before you go live:

```text
setup: caddy publishes HTTP on 10.0.0.1:18080 (to :80/tcp) and HTTPS on 127.0.0.1:18443 (to :443/tcp+udp)
```

`port 80 on all interfaces` means every address of the host. `upgrade --dry-run`
also lists the settings an upgrade would add to `deploy/.env`. On an existing install it
starts from a private copy of `deploy/.env`, so the validation covers your
settings. It changes nothing in `deploy/` and does not start containers. `deploy/setup.sh --help` prints the full usage.

## First administrator and invitations

1. Get the token from `deploy/secrets/setup-token` without printing it into a
   shared or recorded terminal. It is valid for **24 hours** and works once.
   Either copy the file to your own computer and read it there:

   ```bash
   scp <user>@<host>:openvalens/deploy/secrets/setup-token ./setup-token   # on your computer
   ```

   or open it on the server in your own private session with
   `less deploy/secrets/setup-token`, which leaves nothing in the scrollback
   when you quit. Delete any copy once the administrator exists.

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

`/setup` is part of the web app, so it loads whether or not setup is still
open. To check from the command line, ask the server; this is the call the
page makes:

```bash
curl -sS -X POST https://<domain>/rpc/admission/status \
  -H 'Content-Type: application/json' -d '{"json":{}}'
# {"json":{"setupAvailable":true,"emailDeliveryAvailable":true}}
```

`setupAvailable: false` means an administrator already exists.
`emailDeliveryAvailable: false` means email is in dry-run (no Resend key), so
the emailed code cannot arrive ([Email](email.md)). The call takes `POST` with
that exact body: a `GET` answers 405 and an empty body 400.

**After a restore.** The token is checked against the database, so a restore
also restores the state of setup. If you restore a backup taken **before** the
token was minted (or before the newest `mint-token`), the token on disk no
longer matches: run `deploy/setup.sh mint-token` again. If the backup already
has an administrator, setup stays closed and that administrator signs in as
usual. Check with the call above.

## Verify the install

```bash
curl -fsS -X POST https://<domain>/api-reference/health/readiness \
  -H 'Content-Type: application/json' -d '{}' | tee /dev/stderr |
  grep -q '"status":"ok"' && echo READY || echo 'NOT READY: read the checks above'
docker compose -f deploy/compose.yml ps                 # only caddy lists host ports
```

Readiness answers HTTP 200 whatever the status, so `curl -f` alone passes a
degraded instance: the check above looks at the body. `status` is one of:

- `ok`: everything required works.
- `degraded`: the site works, but something needs you. The `checks` say what:
  a required secret missing or too short, `storage` not writable, `backups`
  `failing` or `stale` ([Backups](backup.md#what-runs-automatically)), or
  `backupOffsite` `failing`.
- `unready`: the database is unreachable.

The readiness body also reports each optional integration (`email`, `ai`,
`messaging`) as `configured`, `dry-run` or `off`; see
[Configuration](configuration.md#optional-providers). Those never degrade the
status.

From **another machine**, confirm that only 80/443 answer, for example
`nmap -Pn -p 80,443,3000,3001,5432 <host>` (3000, 3001 and 5432 must not be
open).

**Behind a proxy** ([above](#behind-a-tls-terminating-proxy)), check the
bindings on the host instead: Caddy's ports must listen only on the addresses
you chose, and nothing on 3000, 3001 or 5432.

```bash
ss -ltnu | grep -E ':(18080|18443|3000|3001|5432)\b'   # your ports
# 10.0.0.1:18080 and 127.0.0.1:18443 only; no 0.0.0.0, [::] or *, and no 3000/3001/5432
```

Then load `https://<domain>/` through the proxy.

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
  postgres/                0755  mounted read-only in postgres and the backup services
    POSTGRES_PASSWORD      0444
  backup/                  0755  mounted read-only in the backup services
    age-identity           0444  the backup key: keep a copy off the server
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
