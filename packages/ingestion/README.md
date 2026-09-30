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
  reclaimed. The source's `raw_artifact_replay` and `sync_session_finalize`
  runners are **not ported yet**, so production registers none: queued jobs
  are left untouched and each tick only purges. The source would claim such a
  job and fail it.
- **No PHI in errors.** `ingestion_error.message` stores the error class name,
  not `error.message`.
- **Parameterized SQL** instead of interpolated timestamps in `sql.raw`.
- **Chunk purge** also requires each chunk's own `retention_until <= now`; the
  source purged every unpurged chunk of a qualifying session.
- Authentication lives in `cronProcedure`, not in the orchestrator.

## Tests

`bun test packages/ingestion` runs unit tests. The DB suite needs an empty
disposable database: `INGESTION_TEST_DATABASE_URL=postgres://…@127.0.0.1:<port>/ingestion_cron`.

Deferred: replay and finalize runners, provider adapters, canonical-record
persistence from sync sessions (mobile, Phase 4).
