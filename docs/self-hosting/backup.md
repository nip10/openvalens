# Backups

**Applies to:** OpenValens 0.9.0 · Last updated: 2026-10-25

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
2. **Get backups off the server**: turn on the [off-site copy](#off-site-copy)
   to any S3-compatible bucket, or [export them](#copying-backups-off-the-host)
   yourself. Backups are kept in a Docker volume on the same disk as the
   database: losing the host loses them too.
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
> trusted machine. Check the copy against a backup (below), and practise a
> restore with it once ([Restoring onto a new host](#restoring-onto-a-new-host)).

Copy the key as a **file**; never print it. `cat` would put it in the
terminal's scrollback, in session recordings and in any log of the session,
and it must never go through chat, a ticket or a log. Pick one:

```bash
# From your own computer, into a private file there:
scp <user>@<host>:openvalens/deploy/secrets/backup/age-identity ./openvalens-age-identity
chmod 600 ./openvalens-age-identity

# On the server, onto removable media you then store safely:
install -m 0400 deploy/secrets/backup/age-identity /media/<usb>/openvalens-age-identity
```

A password manager that stores file attachments can hold the copied file; if
it takes only text, open the file in a private session and paste it there,
nowhere else.

Then check that the copy works, on the same host: it must decrypt a backup.
Wait for the first backup on a fresh install (`deploy/setup.sh backup list`).

```bash
deploy/setup.sh backup verify --key-file /media/<usb>/openvalens-age-identity          # newest backup
deploy/setup.sh backup verify <id> --key-file /media/<usb>/openvalens-age-identity     # one backup
```

`setup.sh` reads the file and passes it on standard input to a one-off backup
container, which decrypts every file of the backup with it and checks every
checksum. The key is never printed, put on a command line or kept, and the
check is not recorded as a verify of the backup, so a wrong copy cannot make
readiness report the backups as `failing`. A copy of another key fails at the
`key` step; a file that is not an age key is refused before anything runs.
`deploy/secrets/backup/age-identity` itself does not need to exist, so you can
also check a copy before you put it back.

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
backups are `failing` or `stale`. Any good backup counts, whatever took it:
daily, pre-migrate or `backup now`. **`/admin/settings`** shows the last backup,
the last verify, the next scheduled backup and the step of the last failure.

The pre-migrate backup of the upgrade that introduces encrypted backups runs
before the migration that creates their status table, so it cannot be
recorded at that moment. The scheduler records it when it starts, right after
that migration, so readiness reports `ok` after the upgrade instead of
`stale` until the next daily backup.

To confirm the schedule from the command line, before any administrator
exists to open `/admin/settings`:

```bash
docker compose -f deploy/compose.yml logs backup-scheduler | grep 'daily encrypted backups'
# openvalens-backup: daily encrypted backups at 03:00 UTC, keeping 14
deploy/setup.sh backup list                       # what is in the backups volume
curl -sS -X POST https://<domain>/api-reference/health/readiness \
  -H 'Content-Type: application/json' -d '{}' | grep -o '"backups":"[a-z]*"'
```

With `OPENVALENS_BACKUP_SCHEDULE=off` the log says so instead. The schedule
settings are in `deploy/.env` (`OPENVALENS_BACKUP_*`). On an install from
before encrypted backups, `upgrade` adds them with their defaults
([Upgrading](upgrading.md#upgrade)).

### Using your own backups instead

If you back up some other way (a `hook`, volume snapshots), set
`OPENVALENS_BACKUP_SCHEDULE=off` in `deploy/.env` and run
`deploy/setup.sh install`. The scheduler then takes no daily backups and
removes its schedule, so readiness does not report backups as `stale`.
Readiness also ignores a schedule nobody has refreshed for three days (for
example after the database moved off the self-host stack).

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

## Off-site copy

Optional, off by default. When configured, every backup that has been
written **and verified** (daily, pre-migrate and `backup now`) is copied to an
S3-compatible bucket: AWS S3, MinIO, Backblaze B2, Hetzner Object Storage,
Cloudflare R2 and others. The bucket only ever receives what is already in
the backup directory: the `.age` files and `SHA256SUMS`. It never sees a
plaintext byte or the key.

1. Create a **private** bucket and an access key that can list, read, write
   and delete objects in it (it does not need to create buckets). Bucket
   versioning or object lock on the provider side adds protection against a
   stolen key.
2. Put the key in two files (they are never put in `deploy/.env` or printed):

   ```bash
   install -m 0444 /dev/stdin deploy/secrets/backup/BACKUP_OFFSITE_S3_ACCESS_KEY_ID      # paste, then Ctrl-D
   install -m 0444 /dev/stdin deploy/secrets/backup/BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY  # paste, then Ctrl-D
   ```

3. Set the bucket in `deploy/.env` ([Configuration](configuration.md#deployenv)):

   ```bash
   BACKUP_OFFSITE_S3_BUCKET=my-openvalens-backups
   BACKUP_OFFSITE_S3_ENDPOINT=https://s3.eu-central-003.backblazeb2.com   # empty for AWS S3
   BACKUP_OFFSITE_S3_REGION=eu-central-003
   BACKUP_OFFSITE_S3_PREFIX=openvalens                                    # folder in the bucket
   BACKUP_OFFSITE_S3_FORCE_PATH_STYLE=false                               # true for MinIO
   ```

4. Run `deploy/setup.sh install` (it keeps everything else). It sets
   `COMPOSE_PROFILES=offsite`, which starts the `backup-offsite` service.

How it works and why it is a separate service: the backup services have no
internet access, and that stays true. `backup-offsite` is the only one with
a network that reaches the internet, and it gets the least: no database
network or password, no backup key, only the encrypted backups and the two
credential files. It checks the backups volume every 30 seconds
(`OPENVALENS_OFFSITE_POLL_SECONDS`), uploads each finished backup (data files
first, `SHA256SUMS` last, then a size and checksum comparison) and applies the
same retention in the bucket as on the host: the newest
`OPENVALENS_BACKUP_DAILY_RETAIN` daily and `OPENVALENS_BACKUP_RETAIN`
pre-migrate backups; manual backups stay until you delete them there.
`backup now` uploads right away.

Each host uploads into its own folder, `<prefix>/<OPENVALENS_BACKUP_HOST_ID>/`
(a random id `install` writes once into `deploy/.env`), and retention only
ever prunes that folder. A new host restoring from the bucket therefore never
deletes the old host's backups, however many daily backups of its own it
takes. `backup pull` lists and fetches from every folder.

An upload never blocks anything: the pre-migrate backup only has to exist and
verify on the host before a migration runs. A failed upload is retried every
15 minutes and recorded: readiness reports `checks.backupOffsite: failing`
(status `degraded`; `checks.backups` stays `ok` because the local backup is
good) and `/admin/settings` shows the failing step.

```bash
deploy/setup.sh backup pull                 # list the backups in the bucket
deploy/setup.sh backup pull <id|latest>     # copy one into the volume and verify it
```

`pull` downloads a backup, checks every file against its `SHA256SUMS`, and
verifies it with the key; then `deploy/setup.sh restore <id>` restores it.
That is how a new host gets its backups ([Restoring onto a new host](#restoring-onto-a-new-host)).

## Copying backups off the host

Without the off-site copy, or in addition to it, copy backups yourself.
Follow the 3-2-1 rule: three copies, on two kinds of storage, one of them
off site.

```bash
deploy/setup.sh backup export <id> /path/to/dir    # copies <id>/ (still encrypted) to the host
```

The exported directory is encrypted, so it is safe to send to any storage you
trust to keep it: `rsync` or `rclone` to another machine, an S3-compatible
bucket, removable media. The key is not in it. Schedule the export and the
copy with your own `cron` job, for example nightly after the backup hour.
Copy the newest backups, not only old ones: the erasure ledger in the newest
backup is what keeps deleted people deleted when you restore an older one
elsewhere.

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
still in the kept database).

The state of first-administrator setup is in the database too. If no
administrator existed yet and the backup predates the setup token in
`deploy/secrets/setup-token`, that token no longer works: run
`deploy/setup.sh mint-token` for a new one
([First administrator](install.md#first-administrator-and-invitations)).

> **The kept copies hold live data.** `openvalens_pre_restore_<stamp>` and
> `storage/.pre-restore-<stamp>/` are full copies of the instance as it was
> before the restore. Later "Delete everything" requests do **not** reach
> them, and they are not in any backup. Delete them with
> `deploy/setup.sh backup cleanup --force` as soon as you accept the restore.

When the instance looks right, delete what the restore kept; to go back
instead, undo it:

```bash
deploy/setup.sh backup cleanup            # lists kept databases, files and legacy dumps
deploy/setup.sh backup cleanup --force    # deletes them
deploy/setup.sh backup undo-restore <stamp>   # asks you to type UNDO (--force skips)
```

`undo-restore` never drops anything: the database and files it replaces are
kept in turn under a new stamp (so an undo can be undone), then it migrates,
merges the erasure ledgers of **every** kept database and backup, re-applies
them and starts the stack. Anyone who deleted their data after the restore
stays deleted.

If the restore itself fails, the previous database and files are put back
automatically, and the message says exactly what was put back and gives the
stamp. If a step after it fails (a migration or the ledger replay), the
server stays stopped and the message names the stamp: fix the cause and run
the restore again (the ledger merge reads every kept database, so erasures
recorded only in a database kept by the first attempt still apply), or undo
it.

For a rollback to the previous release after a failed upgrade, see
[Upgrading](upgrading.md#rolling-back) and the
[release runbook](../release.md#self-host-restore-rollback).

## Restoring onto a new host

1. On the new host, check out the same OpenValens version (or a newer one).
   If you copy the old `deploy/.env` over, delete its
   `OPENVALENS_BACKUP_HOST_ID` line first so the new host gets its own folder
   in the off-site bucket (or set a new `BACKUP_OFFSITE_S3_PREFIX`).
2. Put the escrowed key in place **before** installing, so `install` keeps it
   (`install` refuses to generate a new key while the `backups` volume holds
   encrypted backups; `--new-backup-key` overrides that, leaving those backups
   unreadable):

   ```bash
   install -d -m 0700 deploy/secrets && install -d -m 0755 deploy/secrets/backup
   install -m 0444 /path/to/escrowed/age-identity deploy/secrets/backup/age-identity
   ```

   Also restore `deploy/secrets/server/BETTER_AUTH_SECRET` and `deploy/.env` if
   you kept them ([The backup key](#the-backup-key)).

3. Install: `deploy/setup.sh install`. With the off-site copy, put its two
   credential files in `deploy/secrets/backup/` and its settings in
   `deploy/.env` first.
4. Bring in the backup to restore and the newest one you have, either from
   the bucket or from copies you exported:

   ```bash
   deploy/setup.sh backup pull <id>              # from the off-site bucket
   deploy/setup.sh backup pull latest
   deploy/setup.sh backup import /path/to/<id>   # from an exported copy
   ```

5. `deploy/setup.sh restore <id>`, then [verify the install](install.md#verify-the-install).

This was rehearsed on 2026-10-25 on a disposable local install: the stack and
all its volumes and secrets were destroyed, a fresh install could not read the
old backups with its own new key (a clear `key` failure), and with the
escrowed key and the imported backups the restore brought back the database
and the stored files, with a person erased after the backup still erased.
`bun run test:offsite` (also a CI job) pulls a backup from a disposable MinIO
onto an empty stack and restores it. Neither has been rehearsed on a VPS or
with a large database.

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
- **The off-site copy is a mirror, not an archive.** Retention deletes old
  backups in the bucket too; use the provider's versioning or object lock if
  you need copies that the host cannot delete.
- **S3 objects are not in the backup.** Use bucket versioning and replication.
- Backups, verifies and restores never overlap: a backup or verify waits for
  the one running, and a restore refuses to start while one runs.
