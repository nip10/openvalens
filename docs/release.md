# Release, deploy and rollback runbook

Last updated: 2026-10-15

This runbook covers Issue #129: building release artifacts pinned by digest, a
written migration plan, readiness verification, and a rehearsed rollback path.
It is the procedure a human operator follows. **Neither this document nor the
tooling it describes authorizes a deployment.** Opening, merging or closing an
issue or pull request is not authorization either.

Boundaries: this does not claim the self-host installer is complete (#63) or
that backups are production-ready (#64). The pre-migrate backup is still a
plain, unencrypted `pg_dump` ([Backups](self-hosting/backup.md)).
Post-deploy verification of email, login, admission, Telegram and AI is a
separate runbook: [production-verification.md](production-verification.md)
(Issue #128).

| Tool                            | What it does                                                                  | Touches production? |
| ------------------------------- | ----------------------------------------------------------------------------- | ------------------- |
| `scripts/release-manifest.ts`   | Builds or inspects the app images and writes a digest manifest; `verify` mode | No (local Docker)   |
| `scripts/verify-readiness.ts`   | Read-only web, API, anonymous and protected RPC and integration checks        | Read-only requests  |
| `scripts/rollback-rehearsal.sh` | Full install → upgrade → rollback on a disposable local stack                 | No (local only)     |

None of them pushes an image, creates a git tag, runs a migration against a
real database, or calls Resend, Anthropic or Telegram.

## 1. Authorization checklist

Every box must be checked, by name and date, in the release record (the
template at the end of section 7) **before** the first production command. The two
approvals are separate on purpose: approving a deployment does not approve a
migration.

**A. Deployment approval**

- [ ] The release commit and version are named, and the release manifest
      (section 2) is attached.
- [ ] Approved image digests: `openvalens-server@…` and `openvalens-web@…`,
      copied from the manifest.
- [ ] Target environment and public origin(s) are named.
- [ ] Deployment window agreed; who runs it and who is on call.
- [ ] The previous known-good version and its manifest are named, and its
      images are still present on the host (rollback target).
- [ ] A local rollback rehearsal (section 7) passed for this exact pair of
      versions, transcript attached.
- [ ] Approved by: **\_\_\_\_** on **\_\_\_\_** (written, in the release issue).

**B. Migration approval** (required whenever the manifest lists added
migrations; record "no migrations" otherwise)

- [ ] The migration plan (section 3) is complete and reviewed.
- [ ] Every added migration follows [migration-safety.md](migration-safety.md)
      (additive, quarantine over `DELETE`, `NOT VALID` → `VALIDATE`).
- [ ] A verified pre-migrate backup exists or will be taken by the gated chain
      (`OPENVALENS_PRE_MIGRATE_BACKUP=pg_dump`, never `none`) and is copied off
      the host before the window closes.
- [ ] The rollback for this migration set is a restore of that backup and the
      approver accepts losing writes made between upgrade and rollback.
- [ ] Approved by: **\_\_\_\_** on **\_\_\_\_** (separately from A).

Stop if either approval is missing, if the approved digests differ from what
`release-manifest.ts verify` reports, or if anything in the plan changed after
approval.

## 2. Build and pin release artifacts

Run from a clean checkout of the release commit on the build host (for the
self-host install, that is the server itself, because images are built
locally; publishing registry images is not part of this release):

```bash
git checkout <release commit or tag>
bun scripts/release-manifest.ts create \
  --server-url https://<public API origin> \
  --previous-manifest /path/to/previous/release-manifest.json \
  --output /path/to/release-manifest.json
```

- `--server-url` is compiled into the web bundle as `VITE_SERVER_URL`. For the
  self-host install it is `https://<domain>` (one origin).
- `--version` overrides the image tag; the default is `git describe`, the same
  value `deploy/setup.sh` writes to `OPENVALENS_VERSION`.
- `--dry-run` prints the Docker commands and a manifest with null digests and
  changes nothing. `--no-build` only inspects images that already exist (for
  example ones `deploy/setup.sh` built) and refuses images whose revision label
  is a different commit.
- A dirty working tree is refused unless `--allow-dirty`, and the manifest then
  records `dirty: true`; never approve a dirty manifest.

The manifest (`openvalens.release-manifest/v1`) records:

- `images[].imageId` — the content digest of each app image. This is what is
  approved and what `verify` checks. `repoDigests` stays empty until images are
  pushed to a registry (not part of this release).
- `git.commit`, `version`, `serverUrl`.
- `thirdPartyImages` — Caddy and Postgres references from `deploy/compose.yml`,
  all pinned by digest.
- `baseImages` — the Dockerfile base images. `oven/bun`, `node` and `nginx` are
  referenced by tag, not digest; the manifest records the digest Docker
  resolved for this build (`resolvedDigest`) so the build is traceable.
  Pinning the Dockerfiles by digest is a follow-up.
- `migrations.names`, `count` and, with `--previous-manifest`, `added` (feeds
  the migration plan) and `missing` (must be empty; it fails otherwise because
  migrations are append-only).

Immediately before starting the release on the host:

```bash
bun scripts/release-manifest.ts verify --manifest /path/to/release-manifest.json
```

Every line must be `PASS`. Keep the previous release's images and manifest
until the next release is accepted; do not `docker image prune` them.

## 3. Migration plan template

Copy into the release issue and fill in every field. "None" is a valid answer;
blank is not.

```markdown
### Migration plan — <version>

- Release manifest: <link/attachment>; previous: <version>
- Migrations added (from manifest `migrations.added`):
  - <folder name> — <one-line purpose>
- Per migration:
  - Tables touched / tenant scope: <tables; organization_id handling>
  - Additive only? <yes | no — explain>
  - Destructive statements (DELETE, DROP, UPDATE … = NULL): <none | list + quarantine plan>
  - Constraints added NOT VALID then VALIDATE: <n/a | which>
  - Locks / expected duration on current data volume: <estimate + how measured>
  - Preflight checks (orphans, duplicates, counts): <SQL or n/a>
  - Reconciliation (row counts before/after): <what is recorded>
- Backup: mode <pg_dump | hook>; off-host copy to <where>; verified with `pg_restore --list`: <yes>
- Compatibility: does the previous release still run on the new schema? <yes | no>
  (if no, rollback REQUIRES a restore, section 6)
- Rollback: <image-only | restore pre-migrate dump>; accepted write-loss window: <…>
- Rehearsal: local transcript <link>, passed on <date>
- Migration approval: <name, date> (section 1B)
```

## 4. Deploy (after both approvals)

Self-host Compose install:

```bash
git fetch --tags && git checkout <approved commit>
bun scripts/release-manifest.ts verify --manifest /path/to/release-manifest.json
deploy/setup.sh upgrade        # stop app -> pre-migrate backup -> migrate -> start
```

`deploy/setup.sh upgrade` rebuilds the images; with a warm cache the digests
normally match, but re-run `verify` after it and stop if a digest changed. A
failed backup or migration leaves the server stopped
([Upgrading](self-hosting/upgrading.md)).

Platform deployment (Coolify/Dokploy): set the image to the approved digest or
commit-SHA tag, run `bun run db:migrate` as a one-off only after migration
approval, then start the service ([deployment.md](deployment.md)).

Then verify (section 5) and record the result in the release record.

## 5. Readiness verification

```bash
# self-host: web and API share one origin
bun scripts/verify-readiness.ts --base-url https://<domain> \
  --expect email=configured:resend,ai=off,messaging=off

# platform: separate origins
bun scripts/verify-readiness.ts --web-url https://<web> --api-url https://<api>
```

| Check                     | Request                                          | Pass                      |
| ------------------------- | ------------------------------------------------ | ------------------------- |
| `web`                     | `GET <web>/`                                     | 200 `text/html`           |
| `api-readiness`           | `POST <api>/api-reference/health/readiness`      | `status: "ok"`            |
| `rpc-anonymous-readiness` | `POST <api>/rpc/health/readiness`                | 200, `status: "ok"`       |
| `rpc-anonymous-admission` | `POST <api>/rpc/admission/status` (public)       | 200 with `setupAvailable` |
| `rpc-protected-anonymous` | `POST <api>/rpc/adminSettings/access`, no cookie | 401                       |
| `rpc-protected-session`   | same, with `--session-cookie-file`               | 200                       |
| `integrations`            | `checks.integrations` vs `--expect`              | every entry matches       |

`--expect` takes `family=state[:provider]` entries (`configured`, `dry-run`,
`off`); list the exact enabled scope approved for the environment. The
protected-session check needs a signed-in browser session: copy the `Cookie`
request header value from the browser's developer tools into a private file
(`chmod 600`), pass `--session-cookie-file`, then delete the file and sign out.
Never paste the cookie into chat or a ticket. Output is value-free and safe to
attach; `--json` gives a machine-readable record. `--insecure` (skip TLS
verification) and plain `http` are accepted only for loopback hosts.

## 6. Rollback

Decide which path applies **before** the deploy, in the migration plan:

- **Image-only rollback** — no migration was applied, or the previous release
  runs on the new schema. Start the previous images; no data is lost.
- **Restore rollback** — a migration was applied that the previous release
  cannot run on. Restore the pre-migrate dump into a fresh database. Writes
  made after the upgrade are lost (keep the upgraded database for forensics and
  manual reconciliation).

### Self-host: restore rollback

Every command needs the rollback decision recorded in the release issue. The
`rename` keeps the upgraded database instead of dropping it.

```bash
C="docker compose -f deploy/compose.yml"
$C stop caddy web server
$C run --rm --no-deps --entrypoint ls backup -l /backups        # pick pre-migrate-<stamp>.dump
STAMP=$(date -u +%Y%m%d%H%M%S)
$C exec -T postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'openvalens' and pid <> pg_backend_pid()" \
  -c "alter database openvalens rename to openvalens_failed_$STAMP" \
  -c "create database openvalens"
$C run --rm --no-deps -T --entrypoint sh backup -c \
  'PGPASSWORD="$(cat "$POSTGRES_PASSWORD_FILE")" pg_restore --exit-on-error --no-password -d openvalens "$1"' \
  restore /backups/pre-migrate-<stamp>.dump
git checkout <previous approved commit>
# set OPENVALENS_VERSION in deploy/.env to the previous version, then:
bun scripts/release-manifest.ts verify --manifest /path/to/previous/release-manifest.json
$C up -d                                                         # backup -> migrate (no-op) -> start
bun scripts/verify-readiness.ts --base-url https://<domain> --expect <same as before>
```

This is the rollback-specific form of the
[interim manual restore](self-hosting/backup.md#interim-manual-restore): it
renames the upgraded database instead of dropping it, and starts the retained
previous images instead of rebuilding. The same caveats apply: everything
written after the dump is lost, and data deleted through "Delete everything"
after the dump **comes back** until the deletion is repeated (erasure-ledger
replay is Issue #64). Record both in the release issue.

Use `$C up -d`, not `deploy/setup.sh upgrade`, so the retained previous images
start without a rebuild. **Image-only rollback** is the same without the
`psql` and `pg_restore` steps. Drop `openvalens_failed_<stamp>` only after the
incident is closed and its data is reconciled.

### Platform rollback

See [deployment.md §11](deployment.md#11-rollback-runbook): point the service
at the previous approved image, and for a restore rollback restore the
pre-migration dump to a side database and switch `DATABASE_URL`.

## 7. Rollback rehearsal (local, disposable)

Run before asking for approval, for the exact pair of versions:

```bash
scripts/rollback-rehearsal.sh --from <previous approved ref> --to <candidate ref> \
  --transcript /path/to/rehearsal-transcript.log
```

The script builds both versions locally (`git archive` + `docker build`),
stages a throwaway copy of `deploy/compose.yml` with generated secrets under a
unique compose project on `https://localhost:18443` (loopback only, Caddy
internal CA, `EMAIL_DRY_RUN=true`, no provider keys), and then:

1. installs `--from` on an empty database, runs `verify-readiness.ts`, records
   the migration count and writes a synthetic marker row;
2. upgrades to `--to` through the real gated chain (stop → pre-migrate
   `pg_dump` → migrate → start), verifies, writes a second marker;
3. rolls back with the section 6 restore procedure (rename, restore, start the
   previous image) and verifies again;
4. passes only if the rolled-back server runs the `--from` image digest, the
   migration journal matches the `--from` count, and only the pre-upgrade
   marker is present; then removes every rehearsal container, volume and temp
   file.

It refuses a remote `DOCKER_HOST` and never prints a secret. `--keep` leaves
the stack up for inspection; `--keep-images` with `--skip-build` speeds up a
re-run. The transcript is the evidence; attach it to the release record and
label it **local rehearsal**.

### Release record template

```markdown
### Release record — <version> → <environment>

- Manifest: <attachment>; `verify`: PASS at <time UTC>
- Deployment approval: <name, date>; migration approval: <name, date | no migrations>
- Local rollback rehearsal: <transcript>, PASS on <date>, from <ref> to <ref>
- Pre-migrate backup: <file name>, size <bytes>, copied off-host to <where>
- Deploy started/finished: <UTC>; operator: <name>
- verify-readiness output: <attachment (value-free)>
- Rollback triggered? <no | yes: path, reason, UTC times>
- No secrets, tokens, cookies or health data in this record: <checked by>
```
