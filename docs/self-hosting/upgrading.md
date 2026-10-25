# Upgrading

**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-25

Upgrades are a `git checkout` followed by `deploy/setup.sh upgrade`. Every
upgrade takes an encrypted, verified backup of the database and the stored
files before it migrates ([Backups](backup.md)). That backup stays on the
same host: keep the [backup key](backup.md#the-backup-key) and recent backups
off the server as well.

## Upgrade

No release has been tagged yet, so today an upgrade means moving to a newer
commit of `main`. Once releases exist, check out the new release tag instead.

```bash
git fetch --tags origin
git checkout main && git pull --ff-only   # or: git checkout <new release tag>
deploy/setup.sh upgrade
```

Preview what it would do without changing anything:

```bash
deploy/setup.sh upgrade --dry-run
```

`upgrade` refreshes `OPENVALENS_VERSION` in `deploy/.env` and adds any setting
the new version manages that the file lacks, with its default (for example
`OPENVALENS_BACKUP_SCHEDULE`, `OPENVALENS_BACKUP_HOUR`,
`OPENVALENS_BACKUP_DAILY_RETAIN` and `OPENVALENS_BACKUP_HOST_ID` on an install
from before encrypted backups). It prints the names of the keys it added and
never changes a value already there or your lines below the marker
([Applying a change](configuration.md#applying-a-change)). It then rebuilds the
images, **stops the running `caddy`, `web` and `server`** (so the server never
serves a half-migrated database), and starts the gated chain:

1. `backup` — takes the pre-migrate backup ([Backups](backup.md)) and reads
   it back. If it fails, nothing else runs.
2. `migrate` — applies pending tracked Drizzle migrations
   (`drizzle-kit migrate`).
3. `server`, `web`, `caddy` and `backup-scheduler` — start only if `migrate`
   exited `0`.

The site is unavailable from the moment the old server stops until the new one
is healthy. The images are built before the old server stops, so with a small
database that is 10–20 seconds; the pre-migrate backup and the migrations run
in that window, so a large database takes longer. The whole `upgrade` took
about 5 minutes on the reference VM (2 vCPU, 8 GB; see
[Resources](install.md#resources)), 48 seconds with a warm build cache, and
9 minutes on a busy 2 vCPU / 4 GB host.

After the upgrade:

1. **Escrow the backup key, if the upgrade created it.** An install from
   before encrypted backups gets its key,
   `deploy/secrets/backup/age-identity`, during the first `upgrade` that
   includes them, and `upgrade` ends with an `IMPORTANT` notice saying so.
   Copy the key off the server now, before you rely on any backup, and check
   the copy against the pre-migrate backup the upgrade just took
   ([The backup key](backup.md#the-backup-key)):

   ```bash
   deploy/setup.sh backup verify --key-file /path/to/your/copy
   ```

2. [Verify the install](install.md#verify-the-install). The readiness status
   should be `ok`. The pre-migrate backup counts as the newest backup, so
   `checks.backups` is `ok` right away.
3. [Reclaim disk space](#disk-space).

### Disk space

Every upgrade builds a new set of images (about 3.6 GB: server, web and
backup), keeps the previous version's images and adds to Docker's build cache.
On the reference VM the build cache grew from about 12 GB to about 23 GB over
two upgrades; on the 4 GB host, one install and one upgrade used 16 GB. Reclaim
the space once the new version works.

**Old OpenValens images.** Keep the previous version's images until you are
sure you will not roll back to it (an image-only rollback,
[below](#rolling-back-past-the-release-that-introduced-encrypted-backups),
uses them; `restore` rebuilds whatever you check out). Then remove the
versions you no longer need. This lists only OpenValens's images, never
another project's:

```bash
current="$(grep '^OPENVALENS_VERSION=' deploy/.env | cut -d= -f2)"
docker image ls --format '{{.Repository}}:{{.Tag}}' --filter reference='openvalens-*' |
  grep -E '^openvalens-(server|web|backup):' | grep -v ":$current\$"
# check the list, then remove those images:
docker image ls --format '{{.Repository}}:{{.Tag}}' --filter reference='openvalens-*' |
  grep -E '^openvalens-(server|web|backup):' | grep -v ":$current\$" | xargs -r docker image rm
```

`docker image rm` refuses an image a container still uses, and never touches
a volume.

**Build cache.** `docker builder prune` is **host-wide**: it removes the build
cache of every project on the host, not only OpenValens's. Run it only on a
host that runs nothing else, or with its administrator's agreement:

```bash
docker builder prune --filter until=24h     # host-wide: every project's build cache
```

On a shared host, give OpenValens a builder of its own and prune only that.
Create it once, and build with it from then on:

```bash
docker buildx create --name openvalens --driver docker-container
echo 'export BUILDX_BUILDER=openvalens' >>~/.profile && export BUILDX_BUILDER=openvalens
deploy/setup.sh upgrade                                        # builds with it
docker buildx prune --builder openvalens --filter until=24h -f # only OpenValens's cache
```

Neither command touches the database, storage or `backups` volumes. The cache
already in the default builder stays until whoever owns the host prunes it.

## When an upgrade fails

**A failed backup or migration leaves the server stopped** and never deletes a
backup. `setup.sh` prints the commands to inspect it:

```bash
docker compose -f deploy/compose.yml logs backup migrate server
deploy/setup.sh backup list
```

Fix the cause and run `deploy/setup.sh upgrade` again; it takes a fresh backup
first. Common causes:

- **Backup failed** — usually a full disk, a missing
  `deploy/secrets/backup/age-identity` (put your escrowed copy back), or
  `OPENVALENS_PRE_MIGRATE_BACKUP` set to `hook` without an executable
  `deploy/hooks/pre-migrate`. The log names the failing step.
- **Migration failed** — the `migrate` log names the failing migration. Do not
  edit the database by hand; open an issue with the log (remove any personal
  data first).

## Rolling back

There are no down-migrations. Rolling back means checking out the previous
version and restoring the pre-migrate backup the upgrade took:

```bash
deploy/setup.sh backup list                    # the newest <stamp>-pre-migrate
git checkout <previous version>
deploy/setup.sh restore <stamp>-pre-migrate    # verify, keep current DB, restore, replay erasures
```

`restore` builds the checked-out (previous) version, keeps the upgraded
database (`openvalens_pre_restore_<stamp>`) and files, restores the backup,
re-applies the erasure ledger so deletions made after the upgrade stay
deleted, and starts the previous version ([Restoring](backup.md#restoring)).
Writes made after the upgrade are lost from the live instance. Practise on a
copy first. This needs a previous version that has encrypted backups; for the
first rollback past it, see below.

### Rolling back past the release that introduced encrypted backups

Versions before encrypted backups (Issue #64) have no `deploy/setup.sh
restore`, and the pre-migrate backup is now encrypted. That release's only
migration (`20261025090000_backup_status`) is additive (two new tables the
older server ignores), so **rolling back past it is image-only**: check out the
previous version, set `OPENVALENS_VERSION` in `deploy/.env` to it, and run
`docker compose -f deploy/compose.yml up -d --remove-orphans` (it removes the
backup services the older version does not have). No data is lost.

If a migration of a later release must also be undone, restore the encrypted
backup **while the newer checkout is still in place** (its tools can decrypt),
then check out the older version:

```bash
C="docker compose -f deploy/compose.yml"
$C stop caddy web server backup-scheduler
$C run --rm --no-deps -T backup-tools verify <id>                      # decrypt + checksums + scratch restore
$C run --rm --no-deps -T backup-tools restore-db <id> "$(date -u +%Y%m%d%H%M%S)"   # keeps the current DB and files
git checkout <previous version>     # set OPENVALENS_VERSION in deploy/.env to it
$C up -d --remove-orphans
```

To decrypt a backup by hand with the escrowed key, for example on a machine
without OpenValens, use [age](https://age-encryption.org) and `pg_restore`
directly (the plaintext never touches the disk):

```bash
age --decrypt --identity /path/to/age-identity <id>/database.dump.age |
  pg_restore --no-owner --exit-on-error --dbname=<empty database>
age --decrypt --identity /path/to/age-identity <id>/files.tar.age | tar -C <storage dir> -xpf -
```

The erasure-ledger replay needs the version that took the backup or a newer
one: an older server's code may not match the backup's schema. After a manual
restore to an older version, list the erasures the restored database is
missing from the kept database
(`select subject_user_id, erased_at from erasure_ledger`) and repeat those
deletions once you are on a version with `restore` again.

For an approved release, the [release runbook](../release.md#6-rollback) has
the rollback commands that keep the upgraded database for forensics and start
the retained previous images, and `scripts/rollback-rehearsal.sh` rehearses the
whole upgrade-and-restore path on a disposable local stack.

## Notes

- A plain `docker compose -f deploy/compose.yml up -d` follows the same
  backup → migrate → server order, but prefer `deploy/setup.sh upgrade`, which
  stops the old server first.
- Every start of the chain — `install`, `upgrade` or `up` — takes a new
  pre-migrate backup of a non-empty database, so each run adds a backup to the
  `backups` volume (pruned to `OPENVALENS_BACKUP_RETAIN`).
- Downgrades without a restore are not supported: an older server against a
  newer schema is untested.
- Security fixes are made on `main` only ([SECURITY.md](../../SECURITY.md));
  upgrade promptly.
