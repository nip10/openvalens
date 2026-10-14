# Upgrading

**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-14

Upgrades are a `git checkout` followed by `deploy/setup.sh upgrade`. Every
upgrade takes a database backup before it migrates; read
[Backups](backup.md) for what that backup is (a plain, unencrypted `pg_dump`)
and is not (an encrypted, off-host, drill-tested backup — Issue #64).

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

1. `backup` — runs the pre-migrate backup hook ([Backups](backup.md)). If it
   fails, nothing else runs.
2. `migrate` — applies pending tracked Drizzle migrations
   (`drizzle-kit migrate`).
3. `server`, `web`, `caddy` — start only if `migrate` exited `0`.

The site is unavailable from the moment the old server stops until the new one
is healthy. On the development machine used for these docs, an upgrade with a
warm build cache took about 20 seconds.

Afterwards, [verify the install](install.md#verify-the-install).

## When an upgrade fails

**A failed backup or migration leaves the server stopped** and never deletes a
backup. `setup.sh` prints the commands to inspect it:

```bash
docker compose -f deploy/compose.yml logs backup migrate server
docker compose -f deploy/compose.yml run --rm --no-deps --entrypoint ls backup -l /backups
```

Fix the cause and run `deploy/setup.sh upgrade` again; it takes a fresh backup
first. Common causes:

- **Backup failed** — usually a full disk, or `OPENVALENS_PRE_MIGRATE_BACKUP`
  set to `hook` without an executable `deploy/hooks/pre-migrate`.
- **Migration failed** — the `migrate` log names the failing migration. Do not
  edit the database by hand; open an issue with the log (remove any personal
  data first).

## Rolling back

There are no down-migrations. Rolling back means restoring the backup taken
before the upgrade and checking out the previous version. There is no supported,
drill-tested restore procedure yet (Issue #64); the
[interim manual restore](backup.md#interim-manual-restore) describes the steps
that were checked once on a development machine. Roll back only when you must,
and practise on a copy first.

## Notes

- A plain `docker compose -f deploy/compose.yml up -d` follows the same
  backup → migrate → server order, but prefer `deploy/setup.sh upgrade`, which
  stops the old server first.
- Every start of the chain — `install`, `upgrade` or `up` — takes a new
  pre-migrate backup of a non-empty database, so each run adds a dump to the
  `backups` volume (pruned to `OPENVALENS_BACKUP_RETAIN`).
- Downgrades without a restore are not supported: an older server against a
  newer schema is untested.
- Security fixes are made on `main` only ([SECURITY.md](../../SECURITY.md));
  upgrade promptly.
