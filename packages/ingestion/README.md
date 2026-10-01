# @openhealth/ingestion

Ingestion job orchestration, ported from anchovy `apps/web/src/lib/v2/ingestion`
(`run-cron-orchestrator.ts`, `claim-jobs.ts`, `job-state.ts`, `job-runner-state.ts`,
`run-job.ts`, `raw-payload-purge.ts`, `raw-payload-retention.ts`).

`cron.ingestionRun` (oRPC, `Authorization: Bearer ${CRON_SECRET}`, scheduled
`15 9 * * *`) runs one tick:

1. Reclaim at most one `running` job not updated for 15 minutes, else claim the
   oldest `queued` job (`FOR UPDATE SKIP LOCKED`).
2. Run it through the registered runner for its `job_type`.
3. If the runner throws, mark the job and its processing batch `failed` and
   record an `ingestion_error`. With no processing batch the job stays
   `running` for the stale reclaim (source parity).
4. Always run the raw-payload purge; a purge failure is logged, not fatal.

## Replay (`raw_artifact_replay`)

`ingestion.requestReplay({ rawArtifactId })` (oRPC, `records:write`, org and
user from the session) queues one replay job per artifact (idempotency key
`raw-artifact-replay:<org>:<artifactId>`) plus a `raw_artifact_replay_metadata`
artifact. The cron runner then, in one transaction: locks the job, creates its
processing batch, reads the metadata and the source artifact, parses the
Health Connect envelope, and persists `weight` / `steps` / `heart_rate`
samples and `sleep_session` / `workout` events. Batch counts record
total/accepted/rejected. A missing or purged source fails the job with
`replay_source_unreadable`; missing metadata with `replay_metadata_unreadable`.

Source bugs fixed (both made anchovy replay a permanent no-op):

- The runner required a processing batch nothing created, so the job was never
  found, never failed, and was re-claimed as stale every 15 minutes.
- The request stored `raw_artifact_replay_metadata` but the runner queried
  `replay_metadata`.

Other replay deviations:

- Metric definitions are resolved or registered **per organization**. The
  source passed hardcoded ids `{ weight: 1, steps: 2, heart_rate: 3 }`.
- Inserts skip `(organization_id, dedupe_hash)` conflicts and count them as
  duplicates, so re-persisting is idempotent (the source would throw).
- Error diagnostics store the replay metadata or `{ sourceRawArtifactId }`,
  never the source health payload; messages are fixed strings.
- A failed replay cannot be re-requested for the same artifact (the
  idempotency key returns the existing job), as in the source.

## Mobile ingest (`mobile_ingest_batch`)

`mobile.registerDevice` / `mobile.ingestBatch` / `mobile.syncStatus` (oRPC,
contract in `@openhealth/api/contracts/mobile-ingest`) implement the design in
`docs/architecture/mobile-sync-decision.md`. The device reads Health Connect /
HealthKit change cursors and sends one record type per batch; it advances a
cursor once the server answers `applied`, `queued` or `duplicate`.

- **Device:** a `provider_connection` keyed on `(org, provider, deviceId)`.
  A missing connection or a non-active one (`revoked`, `disconnected`) gets
  `PERMISSION_DENIED`; re-registering never reactivates a revoked device.
- **Accept** (transaction 1): `ingestion_job` with idempotency key
  `mobile-ingest:<recordType>:<sha256 of org, device, provider, type, records>`
  plus an `ingestion_raw_artifact` (`mobile_health_batch`, 30-day retention).
  The same content again returns `duplicate`.
- **Apply** (transaction 2, inline): one `data_source` per source app and
  device, canonical rows via `persistCanonicalIntents` with the `mobile` dedupe
  key (provider, type, external id, `lastModifiedAt`, time, value), and one
  `provenance_link` (`derived_from_raw_artifact`) per inserted row. If apply
  throws, the response is `queued` and the `mobile_ingest_batch` cron runner
  retries it. A purged or unreadable artifact fails the job with
  `mobile_batch_unreadable`.
- **Supersession (#44):** canonical rows are never deleted. A deletion from
  the device, or a newer version of a record (later `lastModifiedAt`), sets
  `superseded_at` on that record's rows from the same device connection and
  adds a `superseded_by_raw_artifact` provenance link to the batch. A late,
  older version is stored already superseded. The timeline, sleep and
  clinical export reads skip superseded rows.
- Heart-rate records fan out to one sample per reading.
- **Body bridge:** each newly stored phone weight also goes through the body
  domain's auto-weight reconciliation (`weight_event` + `daily_weight`) for
  the device owner (`provider_connection.user_id`, set by `registerDevice`),
  dated in the batch's `clientTimezone`. Superseding a weight supersedes its
  `weight_event` and recomputes the day. Devices with no owner skip it.

## Raw-payload purge

Redacts `payload_json` to `{}` and sets `purged_at` on rows whose
`retention_until <= now`. Rows, hashes and canonical records are kept.
Bounded to 25 raw artifacts and 25 chunk sessions per run. Mobile sync chunks
are only purged once a `sync_session_finalize` job with idempotency key
`mobile-sync-finalize:<sessionId>` has succeeded, so an unprocessed upload is
never erased. This is the only retention the source applies; clinical
`metric_sample` history is never expired here.

## Deviations from the source

- **Runner registry.** Only job types with a registered runner are claimed or
  reclaimed. Production registers `raw_artifact_replay` and
  `mobile_ingest_batch`. The legacy mobile `sync_session_finalize` runner is
  superseded by the mobile ingest design (#40) and never registered, so those
  jobs stay queued instead of being claimed and failed.
- **No PHI in errors.** `ingestion_error.message` stores the error class name,
  not `error.message`.
- **Parameterized SQL** instead of interpolated timestamps in `sql.raw`.
- **Chunk purge** also requires each chunk's own `retention_until <= now`; the
  source purged every unpurged chunk of a qualifying session.
- Authentication lives in `cronProcedure`, not in the orchestrator.

## Tests

`bun test packages/ingestion` runs unit tests. The DB suite needs an empty
disposable database: `INGESTION_TEST_DATABASE_URL=postgres://…@127.0.0.1:<port>/ingestion_cron`.

`mobile-batch.integration.test.ts` needs its own empty database:
`MOBILE_INGEST_TEST_DATABASE_URL=postgres://…@127.0.0.1:<port>/mobile_ingest_issue7`.
`scripts/test-integration.sh` creates both.

Deferred: provenance links for the legacy replay path.
