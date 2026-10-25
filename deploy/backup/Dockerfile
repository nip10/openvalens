# OpenValens backup image (Issue #64): the pinned Postgres image (the same one
# the stack runs, so pg_dump/pg_restore always match the server major version)
# plus `age` for encryption and `jq` for the backup manifest, both from the
# signed Debian archive. The backup logic itself is deploy/backup/
# openvalens-backup.sh, mounted read-only by deploy/compose.yml.
#
# Built by `deploy/setup.sh install|upgrade`; the build context is this
# directory only, so nothing from deploy/secrets can reach a layer.
FROM postgres:18.6@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336

# age 1.2.x (Debian trixie). The build fails if the archive ever ships another
# major/minor, so a format change is a deliberate bump, not a surprise.
RUN apt-get update \
  && apt-get install -y --no-install-recommends age jq \
  && rm -rf /var/lib/apt/lists/* \
  && age --version | grep -Eq '^v?1\.2\.' \
  && command -v age-keygen flock sha256sum tar >/dev/null

LABEL org.opencontainers.image.title="openvalens-backup" \
  org.opencontainers.image.description="pg_dump/pg_restore + age for OpenValens self-host backups"
