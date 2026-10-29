# Complete data exports

Signed-in users can request a complete export from data-rights settings. Requests are self-service and remain available in Cloud read-only mode. A user can have one active export and request at most three jobs in a rolling 24-hour period. Completed ZIP archives are available for 24 hours and are then expired and removed.

The server builds archives asynchronously from the recorded subject scope. It streams the JSON files produced by the data-rights writer, includes verified stored attachments where available, and publishes only after the archive is complete. Any missing or corrupt attachment fails the job rather than publishing a partial archive. Downloads require the original, live, non-impersonated account session; there are no public or bearer URLs.

`DATA_EXPORT_DIR` selects the private local filesystem directory used for staging and completed archives. Production compose mounts a dedicated volume at `/var/lib/openvalens/exports`. Keep this volume private and writable only by the server. Export files contain personal data and are intentionally excluded from backups; job metadata is stored in Postgres. A deployment with multiple server replicas must mount the same private filesystem on every replica. Do not expose this directory through a web server or object-store public bucket.

Each job is limited to 15 minutes of build time, 10,000 attachments, 256 MiB of metadata, 1 GiB of staged content, and 1.1 GB of final ZIP output. The server reserves 3 GiB of free disk space before building. Interrupted or stale jobs are marked failed and can be requested again within the rate limit.
