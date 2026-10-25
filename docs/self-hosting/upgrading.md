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

`upgrade` refreshes `OPENVALENS_VERSION` in `deploy/.env` (all other keys are
kept), rebuilds the images, **stops the running `caddy`, `web` and `server`**
(so the server never serves a half-migrated database), then starts the gated
chain:

1. `backup` — takes the pre-migrate backup ([Backups](backup.md)) and reads
   it back. If it fails, nothing else runs.
2. `migrate` — applies pending tracked Drizzle migrations
   (`drizzle-kit migrate`).
3. `server`, `web`, `caddy` and `backup-scheduler` — start only if `migrate`
   exited `0`.

An install from before encrypted backups gets its backup key during the first
`upgrade` that includes them; `upgrade` then reminds you to copy it off the
server.

The site is unavailable from the moment the old server stops until the new one
is healthy. On the reference VM (2 vCPU, 8 GB; see
[Resources](install.md#resources)), an upgrade that rebuilt the images took
about 5 minutes, and one with a warm build cache took 48 seconds.

### Disk space

Every upgrade rebuilds the images, and Docker keeps the old build cache. On the
reference VM it grew from about 12 GB to about 23 GB over two upgrades. After a
successful upgrade, reclaim it with:

```bash
docker builder prune --filter until=24h
```

This removes only cached build layers, never the database, storage or
`backups` volumes.

Afterwards, [verify the install](install.md#verify-the-install).

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
copy first.

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
