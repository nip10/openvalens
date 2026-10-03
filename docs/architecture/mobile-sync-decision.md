# Mobile sync architecture decision

- **Status:** Accepted for ingestion, read cache and manual entry. The auth
  section is **pending an auth spike** (see below).
- **Spike:** issue #40 (M5.37)
- **Date:** 2026-10-01
- **Supersedes:** the "byte-compatible port" framing of #7 and #27. Rule 7
  ("No Better Auth sessions for mobile") in `docs/migration-plan.md` stays in
  force until the auth spike passes.

## Recommendation

Do **not** port the Kotlin sync engine and do **not** adopt a sync engine
(PowerSync, Electric, Zero, TanStack DB). Split the problem in two. Wearable
data moves from the device to the server through **one idempotent oRPC
procedure, `mobile.ingestBatch`**. It is driven by the platforms' own change
cursors: Health Connect changes tokens and HealthKit anchors. Each call stores
an `ingestion_raw_artifact`, then writes canonical rows through the existing
`persistCanonicalRecords` path. The device stores only cursors, and advances a
cursor only after the server acknowledges the batch. Health Connect or HealthKit
is the durable outbox, so the app needs no sessions, leases, chunk planner or
checkpoint store. The mobile app reads and writes the health record through the
same oRPC procedures the web app uses. It uses TanStack Query with a persisted,
allowlisted cache, and keeps manual-entry mutations offline with client-generated
ids. Authentication is the Better Auth Expo session that is already wired up, so
the custom three-token device-session contract is dropped.

**Three reasons:**

1. **No sync engine solves the hard part.** Every evaluated engine either does
   reads only (Electric) or sends client writes back through _your own_ API
   (PowerSync `uploadData`, Zero mutators). Concern (a), append-only ingestion
   with raw provenance, always ends up as "POST a batch to our server". The only
   design choice is the shape of that POST. The platform change cursors already
   provide resumability, so the Kotlin engine's sessions, leases and chunk
   checkpoints are duplicate machinery.
2. **It reuses what is already correct on the server.** `tenantScopedProcedure`
   (session to org, RBAC, tenant boundary, audit), `ingestion_raw_artifact`
   (hash, retention, purge), `ingestion_job` idempotency keys, `provenance_link`,
   `data_source` / `provider_connection` and `persistCanonicalRecords` (dedupe by
   `(organization_id, dedupe_hash)`) all exist and are tested. A sync engine adds
   a second authorization model (sync rules or permissions) that must mirror
   tenant scoping outside the oRPC guards. That is the class of drift this repo
   works hardest to prevent.
3. **It has the lowest operating cost for one developer on Coolify/Hetzner.**
   The design needs no new service, no `wal_level=logical`, no replication slot
   that can fill the disk when a consumer dies, no Mongo or bucket store, and no
   FSL- or SaaS-licensed component touching PHI. The new surface is about 3 oRPC
   procedures plus about 600 lines of client code, compared with porting 11
   Kotlin classes, 10 test classes and 10 endpoints.

## Context

OpenValens is a private, single-user, PHI-aware health record: a Bun + Turborepo
monorepo with a Hono + oRPC server, a TanStack Router web app, an Expo 57 /
RN 0.86 native app, and Drizzle/Postgres, self-hosted on Coolify/Hetzner.

The current plan has several parts. #27 calls for a byte-compatible TypeScript
port of the anchovy Kotlin companion's sync engine: chunked upload, 10-minute
run lease, sha256 chunk checkpoints, and 14-day backfill slices over a 6-month
horizon. That port would run against the custom 3-token device-session auth and
pairing contract from #7. #29 is the client side of #7. #28 covers background
execution. The user called the old companion an MVP and asked for a rethink.

### What exists today (verified in the code)

