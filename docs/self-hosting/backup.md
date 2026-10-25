# Backups

**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-25

A self-hosted instance backs itself up. With no extra configuration it takes
an **encrypted backup of the database and the stored files every day** and
**before every migration**, checks that each one can be read back, restores
the daily one into a scratch database to prove it works, and keeps the last
14 daily backups. `deploy/setup.sh restore` puts a backup back with one
command, and people who used "Delete everything" after that backup **stay
deleted**.

What you must do yourself:

1. **Keep a copy of the backup key off the server**
   ([The backup key](#the-backup-key)). Without it no backup can be restored.
2. **Copy backups off the server** ([Copying backups off the host](#copying-backups-off-the-host)).
   Backups are kept in a Docker volume on the same disk as the database:
   losing the host loses them too.
3. **Practise a restore** on a spare machine once, so you know the steps
   before you need them ([Restoring onto a new host](#restoring-onto-a-new-host)).

## The backup key

Every backup is encrypted with [age](https://age-encryption.org) to the key in
`deploy/secrets/backup/age-identity`. `deploy/setup.sh install` (or `upgrade`,
on an install that predates backups) generates it once, on the host, and never
prints it. Re-running `install` never replaces it.

> **If the key is lost, every backup is useless.** Nobody, including the
> OpenValens maintainers, can decrypt a backup without it. Copy the file off
> the server as soon as it exists, and keep the copy as safe as the health data
> itself: a password manager entry, an encrypted USB drive in a safe, a second
> trusted machine. Check the copy by restoring once
> ([Restoring onto a new host](#restoring-onto-a-new-host)).

Read the key only on the server's own terminal, never through chat, a ticket
or a log:

```bash
cat deploy/secrets/backup/age-identity     # AGE-SECRET-KEY-1...; copy it somewhere safe
```

For a move to a new host, also keep `deploy/secrets/server/BETTER_AUTH_SECRET`
(or the whole `deploy/secrets/` directory) and `deploy/.env`. The database
stores wearable tokens and signs links with keys derived from
`BETTER_AUTH_SECRET`: with a new one, people must reconnect their wearables
and sign in again, but no health data is lost.

Why age: it is a small, widely used file-encryption tool with a stable,
documented format (X25519 and ChaCha20-Poly1305, authenticated, so a damaged or
altered file fails to decrypt instead of decrypting to garbage). It is packaged
in Debian, so the backup image installs it from the signed Debian archive on
top of the pinned Postgres image, and its keys are one line of text that is
easy to escrow. GPG does the same job with far more configuration and failure
modes; restic adds its own repository format and deduplication, which a single
dump and one file archive per backup do not need.

## What runs automatically

| When                                                                                   | What                                                                                                                                   | Kept                                                   |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Daily at `OPENVALENS_BACKUP_HOUR` (UTC, default `3`)                                   | A backup, then a **full verify**: checksums, decrypt, and a restore into a scratch database with the row count of every table compared | newest `OPENVALENS_BACKUP_DAILY_RETAIN` (default `14`) |
| When the stack starts and the newest backup is more than a day old                     | The same, right away (a fresh install gets its first backup within a minute; so does a host that was off at the scheduled hour)        | as above                                               |
| Every start of the stack (`install`, `upgrade`, `docker compose up`), before `migrate` | A backup, verified (checksums, decrypt, `pg_restore --list`, file checksums) before migrations may run. Skipped for an empty database  | newest `OPENVALENS_BACKUP_RETAIN` (default `10`)       |
| `deploy/setup.sh backup now`                                                           | A backup and a full verify                                                                                                             | until you delete it                                    |

The daily backups and their verify run in the `backup-scheduler` service. The
pre-migrate backup is the one-shot `backup` service; if it fails, migrations
do not run and the server does not start, so a failed backup never turns into
an unprotected upgrade. Both run only on the internal `db` network: they have
no internet access.

Every run is recorded in the database. The **readiness probe** reports
`checks.backups` (`ok`, `failing` when the newest backup or verify failed,
`stale` when no good backup is under 48 hours old or the scheduler is overdue,
`off` when no backup service ever reported) and reports `degraded` when
backups are `failing` or `stale`. **`/admin/settings`** shows the last backup,
the last verify, the next scheduled backup and the step of the last failure.

### The pre-migrate backup mode

Select it in `deploy/.env` ([Configuration](configuration.md#deployenv)):

| `OPENVALENS_PRE_MIGRATE_BACKUP` | Behavior                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pg_dump` (default)             | The encrypted backup of the database and stored files described on this page, verified before it counts.                                                                             |
| `hook`                          | Runs your executable `deploy/hooks/pre-migrate` (see `deploy/hooks/pre-migrate.example`) with `PG*` connection variables set. It must exit `0` only after a backup you trust exists. |
| `none`                          | Takes no backup and is **refused** unless `OPENVALENS_ALLOW_MIGRATE_WITHOUT_BACKUP=I_HAVE_A_BACKUP` is also set. Use only when you have just taken your own verified backup.         |

`hook` and `none` change only the pre-migrate backup; the daily backups keep
running. A hook runs inside the `backup` service with the `backups` volume at
`/backups` and no internet access; if it writes unencrypted dumps, treat that
volume as health data. `deploy/hooks/pre-migrate` is git-ignored.

## What is in a backup

Each backup is one directory in the `backups` volume, named
`<UTC time>-<daily|pre-migrate|manual>`, for example
`20261025T030000Z-daily`:

| File                     | Contents                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `database.dump.age`      | `pg_dump --format=custom` of the whole database                                                             |
| `files.tar.age`          | The stored files (photos, lab PDFs, exports) of the `storage` volume                                        |
| `files.sha256.age`       | The SHA-256 of every stored file                                                                            |
| `erasure-ledger.csv.age` | The erasure ledger at backup time ([Deleted accounts](#deleted-accounts-and-the-erasure-ledger))            |
| `manifest.json.age`      | Backup id, app version, the dump's SHA-256 and the row count of every table, file count and archive SHA-256 |
| `SHA256SUMS`             | The SHA-256 of each `.age` file, so a copy can be checked without the key                                   |

The dump, the row counts and the ledger come from one database snapshot, so a
verify can compare the counts exactly. The files are archived just after the
dump: a file uploaded in that moment is kept without a database row, which is
harmless.

**Not in a backup:** `deploy/.env`, `deploy/secrets/` (including the backup
key itself), the Caddy certificate volumes, and stored files when
`STORAGE_PROVIDER=s3`: with S3 the objects live in your bucket, so protect
them with the bucket's own versioning and replication ([Object
storage](../storage.md#backups)). Restoring an S3 install restores the
database only.

Backups are full copies, not increments: plan disk space for about
`OPENVALENS_BACKUP_DAILY_RETAIN + OPENVALENS_BACKUP_RETAIN` times the
size of one backup (`deploy/setup.sh backup list` shows the sizes). A full
verify briefly needs room for a second copy of the database.

## Checking backups

```bash
deploy/setup.sh backup list              # every backup, its size; legacy plain dumps flagged
deploy/setup.sh backup verify            # full verify of the newest backup
deploy/setup.sh backup verify <id>       # ... of one backup
deploy/setup.sh backup verify <id> --quick   # skip the scratch-database restore
deploy/setup.sh backup now               # take one now (also fully verified)
```

A verify with the wrong key fails at the `key` step with a message that says
the files are intact but were encrypted for a different key; a damaged copy
fails at the `checksum` step. Neither changes anything.

## Copying backups off the host

The backups volume sits on the same disk as the database. Follow the 3-2-1
rule: three copies, on two kinds of storage, one of them off site.

```bash
deploy/setup.sh backup export <id> /path/to/dir    # copies <id>/ (still encrypted) to the host
```

The exported directory is encrypted, so it is safe to send to any storage you
trust to keep it: `rsync` or `rclone` to another machine, an S3-compatible
bucket, removable media. The key is not in it. Schedule the export and the
copy with your own `cron` job, for example nightly after the backup hour;
OpenValens does not upload anything itself (the backup services have no
internet access). Copy the newest backups, not only old ones: the erasure
ledger in the newest backup is what keeps deleted people deleted when you
restore an older one elsewhere.

## Restoring

```bash
deploy/setup.sh backup list
deploy/setup.sh restore <id>             # asks you to type RESTORE
deploy/setup.sh restore <id> --non-interactive --force
```

`restore`:

1. Builds the images of the checked-out version (cached when nothing
   changed). For a rollback, check out the previous version first.
2. **Verifies the backup** (checksums, decrypt, a full scratch restore). If
   that fails, nothing is changed.
3. Stops `caddy`, `web`, `server` and `backup-scheduler`.
4. **Keeps the current database** by renaming it
   `openvalens_pre_restore_<stamp>`, and moves the current stored files to
   `.pre-restore-<stamp>/` inside the `storage` volume. Nothing is deleted.
5. Restores the database and the stored files, and checks every file's
   SHA-256. If either fails, the kept database and files are put back.
6. Applies the migrations of the checked-out version.
7. Merges the erasure ledgers of the kept database and of every backup in the
   volume into the restored database, then **re-applies the ledger**: everyone
   who used "Delete everything" is erased again, with their stored files.
8. Starts the stack, which takes a fresh pre-migrate backup of the restored
   data.

Everything written after the backup is lost from the live instance (it is
still in the kept database). When the instance looks right, delete what the
restore kept; to go back instead, undo it:

```bash
deploy/setup.sh backup cleanup            # lists kept databases, files and legacy dumps
deploy/setup.sh backup cleanup --force    # deletes them
deploy/setup.sh backup undo-restore <stamp>   # puts the kept database and files back
deploy/setup.sh upgrade                   # then start the stack again
```

If a step after the restore fails (a migration or the ledger replay), the
server stays stopped and the message names the stamp: fix the cause and run
the restore again, or undo it.

For a rollback to the previous release after a failed upgrade, see
[Upgrading](upgrading.md#rolling-back) and the
[release runbook](../release.md#self-host-restore-rollback).

## Restoring onto a new host

1. On the new host, check out the same OpenValens version (or a newer one).
2. Put the escrowed key in place **before** installing, so `install` keeps it:

   ```bash
   install -d -m 0700 deploy/secrets && install -d -m 0755 deploy/secrets/backup
   install -m 0444 /path/to/escrowed/age-identity deploy/secrets/backup/age-identity
   ```

   Also restore `deploy/secrets/server/BETTER_AUTH_SECRET` and `deploy/.env` if
   you kept them ([The backup key](#the-backup-key)).

3. Install: `deploy/setup.sh install`.
4. Copy the backup directories you exported in, the one to restore and the
   newest one you have:

   ```bash
   deploy/setup.sh backup import /path/to/<id>
   ```

5. `deploy/setup.sh restore <id>`, then [verify the install](install.md#verify-the-install).

This was rehearsed on 2026-10-25 on a disposable local install: the stack and
all its volumes and secrets were destroyed, a fresh install could not read the
old backups with its own new key (a clear `key` failure), and with the
escrowed key and the imported backups the restore brought back the database
and the stored files, with a person erased after the backup still erased. It
has not yet been rehearsed on a VPS or with a large database.

## Deleted accounts and the erasure ledger

When someone uses "Delete everything" ([Privacy and data rights](privacy.md)),
their rows and stored files are removed from the live instance and an
**erasure-ledger** row records their user id, organization ids and row counts
(no health values). Their data **remains in older backups** until those age
out of retention, and in any copies you made.

A restore therefore never trusts the backup's own ledger alone. It merges the
ledger of the database it replaces and of every backup in the volume, then
erases every person in it again, including their stored files. Data deleted
after a backup does not come back.

On a new host there is no replaced database: the merged ledger comes from the
backups you imported. Import the newest backup you have as well as the one you
restore, and a deletion that happened after the older backup still applies.

## Legacy unencrypted dumps

Installs from before encrypted backups wrote plain, unencrypted
`pre-migrate-<stamp>.dump` files into the `backups` volume. They are no longer
written or pruned. `backup list` flags them; once an encrypted backup has
verified, delete them with `deploy/setup.sh backup cleanup --force`. They can
still be restored by hand with `pg_restore` if you need one.

## Limits

- **No point-in-time recovery.** A restore goes back to the last backup;
  anything written after it is lost from the live instance. For continuous
  archiving use Postgres tools such as pgBackRest or WAL-G yourself.
- **No built-in off-site upload.** Export and copy the encrypted backups with
  your own job.
- **S3 objects are not in the backup.** Use bucket versioning and replication.
- Backups, verifies and restores never overlap: a backup or verify waits for
  the one running, and a restore refuses to start while one runs.
