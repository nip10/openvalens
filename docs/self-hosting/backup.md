# Backups

**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-14

> **This page is not complete, and neither are backups.** OpenValens 0.1.0
> has **no scheduled, encrypted or off-host backups and no supported restore
> procedure.** The only backup it takes is a plain, **unencrypted** `pg_dump`
> before each migration, stored on the same host. Automatic encrypted backups,
> verification, restore drills and erasure-ledger replay are Issue #64, which
> has not landed. Until it does, protecting your data is your responsibility.

## What exists today

### The pre-migrate backup

Every start of the stack (`deploy/setup.sh install`, `deploy/setup.sh upgrade`
or `docker compose -f deploy/compose.yml up`) runs the one-shot `backup`
service before `migrate`. It runs `deploy/pre-migrate-backup.sh`; a non-zero
exit stops the chain, so migrations do not run and the server does not start.

Select its behavior in `deploy/.env` ([Configuration](configuration.md#deployenv)):

| `OPENVALENS_PRE_MIGRATE_BACKUP` | Behavior                                                                                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pg_dump` (default)             | Plain `pg_dump --format=custom` into the `backups` volume as `pre-migrate-<UTC timestamp>.dump` (mode `0600`), verified with `pg_restore --list` before it counts. Skipped only for an empty (fresh) database. |
| `hook`                          | Runs your executable `deploy/hooks/pre-migrate` (see `deploy/hooks/pre-migrate.example`) with `PG*` connection variables set. It must exit `0` only after a backup you trust exists.                           |
| `none`                          | Takes no backup and is **refused** unless `OPENVALENS_ALLOW_MIGRATE_WITHOUT_BACKUP=I_HAVE_A_BACKUP` is also set. Use only when you have just taken your own verified backup.                                   |

`OPENVALENS_BACKUP_RETAIN` (default `10`) keeps the newest N `pre-migrate-*`
dumps; `0` keeps all of them. Dumps written by your own hook are not pruned.

What this is **not**:

- **Not scheduled.** A dump is taken only when the stack starts. An instance
  that runs for months without an upgrade has no recent dump.
- **Not encrypted.** Each dump is the whole health database in clear text,
  protected only by the Docker volume's host permissions.
- **Not off-host.** The dumps live in the `backups` volume on the same disk as
  the database. Losing the host loses both.
- **Not a full backup.** It covers the database only — not `deploy/.env`,
  `deploy/secrets/`, the Caddy certificate volumes or the `storage` volume.

With the default local object storage, uploaded files (progress photos, lab
PDFs, export bundles) live in the `storage` volume
(`/var/lib/openvalens/storage` in the server container). The database indexes
those files, so back the volume up together with the database, from the same
point in time. See [Object storage → Backups](../storage.md#backups).

### Listing and copying dumps

```bash
docker compose -f deploy/compose.yml run --rm --no-deps --entrypoint ls backup -l /backups
docker compose -f deploy/compose.yml cp backup:/backups/<file>.dump ./
```

`cp` needs the stopped `backup` container, which exists after any start of
the stack. The copy keeps mode `0600`. Store copies encrypted and off the host,
with the same care as the database itself, and delete copies you no longer
need.

### Your own hook

To control how the pre-migrate dump is taken (for example to keep dumps under
your own naming and retention), copy the example hook, adapt it, and switch the
mode:

```bash
cp deploy/hooks/pre-migrate.example deploy/hooks/pre-migrate
chmod 0755 deploy/hooks/pre-migrate
# edit deploy/hooks/pre-migrate, then set OPENVALENS_PRE_MIGRATE_BACKUP=hook in deploy/.env
deploy/setup.sh upgrade
```

The hook runs inside the `backup` service (the pinned `postgres` image) with
`PGHOST`, `PGUSER`, `PGDATABASE` and `PGPASSWORD` set and the `backups` volume
at `/backups`. The `backup` service is attached only to the internal `db`
network, so it has **no internet access**: a hook cannot upload anything.
Copy dumps off the host from the host itself, for example with the `cp`
command above in a script of your own.
`deploy/hooks/pre-migrate` is git-ignored.

## Interim manual restore

> **Unsupported.** These steps were run once, on 2026-10-14, against a
> disposable install on a development machine: a dump taken by `upgrade` was
> restored, a table created after the dump was gone, and the stack restarted
> with readiness `ok`. That is not the restore drill Issue #64 requires, and it
> has not been tested on a VPS or with a large database. **Restoring replaces
> the current database; everything written after the dump is lost.**

1. Choose the dump: `docker compose -f deploy/compose.yml run --rm --no-deps --entrypoint ls backup -l /backups`.
2. Stop the services that use the database (Postgres keeps running):

   ```bash
   docker compose -f deploy/compose.yml stop caddy web server
   ```

3. Replace the database with the dump (replace `<file>`):

   ```bash
   docker compose -f deploy/compose.yml run --rm --no-deps --entrypoint sh backup -c \
     'export PGPASSWORD="$(cat /run/secrets/POSTGRES_PASSWORD)" &&
      dropdb --force --no-password openhealth &&
      createdb --no-password openhealth &&
      pg_restore --no-password --exit-on-error --dbname=openhealth /backups/<file>.dump'
   ```

4. Check out the version that matches the dump — for a rollback, the version
   you upgraded from — and start the stack, which backs up the restored
   database, re-applies any newer migrations and starts the server:

   ```bash
   deploy/setup.sh upgrade
   ```

5. [Verify the install](install.md#verify-the-install) and sign in.

Restoring onto a **new** host, restoring a dump copied back from off-host
storage, and restoring the secrets are not covered yet (#64).

## Deleted accounts and old backups

When someone uses "Delete everything" ([Privacy and data rights](privacy.md)),
their rows are removed from the live database and an erasure-ledger row
records the deleted ids and counts. Their data **remains in every earlier
dump** until that dump is pruned or deleted, including copies you made. If you
restore an older dump, the deleted data comes back. Replaying the erasure
ledger after a restore is part of Issue #64 and does not exist yet; until then,
avoid restoring dumps older than a deletion, or repeat the deletion afterwards.

## Still missing (Issue #64)

- Scheduled, automatic backups of the database and stored files.
- Encryption at rest and off-host targets.
- Automatic verification and a documented, drill-tested restore.
- Erasure-ledger replay after a restore.