| Area                        | State                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile auth                 | `apps/native/lib/auth-client.ts` already uses `@better-auth/expo` `expoClient` with `expo-secure-store`. `apps/native/utils/orpc.ts` forwards the session cookie on every oRPC call. The server registers the `expo()` plugin and trusts `openvalens://`. The only thing left is a `TODO(#7 / #29)` to switch to the custom contract.                                   |
| Tenant scoping              | `packages/api/src/index.ts` provides `tenantScopedProcedure`: session, then `requirePermission` (Better Auth org plus RBAC), then `assertTenantBoundary`, then `writeAuditLog`. The org always comes from `session.activeOrganizationId`.                                                                                                                               |
| Raw provenance              | `ingestion_raw_artifact` has `payload_json`, `payload_hash`, `size_bytes`, `retention_until`, `purged_at` and `retention_class`, plus FKs to job, batch and provider connection. `runRawPayloadPurge` redacts expired payloads to `{}` and keeps the hashes. `provenance_link` has a `derived_from_raw_artifact` helper (`createRawArtifactToCanonicalProvenanceLink`). |
| Canonical write             | `packages/ingestion/src/persist-canonical-records.ts` writes `metric_sample` / `health_event` with `ON CONFLICT (organization_id, dedupe_hash) DO NOTHING` and counts duplicates. The adapter (`health-connect.ts`) handles `weight`, `steps`, `heart_rate`, `sleep_session` and `workout` only.                                                                        |
| Jobs                        | `ingestion_job` has a unique `(organization_id, idempotency_key)`. The cron orchestrator claims jobs with `FOR UPDATE SKIP LOCKED` and runs once a day (`15 9 * * *`). Only `raw_artifact_replay` has a registered runner. `sync_session_finalize` was never ported.                                                                                                    |
| Legacy tables               | `mobile_device_session`, `mobile_pairing_code`, `mobile_pairing_rate_limit`, `mobile_sync_session(_chunk)`, `health_connect_sync` and `health_connect_record` exist in the schema (ported migrations), but **no code path writes them**. Only the purge reads the chunk tables.                                                                                         |
| Native scaffold (`1566da8`) | `apps/native/lib/health-connect/` reads 8 record types with `readRecords` over a fixed 6 h window, posts placeholder REST calls to `/api/v2/mobile/sync-sessions/*` (which don't exist), hashes with djb2 and schedules through the deprecated `expo-background-fetch`.                                                                                                 |

### Wire-format bugs in the scaffold (must be fixed regardless of the decision)

Even if the server existed, the current client payload would ingest almost
nothing:

- The client sends **buckets** (`records.weight[]`), but the server parser
  (`parseMobileIngestionEnvelope`) expects a flat `records[]` where each record
  carries `type`.
- Weight uses `time`. The adapter requires `startTime`, so **every weight
  reading is rejected**.
- Heart rate sends `samples[].beatsPerMinute`. The adapter reads `samples[0].bpm`,
  and it reads **only the first sample**.
- Sleep stages are numeric Health Connect codes. The adapter requires non-empty
  string stages.
- `bodyFat`, `activeCalories` and `distance` have no adapter branch, so they are
  silently counted as rejected.
- `metric_sample.dedupe_hash` includes the full `rawRecord`. Any change to the
  client serialization (a new field) therefore defeats dedupe and creates
  duplicates.
- The client requests **write** permission for Weight/ExerciseSession. If the app
  ever writes to Health Connect, its own records come back on the next read
  unless they are filtered by `dataOrigin`. Android's sync guide says to skip
  changes that originate from the calling app ([Android: sync data][hc-sync]).

The root cause is that no shared Zod contract exists between the device and the
server. The decision below makes `packages/api` the single source of the wire
schema.

## The two concerns

| Concern                                             | Direction                                  | Properties required                                                                                                                                          | Conflict model                                                                  |
| --------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **(a) Wearable ingestion**                          | device to server, append-only              | Idempotent; raw payload kept with hash, retention and provenance; tenant from auth; resumable across process death; works in OS-throttled background windows | None. The platform store is the source; the server dedupes.                     |
| **(b) Health-record cache and manual-entry writes** | server to device, plus small device writes | Fast cold start; readable offline for recently viewed screens; manual entries survive offline; PHI-minimized on disk                                         | Single user; web and mobile rarely edit the same row. Inserts carry client ids. |

These have different solutions. (a) is a **queue drain against an external
change feed**, and it does not need a replicated local database. (b) is a
**read cache with an offline mutation queue**. Full bidirectional replication
would only pay off with many concurrent editors or large offline query surfaces,
and this product has neither.

## Options evaluated

Scores run 1 (poor) to 5 (best). "(a)" and "(b)" mark which concern an option
addresses.

| Option                                                                                                                                                                                          | What it gives                                                                                                                                                             | Self-host / PHI                                                                                                   | Postgres impact                                                                                                                    | Expo 57 / RN fit                                                                                                                                                                               | Ops cost (1 dev)                                                          | Correctness for (a)                                                                        | Fit for (b)                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **Port as planned** (#7, #27)                                                                                                                                                                   | Chunked upload, 10-min lease, chunk checkpoints, 3-token auth, 10 endpoints                                                                                               | Self-hosted                                                                                                       | None (tables exist)                                                                                                                | Plain TS                                                                                                                                                                                       | 2: largest custom surface, second auth system                             | 3: correct, but duplicates what change tokens already give                                 | Not addressed                                                                                     |
| **PowerSync** ([setup][ps-setup], [license][ps-license], [self-host][ps-selfhost])                                                                                                              | SQLite on the device kept in sync from Postgres via sync rules; client writes queue locally and go up through `uploadData()` "to your application backend"                | Open Edition is self-hostable via Docker. The service is FSL (source-available, non-compete); SDKs are Apache/MIT | `wal_level = logical`, a replication role, a publication that must be named `powersync`, plus bucket storage (Postgres or MongoDB) | `@powersync/react-native` (2.3.1) on `op-sqlite`; needs a dev build (we already need one)                                                                                                      | 2: extra service, replication slot, sync rules duplicating tenant scoping | Same as ours: writes still hit our API                                                     | 4: strong offline reads, but the read model moves out of `packages/health-record` into sync rules |
| **Electric** ([install][el-install], [writes][el-writes], [Expo][el-expo])                                                                                                                      | Read-path "shapes" streamed from Postgres. "Electric does not do write-path sync."                                                                                        | Self-hostable via Docker (Elixir)                                                                                 | Logical replication plus a `REPLICATION` role                                                                                      | Expo integration documented as the TS client with `useShape`, paused on background. No on-device persistence documented                                                                        | 2                                                                         | Not addressed (reads only)                                                                 | 2: no on-device persistence on RN without extra work; shapes bypass our read models               |
| **Zero** (Rocicorp) ([status][zero-status], [offline][zero-offline], [RN][zero-rn])                                                                                                             | GA since March 2026 (`@rocicorp/zero` 1.9.0). ZQL queries synced into a local store; mutators for writes                                                                  | `zero-cache` is self-hostable                                                                                     | Logical replication                                                                                                                | Supported with an `expo-sqlite` or `op-sqlite` kv store                                                                                                                                        | 2                                                                         | Not addressed. "Zero does not support offline writes" (writes rejected while disconnected) | 2: offline writes rejected, which is the case manual entry needs                                  |
| **TanStack DB** ([overview][tsdb])                                                                                                                                                              | Collections, live queries and optimistic mutations over TanStack Query, Electric or PowerSync; offline transactions; SQLite persistence                                   | Library only                                                                                                      | None (QueryCollection)                                                                                                             | RN works (needs a UUID polyfill)                                                                                                                                                               | 4                                                                         | Not addressed                                                                              | 3: good model, but `@tanstack/db` is **0.11.0** (pre-1.0) as of 2026-10-01                        |
| **Chosen: idempotent batch upload over oRPC + TanStack Query persistence + local SQLite cursors** ([persistQueryClient][tq-persist], [expo-sqlite][expo-sqlite], [HC getChanges][rnhc-changes]) | (a): `mobile.ingestBatch` driven by HC changes tokens and HK anchors. (b): the existing oRPC queries, a persisted allowlisted cache, and paused mutations with client ids | Self-hosted; nothing new                                                                                          | None (reuses `ingestion_raw_artifact`, `ingestion_job`, `metric_sample`, `health_event`, `provenance_link`)                        | Uses deps already in `apps/native` (`@orpc/tanstack-query`, `@tanstack/react-query`, `expo-secure-store`) plus `expo-sqlite`, `expo-background-task` and the TanStack Query persister packages | **5**                                                                     | **5**: idempotent by content hash; cursor advances only after ack                          | 4: covers recently viewed screens and offline manual entry; no ad-hoc offline queries             |

RxDB and Convex (listed in #40) were not evaluated in depth. RxDB is not
Postgres-native and needs custom replication glue. Convex is a hosted backend
that would replace Postgres as the store of record. Both fail the
"Postgres is canonical, self-hosted" constraint before any other criterion
applies.

### Background execution constrains every option equally

- `expo-background-task` uses WorkManager on Android with a **minimum interval of
  15 minutes**. On iOS, BGTaskScheduler "decides the best time to launch your
  background task", and "the system can interrupt the process at any time". Tasks
  stop when the user kills the app ([Expo BackgroundTask][expo-bgtask]).
  `expo-background-fetch` is deprecated in favor of `expo-background-task`
  ([Expo blog][expo-bgfetch-blog]).
- Health Connect only allows background reads with
  `READ_HEALTH_DATA_IN_BACKGROUND`. Without `READ_HEALTH_DATA_HISTORY`, reads
  older than 30 days before the first grant fail ([Android: read data][hc-read]).
  Changes tokens expire after 30 days unused. The recommended recovery is "re-read
  all data from the most recent timestamp or for the last 30 days. Then, dedupe
  it … using identifiers" ([Android: sync data][hc-sync]).
- HealthKit background delivery wakes the app for new samples once observer
  queries are registered at launch ([Apple][hk-bg]).
  `@kingstinct/react-native-healthkit` v16 exposes
  `queryQuantitySamplesWithAnchor` (returning `newAnchor`, `samples` and
  `deletedSamples`) and `subscribeToChanges`, and requires
  `react-native-nitro-modules` ([kingstinct][hk-lib]).

The consequence is that **any run can be killed at any point**. A sync engine
does not change that. The design must make every step idempotent and keep the
resume state as small as possible. Platform cursors that only advance after a
server ack meet that requirement without a lease or a chunk checkpoint.

Replication-based engines carry one more cost: logical replication slots "will
prevent removal of required resources even when there is no connection using
them … In extreme cases this could cause the database to shut down"
([PostgreSQL][pg-slots]). That is a real risk on a single self-hosted Postgres
with no DBA.

## Decision

### (a) Ingestion: `mobile.ingestBatch`

**Device algorithm.** It runs in the foreground on app open and pull-to-refresh,
and in `expo-background-task`. Each record type is processed independently
because Android recommends separate tokens per data type
([Android: sync data][hc-sync]).

```text
for recordType in enabledTypes:
  cursor = sqlite.get(recordType)            # HC changesToken | HK anchor | null
  if cursor is null or expired:
    page = readRecords(recordType, from = max(lastAckedAt - 1d, now - 30d)) # backfill
  else:
    page = getChanges(cursor)                # upserts + deletions + nextToken
  for batch in split(page, maxRecords = 1000, maxBytes ≈ 1 MB):
    res = orpc.mobile.ingestBatch(batch)     # idempotent; retry with backoff on network error
    if res is error: stop this type; cursor unchanged
  sqlite.set(recordType, page.nextCursor, lastAckedAt = now)   # only after every batch is acked
  if page.hasMore and time budget left: continue
```

- **Idempotency is by content, not by session.** The server derives the job
  idempotency key from
  `sha256(orgId | deviceId | provider | recordType | stableSerialize(upserts, deletions))`.
  A retry after a crash re-reads the same changes from the unadvanced cursor,
  produces the same bytes, and returns `duplicate`. Partially overlapping
  retries are deduped per record by the canonical dedupe key (below).
- **No device outbox for wearable data.** Health Connect and HealthKit are the
  durable outbox. The device persists only `{recordType → cursor, lastAckedAt}`
  plus a `deviceId`.
- **Deletions are captured from day one.** HC `deletionChanges` and HK
  `deletedSamples` go in the batch and are stored in the raw artifact, so
  provenance is complete. Applying them to canonical rows is a follow-up (see
  Consequences).
- **Own writes are filtered.** Records whose `dataOrigin` is the OpenValens
  package are dropped on the device.
- **Bounded work per run.** Cap each background run (for example 20 s or
  10 batches). The cursor makes the next run continue where this one stopped.
  This replaces the 14-day slice / 6-month horizon planner. Initial backfill
  pages through `readRecords` by time window using the same ack-then-advance
  rule, keyed on `lastAckedAt`.

**Server procedure.** `packages/api/src/routers/mobile.ts` is mounted as
`appRouter.mobile`. Domain logic lives in `packages/ingestion/src/mobile-batch.ts`
and the route stays thin.

```ts
// packages/api/src/contracts/mobile-ingest.ts — shared by server and apps/native
const isoUtc = z.iso.datetime({ offset: false }); // must satisfy isCanonicalUtcTimestamp
const base = {
  externalRecordId: z.string().min(1).max(200), // HC metadata.id | HK UUID
  lastModifiedAt: isoUtc.optional(), // HC metadata.lastModifiedTime
  sourceApp: z.string().max(200).nullable(), // HC dataOrigin | HK sourceRevision.bundleId
  sourceDevice: z
    .strictObject({ type: z.string().max(50).optional(), model: z.string().max(100).optional() })
    .optional(),
};

export const mobileHealthRecord = z.discriminatedUnion("type", [
  z.strictObject({
    ...base,
    type: z.literal("weight"),
    startTime: isoUtc,
    valueKg: z.number().positive(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("body_fat"),
    startTime: isoUtc,
    percent: z.number().min(0).max(100),
  }),
  z.strictObject({
    ...base,
    type: z.literal("steps"),
    startTime: isoUtc,
    endTime: isoUtc,
    count: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("heart_rate"),
    startTime: isoUtc,
    endTime: isoUtc,
    samples: z.array(z.strictObject({ time: isoUtc, bpm: z.number().positive() })).max(5000),
  }),
  z.strictObject({
    ...base,
    type: z.literal("active_calories"),
    startTime: isoUtc,
    endTime: isoUtc,
    kcal: z.number().nonnegative(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("distance"),
    startTime: isoUtc,
    endTime: isoUtc,
    meters: z.number().nonnegative(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("sleep_session"),
    startTime: isoUtc,
    endTime: isoUtc,
    stages: z
      .array(
        z.strictObject({
          stage: z.enum(["awake", "light", "deep", "rem", "asleep", "out_of_bed", "unknown"]),
          startTime: isoUtc,
          endTime: isoUtc,
        }),
      )
      .max(500)
      .optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("workout"),
    startTime: isoUtc,
    endTime: isoUtc,
    activity: z.string().max(64), // mapped from HC ExerciseType / HKWorkoutActivityType on device
    title: z.string().max(200).nullable(),
  }),
]);

export const ingestBatchInput = z.strictObject({
  schemaVersion: z.literal(1),
  deviceId: z.uuid(), // from mobile.registerDevice; never an org/user id
  provider: z.enum(["health_connect", "apple_health"]),
  recordType: z.enum([
    "weight",
    "body_fat",
    "steps",
    "heart_rate",
    "active_calories",
    "distance",
    "sleep_session",
    "workout",
  ]),
  mode: z.enum(["changes", "backfill"]),
  window: z.strictObject({ from: isoUtc, to: isoUtc }).optional(), // backfill only
  upserts: z.array(mobileHealthRecord).max(1000),
  deletions: z.array(z.strictObject({ externalRecordId: z.string().min(1).max(200) })).max(1000),
  clientTimezone: z.string().max(64),
}); // no organizationId/userId: strict schema rejects tenant overrides

export const ingestBatchOutput = z.object({
  status: z.enum(["applied", "queued", "duplicate"]),
  rawArtifactId: z.number(),
  accepted: z.number(),
  duplicates: z.number(),
  rejected: z.number(),
  targetId: z.string(), // audit target = raw artifact id
});
```

```ts
// packages/api/src/routers/mobile.ts
export const mobileRouter = {
  /** Upsert provider_connection (provider, externalUserId = deviceId). Audited. */
  registerDevice: tenantScopedProcedure({
    resource: "records",
    action: "write",
    auditAction: "RECORD_CREATED",
    targetType: "provider_connection",
  })
    .input(
      z.strictObject({
        deviceId: z.uuid(),
        platform: z.enum(["android", "ios"]),
        deviceModel: z.string().max(100).optional(),
        appVersion: z.string().max(32),
      }),
    )
    .output(z.object({ providerConnectionId: z.number(), targetId: z.string() })),

  /** Append-only, idempotent ingestion. Audited once per new raw artifact. */
  ingestBatch: tenantScopedProcedure({
    resource: "records",
    action: "write",
    auditAction: "RECORD_CREATED",
    targetType: "ingestion_raw_artifact",
  })
    .use(validateInput(ingestBatchInput))
    .input(ingestBatchInput)
    .output(ingestBatchOutput),

  /** Safe status metadata only (counts, timestamps, last failure code); no PHI. */
  syncStatus: permissionedProcedure({ resource: "records", action: "read" }).output(
    z.object({
      devices: z.array(
        z.object({
          deviceId: z.string(),
          platform: z.string(),
          lastIngestAt: z.string().nullable(),
          perType: z.record(
            z.string(),
            z.object({ lastAt: z.string().nullable(), lastStatus: z.string().nullable() }),
          ),
        }),
      ),
    }),
  ),
};
```

**Server handler steps.** Organization and user always come from
`context.authz`.

1. Resolve `provider_connection` by `(org, provider, deviceId)`. A missing or
   `revoked` connection returns `FORBIDDEN`, which is how a device is
   disconnected without touching the auth session.
2. **Transaction 1 (durable acceptance):** insert an `ingestion_job` with
   `job_type = 'mobile_ingest_batch'`, `idempotency_key = 'mobile-ingest:' + contentHash`
   and `ON CONFLICT DO NOTHING`. A conflict means the batch was seen before:
   return `duplicate` with the existing artifact id. Otherwise insert an
   `ingestion_raw_artifact` with `artifact_type = 'mobile_health_batch'`,
   `payload_json` set to the validated input, `payload_hash = contentHash`,
   `size_bytes`, `trace_id = correlationId`, `retention_until = now + N days`,
   `retention_class = 'mobile_health_batch'` and `provider_connection_id`.
   Commit.
3. **Transaction 2 (apply):** create an `ingestion_batch`. Resolve `data_source`
   per distinct `sourceApp`/`sourceDevice` with `buildDataSourceIdentity`. Call
   `persistCanonicalRecords` grouped by data source. Insert one
   `provenance_link` (`derived_from_raw_artifact`) per inserted canonical row.
   Mark the batch and job `completed` / `succeeded`. Return `applied`.
4. If transaction 2 throws, the job stays `queued` and the response is `queued`.
   The device still advances its cursor, because the raw artifact is durable.
   A registered `mobile_ingest_batch` runner (the same code as transaction 2)
   retries it from the cron orchestrator. `ingestion_error` records the class
   name only, never the payload.

**Canonical dedupe change.** For records that carry an `externalRecordId`, the
`dedupe_hash` input becomes
`(provider, canonicalType, externalRecordId, lastModifiedAt ?? sampledAt, value)`
instead of the full `rawRecord`. This makes re-serialization and benign client
changes idempotent. `rawRecord` stays in `metadata_json` and in the raw artifact.
Replay of existing anchovy artifacts keeps the old hash path, gated by the
artifact type.

**PHI handling.** The handler logs only counts, the record type, the
correlation id and the status. The raw payload lives only in
`ingestion_raw_artifact` under the existing retention purge. The purge's
mobile-chunk branch stays for migrated anchovy rows.

### (b) Read cache and manual entry

- **Reads:** keep the existing `orpc.*.queryOptions` hooks. Add
  `PersistQueryClientProvider` with a persister backed by `expo-sqlite`. Set
  `maxAge` to 7 days and `gcTime` to at least `maxAge`
  ([persistQueryClient][tq-persist]). Persist an **allowlist** of query keys
  through `dehydrateOptions.shouldDehydrateQuery`: the cockpit summary, the last
  30 days of timeline, and the active plans. Never persist raw artifacts, exports
  or AI output. Set `buster = appVersion + userId + orgId`, and clear the
  persisted cache on sign-out or org switch.
- **Writes (manual entry, #33):** each form submits an oRPC mutation whose input
  includes a client-generated `clientEntryId` (uuid v7). The server stores it as
  `source_event_id` / `external_sample_id` with a unique constraint per org, so
  replays are no-ops. Mutations use `setMutationDefaults` so paused offline
  mutations survive restarts and are replayed with `resumePausedMutations()` on
  reconnect ([persistQueryClient][tq-persist]). On success, invalidate the
  affected queries. Edits are last-write-wins; single-user, two-client editing
  does not justify more.
- **On-device storage:** a single `expo-sqlite` database
  ([expo-sqlite][expo-sqlite]) holds the cursors table and the query-cache table.
  It is encrypted with SQLCipher (`useSQLCipher`), and the key lives in
  `expo-secure-store`. This moves the sync status and device id off the
  unencrypted AsyncStorage the scaffold uses today.
- **Revisit trigger:** if the product needs ad-hoc offline queries across the
  whole record (not just recently viewed screens), adopt TanStack DB
  `QueryCollection` with SQLite persistence once `@tanstack/db` reaches 1.0. It
  sits on top of the same oRPC procedures, so this decision does not block it.

### Auth: Better Auth Expo session, not a custom device-session contract

> **Pending an auth spike.** Background sync must keep working on a phone that
> has not been opened for weeks, including a locked iPhone. Two assumptions
> behind this section are unverified: that a session refresh keeps the stored
> token valid, and that an iOS background task can read the stored session while
> the device is locked. The spike is a dev build that signs in, locks the device,
> and runs a background task against a test endpoint. If it passes, adopt this
> section. If it fails, keep a long-lived device token scoped to
> `mobile.ingestBatch` only, alongside the Better Auth session for everything
> else. The ingestion contract below does not depend on the outcome.

- The mobile app signs in with Better Auth. Add the **email OTP** plugin
  (`signIn.emailOtp`, 6 digits, 300 s by default, [docs][ba-emailotp]) so no
  deep-link setup is needed. The **one-time-token** plugin can provide QR pairing
  from a signed-in web session later ([docs][ba-ott]). The Expo plugin keeps the
  session cookie in SecureStore and the app attaches it with
  `authClient.getCookie()` ([docs][ba-expo]). Both are already wired up.
- Sessions slide: "whenever the session is used and the `updateAge` is reached,
  the session expiration is updated". The defaults are 7 days and 1 day
  ([docs][ba-session]). Raise `session.expiresIn` to 30 days. Each foreground
  open or background sync refreshes the session. A device that has been silent
  for 30 days re-authenticates, which is the right outcome for a PHI app.
- **Revocation:** Better Auth `listSessions` / `revokeSession` revokes the login,
  and `provider_connection.status = 'revoked'` stops ingest. Both appear on the
  web settings page.
- **Org scoping:** `session.activeOrganizationId` flows through
  `tenantScopedProcedure` unchanged. A device never names an org in a payload.
  This removes the need for `mobile/organizations` and
  `mobile/organization/select`. Better Auth's `organization.setActive` covers the
  multi-org case.

## Worked example: weight reading from Health Connect to the web timeline

1. 07:02. A Withings scale writes `WeightRecord{ metadata.id = "a1b2…", dataOrigin = "com.withings.wiscale2", time = 07:01:58Z, weight = 81.2 kg }`
   to Health Connect.
2. 07:20. WorkManager fires `expo-background-task`. The task loads the `weight`
   changes token from SQLCipher SQLite and checks `getGrantedPermissions()`.
   `getChanges({ recordTypes: ["Weight"], changesToken })` returns one upsertion
   and `nextChangesToken = T2`. `dataOrigin` is not OpenValens, so the record is
   kept.
3. The device maps it to
   `{ type: "weight", externalRecordId: "a1b2…", lastModifiedAt, sourceApp: "com.withings.wiscale2", startTime: "…07:01:58.000Z", valueKg: 81.2 }`
   and calls
   `orpc.mobile.ingestBatch({ schemaVersion: 1, deviceId, provider: "health_connect", recordType: "weight", mode: "changes", upserts: [it], deletions: [], clientTimezone: "Europe/Lisbon" })`
   with the Better Auth cookie.
4. The server's `tenantScopedProcedure` resolves `org_123` from the session and
   checks `records:write`. Transaction 1 inserts
   `ingestion_job(mobile-ingest:<sha>)` and `ingestion_raw_artifact#901`
   (`payload_hash = <sha>`, `retention_until = +N d`). Transaction 2 resolves
   `data_source` `health_connect|…|com.withings.wiscale2`, inserts
   `metric_sample#5512` (weight, 81.2 kg, `external_sample_id = "a1b2…"`) and
   `provenance_link(metric_sample#5512 ← ingestion_raw_artifact#901, derived_from_raw_artifact)`,
   then marks the job `succeeded`. The audit log records `RECORD_CREATED` for
   `ingestion_raw_artifact` `901`. The response is
   `{ status: "applied", accepted: 1, duplicates: 0, rejected: 0, rawArtifactId: 901 }`.
5. The device stores `weight → T2`. If the process was killed before this write,
   the next run re-sends the same batch, gets `duplicate`, and then stores `T2`.
6. 07:30. The web timeline calls `timeline.list({ domain: "body" })`. The
   repository returns the `metric_sample` row with its data source, and the
   provenance drill-down links to raw artifact 901. Once retention expires, that
   artifact shows as purged while its hash stays visible. On the phone, the
   cockpit query refetches on focus and the persisted cache shows the reading
   offline next time.

For comparison, the port-as-planned path for the same reading takes these
steps: acquire the lease, call `sync-sessions/start`, plan chunks, upload chunk 0
with sha256, call `finalize`, write a checkpoint, queue a `sync_session_finalize`
job (whose runner does not exist), and wait for the next daily cron for the
weight to appear. Under PowerSync or Electric, steps 2 to 5 are identical,
because ingestion still goes through our API. The engine would only change
step 6 on the phone, at the cost of a replication slot and sync rules.

## Consequences

**Positive**

- One auth system, one authorization path, and one audit path for web and
  mobile.
- About 10 endpoints and 11 ported classes collapse into 3 procedures. The test
  surface is the content-hash idempotency, the cursor-advance-after-ack rule and
  the wire-schema mapping.
- New readings appear immediately (inline apply) instead of after the daily
  cron.
- Raw provenance, hashes and retention reuse the tables and purge that already
  exist.

**Negative / accepted risks**

- **Deletions** are stored in raw artifacts but not yet applied to canonical
  rows. File a follow-up: "apply mobile deletions as supersession, not hard
  delete", following `docs/migration-safety.md`.
- **Background reliability** remains best effort on both platforms. Foreground
  sync on app open is the guaranteed path. The UI shows `lastAckedAt` per type.
- **Changes-token expiry (30 days)** and fresh installs fall back to a 30-day
  re-read (or longer with `READ_HEALTH_DATA_HISTORY`). Correctness depends on
  canonical dedupe by `externalRecordId`, which this decision tightens.
- **Batch size cap** (1,000 records, about 1 MB). Dense heart-rate days need
  several calls. Hono and the reverse proxy must allow at least 2 MB bodies.
- **SecureStore in background on iOS:** the cookie must be readable while the
  device is locked after first unlock (`keychainAccessible: AFTER_FIRST_UNLOCK`).
  HealthKit data is unavailable while the device is locked in any case, so iOS
  background sync is mostly a "first unlocked window" sync.
- The **legacy tables** (`mobile_device_session`, `mobile_pairing_*`,
  `mobile_sync_session*`, `health_connect_sync`, `health_connect_record`) become
  write-dead. Keep them until #35 (anchovy data migration) decides whether
  historical rows move into `ingestion_raw_artifact` / canonical tables. Then
  drop them through a separate preflighted migration. Do not drop them now.
- `docs/migration-plan.md` rule 7 is reversed. Update that doc when #7 is
  rewritten.

## Changes to issues

| Issue          | Action                                                       | New scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **#7** M1.7    | **Rewrite** as "Mobile ingest contract" (auth pending spike) | Auth scope waits for the auth spike: if it passes, drop the 3-token, pairing and org-select endpoints and add the Better Auth `emailOTP` plugin (optionally `oneTimeToken` for QR pairing), `session.expiresIn = 30d`, and the production `openvalens://` trusted origin. Unblocked now: add `packages/api/src/contracts/mobile-ingest.ts` and `appRouter.mobile` with `registerDevice`, `ingestBatch` and `syncStatus` as specified above, plus `packages/ingestion/src/mobile-batch.ts` (2-phase accept/apply, `mobile_ingest_batch` runner, provenance links, new dedupe key). Acceptance: idempotent replay returns `duplicate`; a tenant override is rejected; a revoked connection gets 403; no PHI in logs. |
| **#25** M4.25  | **Keep, amend**                                              | Keep the reader layer. Fix the wire format to emit `mobileHealthRecord` from the shared contract (weight `startTime`, heart-rate `bpm` samples, string sleep stages, workout activity mapping). Use `getChanges` per type. Filter the OpenValens `dataOrigin`. Drop the `WRITE_PERMISSIONS` request unless #33 decides to write to Health Connect. Add `READ_HEALTH_DATA_IN_BACKGROUND` and `READ_HEALTH_DATA_HISTORY` checks.                                                                                                                                                                                                                                                                                     |
| **#26** M4.26  | **Keep, amend**                                              | Use `queryQuantitySamplesWithAnchor` / anchored queries (including `deletedSamples`) mapped to the same contract. Observers re-register at launch. No sync logic in this issue.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **#27** M4.27  | **Rewrite** as "Cursor-driven ingest client"                 | Replace the Kotlin port with `apps/native/lib/health-sync/`: cursor store (SQLCipher `expo-sqlite`), batcher (≤1000 records / ~1 MB), `orpc.mobile.ingestBatch` call with backoff, and advance-after-ack. Delete `sync.ts` placeholder REST, the djb2 hash and the AsyncStorage status. Tests: crash before cursor write leads to duplicate then advance; token expiry falls back to a 30-day re-read; partial grants; batch splitting. Drop the lease, chunk planner, streaming accumulator and the 10 ported test classes.                                                                                                                                                                                       |
| **#28** M4.28  | **Keep, simplify**                                           | Migrate `scheduler.ts` to `expo-background-task` (15 min minimum on Android, opportunistic on iOS). Each run calls the #27 drain with a time budget. Keep the permission-revocation check before each batch and the locked-device check (iOS). Secure-store usage shrinks to the SQLCipher key and the Better Auth cookie (`AFTER_FIRST_UNLOCK`). Remove "token + checkpoint persistence" from the scope.                                                                                                                                                                                                                                                                                                          |
| **#29** M4.29  | **Keep open, blocked on the auth spike**                     | Close if the spike passes. The token-rotation client is unnecessary because `apps/native/lib/auth-client.ts` and `utils/orpc.ts` already implement the Better Auth Expo flow. The remaining work (email-OTP sign-in screen, 401 leading to sign-in, sign-out clearing the SQLite cache and cursors) moves into #32 / #7.                                                                                                                                                                                                                                                                                                                                                                                           |
| New follow-ups | **File**                                                     | (1) Offline read cache and manual-entry outbox for native (TanStack Query persister plus `clientEntryId` uniqueness), under #32/#33. (2) Apply mobile deletions to canonical rows as supersession. (3) Map `body_fat`, `active_calories` and `distance` in the canonical adapter. (4) After #35, retire the legacy mobile tables via a preflighted migration. (5) Update `docs/migration-plan.md` Issue 7/27/28/29 sections, and rule 7 once the auth spike passes. (6) Auth spike: Better Auth session survival for background sync on a locked iPhone and a long-idle device.                                                                                                                                    |

## Not verified from primary sources

- **Better Auth session refresh rotating the token.** This doc assumes refresh
  extends `expiresAt` without changing the session token, so the cookie stored in
  SecureStore stays valid. The session docs describe expiry extension, not token
  rotation. Confirm in a dev build before #7 closes.
- **Whether `expoClient` passes `keychainAccessible` through to `expo-secure-store`.**
  If it does not, a small custom storage adapter is needed for iOS background
  runs.
- **HealthKit background-delivery frequency caps.** Apple's page renders
  client-side and could not be quoted verbatim. Treat "hourly maximum for
  high-frequency types" as unconfirmed.
- **Whether `kingstinct` v16 delivers `subscribeToChanges` callbacks into a
  headless JS runtime on a cold background launch.** The README confirms that the
  API exists, not that this cold-launch case works.
- **TanStack DB's version** comes from npm (`@tanstack/db@0.11.0`, 2026-10-01).
  The docs overview page does not state a version.

[hc-sync]: https://developer.android.com/health-and-fitness/health-connect/sync-data
[hc-read]: https://developer.android.com/health-and-fitness/health-connect/read-data
[rnhc-changes]: https://matinzd.github.io/react-native-health-connect/docs/api/methods/getChanges
[hk-lib]: https://github.com/kingstinct/react-native-healthkit
[hk-bg]: https://developer.apple.com/documentation/healthkit/hkhealthstore/enablebackgrounddelivery(for:frequency:withcompletion:)
[expo-bgtask]: https://docs.expo.dev/versions/latest/sdk/background-task/
[expo-bgfetch-blog]: https://expo.dev/blog/goodbye-background-fetch-hello-expo-background-task
[expo-sqlite]: https://docs.expo.dev/versions/latest/sdk/sqlite/
[ps-setup]: https://docs.powersync.com/intro/setup-guide
[ps-selfhost]: https://docs.powersync.com/self-hosting/getting-started
[ps-license]: https://powersync.com/legal/licensing-terms
[el-install]: https://electric.ax/docs/guides/installation
[el-writes]: https://electric.ax/docs/guides/writes
[el-expo]: https://electric.ax/docs/sync/integrations/expo
[zero-status]: https://zero.rocicorp.dev/docs/status
[zero-offline]: https://zero.rocicorp.dev/docs/offline
[zero-rn]: https://zero.rocicorp.dev/docs/react-native
[tsdb]: https://tanstack.com/db/latest/docs/overview
[tq-persist]: https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient
[ba-session]: https://www.better-auth.com/docs/concepts/session-management
[ba-expo]: https://www.better-auth.com/docs/integrations/expo
[ba-ott]: https://www.better-auth.com/docs/plugins/one-time-token
[ba-emailotp]: https://www.better-auth.com/docs/plugins/email-otp
[pg-slots]: https://www.postgresql.org/docs/current/logicaldecoding-explanation.html
