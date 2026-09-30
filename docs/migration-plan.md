# openhealth migration plan

Source: [`health/anchovy`](../) (private, sibling monorepo).
Target: this monorepo (`openhealth`) — `create-better-t-stack` v3.44.2 scaffold
(TanStack Router web + Expo/UniWind native + Hono + oRPC + Better Auth +
Drizzle/Postgres + Turborepo).

This doc is the canonical reference for every migration issue. Each issue
links back here. Update this doc when scope changes; do **not** duplicate the
strategy in issues.

---

## Why this exists

The existing `anchovy` codebase is a private PHI-aware health cockpit with a
working Next.js 16 web app (84,447 LOC, 67 route handlers, 69 Drizzle tables,
35 migrations, 194 tests) and a Kotlin/Jetpack Compose Health Connect
companion (6,914 LOC, 5 HC record types, full chunked-upload sync engine with
leases and checkpoint resume).

Decision: full replatform onto the better-t-stack scaffold. Replatform — not
port. The custom mobile auth, the Health Connect sync engine, the v2 domain
boundaries, and the PHI-safe logging posture are _rebuilt_ in the new stack,
not migrated wholesale.

---

## Phases

| Phase                        | Goal                                                                                 | Critical-path?                        |
| ---------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------- |
| **0. Bootstrap & deploy**    | Scaffold runs locally + in CI; prod deploy works; schema is ported                   | Yes                                   |
| **1. Platform layer**        | Auth, oRPC contracts, observability, audit, readiness — everything domains depend on | Yes                                   |
| **2. External integrations** | Anthropic AI, Telegram bot, Resend email                                             | Required before domains that use them |
| **3. Domain migrations**     | Cockpit, timeline, sleep, coach, clinical-export, body, plans, clinical records      | Independent issues                    |
| **4. Mobile health surface** | Health Connect + HealthKit + sync client + background workers + secure storage       | Required for native release           |
| **5. Frontend**              | Web routes/components, native screens, manual entry, sharing flows                   | Independent issues                    |
| **6. Cutover**               | Data migration script, smoke tests, old-stack decommission                           | Final wave                            |

---

## Phase 0 — Bootstrap & deploy

### Issue 1 — CI baseline + verify pipeline

- Add `.github/workflows/ci.yml` mirroring the existing
  `anchovy/.github/workflows/ci.yml` (web `pnpm verify` equivalent + native
  prebuild lint + unit tests).
- Replace `pnpm verify` with the BTS-native chain: `bun run check`
  (oxlint+oxfmt), `bun run typecheck` (per workspace), `bun run db:push`
  against CI Postgres, `bun run test`, `bun run build`, `bun run
docs:typecheck`, `bun run docs:build`.
- Concurrency cancel-in-progress on PR + push to main.
- Acceptance: green run on a no-op PR; failing run on intentional breakage.

### Issue 2 — Production Dockerfile + docker-compose

- Multi-stage Bun image for `apps/web` + `apps/server` (mirror
  `anchovy/Dockerfile`'s posture: non-root, healthcheck, port alignment).
- `docker-compose.yml` for `web` + `server` + `postgres` (replaces the
  current Postgres-only compose; web is not composed in anchovy — here it
  is).
- Healthcheck hits `apps/server` `/api/health/readiness`.
- Secrets via env (no build-time injection for anything sensitive).
- Acceptance: `bun run docker:up` brings all three up; readiness check
  passes; logs are PHI-safe JSON.

### Issue 3 — Drizzle schema port + migration history

- Port `apps/web/src/lib/db/schema.ts` (69 tables) into `packages/db/src/schema/*`.
- Generate Drizzle migrations matching the 35 existing `.sql` files
  (`0000`–`0034`) — verify the new migrations produce identical schema.
- Preserve migration safety: `0024_silly_king_cobra.sql` already-applied
  destructive cleanup; quarantine-table pattern; `NOT VALID` → `VALIDATE
CONSTRAINT` sequence. Document this in `docs/migration-safety.md` in this
  repo.
- Move `apps/web/src/lib/db/{index,env,backfill-org-id}.ts` into
  `packages/db/src/`.
- Acceptance: `bun run db:push` produces a database with all 69 tables
  and identical constraints; backfill helper still works.

### Issue 4 — Coolify/Hetzner deployment + rollback runbook

- Coolify/Dokploy one-off `bun run db:migrate` (never auto-migrate on boot).
- Rollback = previous image/tag + pg_dump/volume snapshot.
- Document in `docs/deployment.md` (mirror `anchovy/docs/deployment.md`).
- Backups: `scripts/backup-postgres.sh`, `scripts/restore-postgres-drill.sh`,
  `docs/operations/backup-restore.md`.
- Acceptance: `make deploy` style doc works against a fresh Hetzner box.

---

## Phase 1 — Platform layer

### Issue 5 — Better Auth: magic-link + email sender

- Wire `@better-auth/core` magic-link on Hono server (BTS scaffold
  default).
- Port `anchovy/apps/web/src/lib/auth-magic-link.ts`,
  `auth-logging.ts`, `src/lib/email/templates/magic-link.tsx`.
- Use the Resend provider from Issue 15 (stub for now; finalize in 15).
- Acceptance: end-to-end magic-link sign-in works against the local dev DB.

### Issue 6 — Better Auth: org plugin + custom RBAC

- Wire Better Auth `organization` plugin with custom access control:
  13 resources × 5 actions (`src/lib/access/permissions.ts` in anchovy),
  4 roles (`owner/admin/collaborator/viewer`), role overrides can only
  reduce.
- Mirrors `anchovy/apps/web/src/lib/access/better-auth.ts`,
  `roles.ts`, `src/lib/authz/{guard,context}.ts`,
  `dashboard-{policy,access,enforce,nav}.ts`.
- On first sign-in, auto-create a personal workspace
  (`ensureActiveOrganization`).
- Acceptance: `requirePermission({resource,action})` reproduces existing
  behavior.

### Issue 7 — Mobile device-session auth (custom)

- Replicate the **custom** mobile auth in `anchovy` —
  **not** Better Auth sessions:
  `apps/web/src/lib/integrations/mobile/{device-session.ts,pairing.ts,
pairing-rate-limit.ts,security.ts}`,
  `apps/web/src/lib/authz/mobile-guard.ts`.
- Three tokens: access 15 min, refresh 90 d, deviceRenew 365 d.
  sha256-hashed with `MOBILE_SESSION_PEPPER`. Previous-token reuse
  detection revokes the session.
- Endpoint parity: `pairing/code`, `pairing/exchange`, `token/refresh`,
  `token/renew-device`, `mobile/organizations`, `mobile/organization/select`,
  `mobile/logout-device`.
- Acceptance: existing `MobileAuthSessionManager.kt` behavior reproduced
  server-side (we will reimplement the client side in Issue 29).

### Issue 8 — oRPC server + web client + mobile client

- Define the contract surface in `packages/api/src/router.ts`.
- Every procedure consumes Zod input + Zod output (mirror existing
  `src/lib/api/validation.ts`, `schemas/*`).
- Web client: TanStack Query-style hooks via the generated oRPC client.
- Mobile client: Expo fetch + `expo-secure-store` cookie forwarding
  (mirror `better-t-stack`'s oRPC native template).
- Error envelope: `src/lib/api/errors.ts` patterns.
- Acceptance: one end-to-end procedure (e.g. `/api/health/readiness`)
  round-trips through web + mobile clients.

### Issue 9 — PHI-safe structured logger + correlation-id middleware

- Port `anchovy/apps/web/src/lib/observability/{log,correlation}.ts`.
- Hono middleware:
  - JSON to stdout (info) / stderr (warn+error).
  - `BLOCKED_FIELDS` dropped recursively:
    `body,payload,text,messageText,email,token,authorization,
rawPayload,aiPrompt,aiResponse`.
  - Errors serialized as `{name, code?}` only (no message/stack).
  - Correlation: `x-correlation-id` → `x-request-id` → UUID; sanitized
    `[a-zA-Z0-9._:-]`, ≤64 chars.
- Wire into every mobile-sync route (Issue 7) and ingestion paths.
- Acceptance: known PHI fields never appear in logs; correlation-id
  propagates across mobile → server.

### Issue 10 — Audit log + redaction + tenant guard (audit-security domain)

- Port `anchovy/apps/web/src/lib/v2/audit-security/{audit-log,redaction,
tenant-guard}.ts`.
- Wire `accessAuditLog` writes from every mutation in the v2 domains.
- Apply tenant guard at every oRPC procedure boundary.
- Acceptance: cross-org access attempts produce audit entries and are
  rejected with `403 TENANT_VIOLATION`.

### Issue 11 — Health readiness + cron secret guard + cron schedule

- `GET /api/health/readiness` (mirror existing): DB ping + secret presence
  check + capability flags.
- Cron endpoints guarded with `Authorization: Bearer CRON_SECRET`:
  - `GET /api/reminders/daily/run` @ `5 8 * * *`
  - `GET /api/v2/ingestion/run` @ `15 9 * * *`
- Acceptance: missing/incorrect cron secret → 401; correct secret →
  procedural run.

### Issue 12 — CSP + security headers

- Mirror `anchovy/apps/web/next.config.ts` headers on Hono: CSP with
  allowlist `api.resend.com`, `api.telegram.org`, HSTS, X-Frame-Options
  DENY, nosniff, Referrer-Policy, Permissions-Policy.
- Body size limit `5_000_000` bytes (mirror `proxyClientMaxBodySize`).
- Acceptance: `curl -I` against `/` shows all expected headers; CSP
  report-only mode for staged rollout.

---

## Phase 2 — External integrations

### Issue 13 — Anthropic AI: chat + insights + extraction

- `@ai-sdk/anthropic` + `ai` v6 (or current).
- Model: `claude-sonnet-4-20250514` (or successor — verify in
  `anchovy/src/lib/ai/`).
- Consent gate via `organization.metadata.aiConsent` (mirror
  `anchovy/src/lib/ai/consent.ts`); default disabled; 403 `AI_DISABLED`
  on no-consent.
- Rate limits (`src/lib/ai/{chat-rate-limit,rate-limit}.ts`).
- Streaming chat with tool-calling — port the 10 tools from
  `anchovy/src/lib/ai/tools/index.ts`: health snapshot, labs, marker trend,
  panel compare, out-of-range, body comp, weight trend, supplements,
  goals, timeline summary.
- Context minimization: `buildContextWithScope` scopes
  `chat|insights|full`.
- Coach policy: port `anchovy/src/lib/coach/*` + `src/lib/v2/coach/*`.
- Acceptance: consent-off → 403; consent-on → streaming chat works on
  web + mobile.

### Issue 14 — Telegram bot: client + webhook + dedupe + connect

- Port `anchovy/apps/web/src/lib/integrations/telegram/{client,config,
connect-token,security,webhook}.ts`.
- Webhook validates `X-Telegram-Bot-Api-Secret-Token` (`secret_token`).
- Dedupes by `telegramUpdateId` with claim/stale logic.
- Reaction → status (`mapReactionToReminderStatus` in
  `anchovy/src/lib/reminders/daily.ts:67`).
- Acceptance: full send + webhook + reaction round-trip in staging.

### Issue 15 — Resend email: provider + templates + magic-link sender + audit BCC

- Port `anchovy/apps/web/src/lib/email/{provider,send,render,config,
logging}.ts`.
- Templates: magic-link, invitation, invitation-reminder/revoked,
  access-request submitted/approved/denied, layout.
- Audit BCC for sensitive flows.
- Env: `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `EMAIL_AUDIT_BCC`,
  `EMAIL_DRY_RUN`.
- Acceptance: every template renders + sends; magic-link email is the one
  used in Issue 5's end-to-end flow.

---

## Phase 3 — Domain migrations

Each issue: port the domain logic from the cited anchovy paths into the new
oRPC server + Drizzle repos, preserve v2 boundaries, add tests that mirror
existing coverage.

### Issue 16 — Cockpit + weekly review

- Source: `apps/web/src/lib/v2/cockpit/{engine,rules,types}.ts`,
  `src/lib/dashboard/*`, `src/lib/reports/weekly-report.ts`,
  route `api/v2/cockpit/today`, pages `/`, `/reports/weekly`.

### Issue 17 — Health-record timeline

- Source: `apps/web/src/lib/v2/health-record/{timeline,timeline-query,
timeline-adapters,timeline-links,changes-since-review,event-intervals,
metric-taxonomy,normalization,provenance-writer,source-identity,
source-priority*,source-preferences,timestamps}.ts`,
  routes `api/v2/records/timeline[/changes-since-review]`.

### Issue 18 — Sleep analytics

- Source: `apps/web/src/lib/v2/sleep/{coach-context,derive-daily-summary,
queries,scoring,types}.ts`, route `api/v2/sleep/summary`, page `/sleep`.

### Issue 19 — Coach (policy + templates)

- Source: `apps/web/src/lib/coach/*` (422 LOC),
  `apps/web/src/lib/v2/coach/{policy,derive-policy-state,
build-v2-policy-instruction,templates}.ts`, routes `api/chat`, `api/analyze`,
  `api/ingest/extract`, `api/coach/config`.

### Issue 20 — Clinical-export (PDF/CSV bundle)

- Source: `apps/web/src/lib/export/*` (1552 LOC: build-payload, render-csv,
  render-pdf, extractors/{activity,calendar,clinical,family,goals,insights,records}),
  `apps/web/src/lib/v2/clinical-export/build-bundle.ts`,
  routes `api/records/export/*`, `api/v2/records/clinical/export`.

### Issue 21 — Body composition / weight

- Source: `apps/web/src/lib/body/*` (275 LOC),
  `src/lib/queries/body.ts`, route `api/weight`, pages `/body`,
  `/entry/weight`.

### Issue 22 — Supplements / medications

- Source: routes `api/supplements`, `api/medications`,
  `apps/web/src/lib/supplements/*`, `src/lib/medications/*`.

### Issue 23 — Workouts / goals / calendar

- Source: `src/lib/workouts/*` (529 LOC), routes `api/workout(s)`,
  `api/goals[/checkins]`, `api/events`, `src/lib/calendar/*`,
  `src/lib/entry` (40 LOC).

### Issue 24 — Labs / cardiac / imaging / family history

- Source: `apps/web/src/lib/queries/{blood,blood-status,cardiac-info}.ts`,
  `apps/web/src/lib/clinical-record/*` (560 LOC incl. `build-audit`),
  routes `api/records/{audit,clinical/export,export/{csv,pdf}}`.

---

## Phase 4 — Mobile health surface

### Issue 25 — react-native-health-connect integration

- Library: `react-native-health-connect` v4.1.3+ (matinzd) — actively
  maintained, ships its own Expo config plugin in v4.
- Config plugin in `apps/native/app.json`:
  - `react-native-health-connect`
  - `expo-build-properties` for `minSdkVersion: 26`, `compileSdkVersion: 36`.
- Record types (5, matching anchovy companion): `WeightRecord`,
  `ExerciseSessionRecord`, `StepsRecord`, `HeartRateRecord`,
  `SleepSessionRecord`.
- Permissions rationale: plugin auto-wires
  `ACTION_SHOW_PERMISSIONS_RATIONALE` (Android ≤ 13) +
  `ViewPermissionUsageActivity` (Android 14+).
- Manifest perms (mirror `anchovy/apps/android/app/src/main/AndroidManifest.xml`):
  `INTERNET`, `android.permission.health.{READ_WEIGHT,READ_EXERCISE,
READ_STEPS,READ_HEART_RATE,READ_SLEEP,READ_HEALTH_DATA_IN_BACKGROUND,
READ_HEALTH_DATA_HISTORY}`.
- Health apps declaration in Play Console (now through Console, not the
  retired standalone form).
- **Do not** install `expo-health-connect` (archived 2026-08-01, merged
  into RNHC v4) — duplicate `HealthConnectPackage` class on build.

### Issue 26 — @kingstinct/react-native-healthkit integration

- Library: `@kingstinct/react-native-healthkit` v16.0.0+ (Kingstinct) —
  Nitro-based, background delivery wired through JS in v16.
- Config plugin sets `NSHealthShareUsageDescription`,
  `NSHealthUpdateUsageDescription`, `background: true`.
- Entitlements: HealthKit + `com.apple.developer.healthkit.background-delivery`.
- Same 5 record types as Issue 25; include `HKWorkoutType` for exercise.
- Read authorization opacity: cannot detect read revocation — design for
  graceful empty results, gate on share/write status only.

### Issue 27 — Mobile sync client

- TS port of `anchovy/apps/android/.../sync/{SyncRunner,SyncApiClient,
SyncCheckpointStore,SyncRunLease,ChunkPlanner,BackfillPlanner,
StreamingChunkAccumulator,Scheduler,BackgroundSyncWorkerRunner,
FrequentSyncWorker,OpportunisticBackfillWorker}.kt`.
- Server contract is byte-compatible (do **not** change the 10 mobile
  endpoints in Issue 7).
- Lease semantics: 10-min TTL, sha256 chunk hash, skip-by-index/hash on
  resume.
- Backfill: 14-day slices, 6-month horizon, 30-day incremental fallback.
- Streaming accumulator flushes at `min(SYNC_SESSION_MAX_CHUNK_BYTES,
DEFAULT_APP_CHUNK_CAP_BYTES)` (`5_000_000` server, `256 KiB` client).
- Local persistence: `expo-secure-store` (replaces EncryptedSharedPreferences).
- Unit tests port the 10 existing test classes
  (`SyncRunnerTest`, `SyncViewModelTest`, etc.) — they are the behavior
  spec.

### Issue 28 — Background sync + secure storage

- `expo-background-task` (WorkManager on Android, BGTaskScheduler on iOS)
  replacing `BackgroundSyncWorkerRunner`.
- 15-min OS-throttled scheduling (single native worker, sequential JS).
- Health Connect: `READ_HEALTH_DATA_IN_BACKGROUND` permission +
  `getChanges` with change tokens.
- HealthKit: `configureBackgroundTypes` + `subscribeToChanges` with
  native observer re-registration at launch
  (`UIApplicationDidFinishLaunchingNotification`); frequencies
  `immediate | hourly | daily | weekly`.
- Accept iOS force-quit / OEM battery-optimization constraints; design
  for "best effort" not "guaranteed."
- Locked-device protection: check `isProtectedDataAvailable()` and
  retry (HealthKit).
- Mid-upload Health Connect revocation: poll `getGrantedPermissions()`
  before each chunk/lease acquisition; on revoke, abort run + open
  `openHealthConnectSettings()`.

### Issue 29 — Mobile auth client

- TS port of `anchovy/apps/android/.../sync/MobileAuthSessionManager.kt`.
- Pairing flow (web → mobile): generate code, scan/enter, exchange for
  tokens.
- Token rotation: access → refresh → renew → clear+expire.
- Secure store: `expo-secure-store` with prefix.
- Recovery: detect 401 → run rotation → retry once → re-pair on second
  failure.

---

## Phase 5 — Frontend

### Issue 30 — Web design system

- Tailwind v4 tokens (oklch, dark variant, tw-animate-css, shadcn/tailwind.css).
- Component primitives (mirror `anchovy/apps/web/src/components/ui/*`):
  button, card, dialog, sheet, sidebar, chart, table, tabs, select,
  tooltip, … (~2,600 LOC of primitives).
- Design tokens: Geist + Geist Mono + Cormorant Garamond
  (`--font-display-serif`).
- Acceptance: storybook or `/dev/components` route renders all primitives.

### Issue 31 — Web routes + IA

- App-router equivalent in TanStack Router: `(auth)`, `(dashboard)` groups.
- IA groups: Review (`/`, `/reports/weekly`, `/calendar`), Track
  (`/blood`, `/body`, `/workouts`, `/supplements`, `/medications`,
  `/goals`, `/cardiac`, `/imaging`, `/family`, `/sleep`),
  Analyze (`/chat`, `/ingest`), Share (`/sharing`, `/records/...`),
  Settings (`/integrations`, `/coach`, `/settings`, `/v2`,
  `/v2/providers`), manual entry modals.
- Nav policy: `authz/dashboard-{policy,nav}.ts`.
- Acceptance: every documented page renders against seeded dev data.

### Issue 32 — Native app screens

- TanStack Router mobile + UniWind + drawer layout.
- Screen map: home/dashboard, timeline, manual entry, sharing, settings,
  onboarding.
- HeroUI Native provider (matches BTS default for `native-uniwind`).
- Acceptance: cold start → home → drill into a domain → manual entry
  → submit succeeds end-to-end against dev backend.

### Issue 33 — Manual entry flows

- Mobile + web parity for entry of: weight, workouts, supplements,
  medications, blood panels, cardiac, imaging, family, goals, calendar.
- Forms validate with shared Zod schemas (`packages/api` or local).
- Acceptance: every entry type works on web + mobile with consistent
  validation.

### Issue 34 — Sharing / access / invitation flows

- Source: `anchovy/apps/web/src/lib/sharing/*`, `src/lib/access/*`,
  routes `api/sharing/*`, `api/access-requests/*`.
- Mobile-equivalent screens for invitation accept/deny + access requests.
- Acceptance: owner invites collaborator; collaborator accepts on mobile;
  audit log records the decision.

---

## Phase 6 — Cutover

### Issue 35 — Data migration script (anchovy → openhealth Postgres)

- One-shot ETL: old Postgres → new Postgres with schema mapping
  (largely 1:1 since both are Drizzle/Postgres).
- Honor migration safety (`docs/migration-safety.md`): quarantine tables
  over DELETE, `NOT VALID` → `VALIDATE CONSTRAINT`, dry-run mode.
- Backfill helper (`apps/web/src/lib/db/backfill-org-id.ts`) reusable.
- Acceptance: dry-run report shows row counts per table; live run
  finishes against a snapshot; integrity checks pass.

### Issue 36 — End-to-end smoke + readiness + observability

- Smoke scripts (`scripts/*-smoke.ts`) mirror anchovy: email, reminders,
  export, ingestion.
- PHI-safe logging end-to-end (mobile → server → stdout).
- Acceptance: smoke scripts green; readiness check green; logs in
  production-shape JSON.

### Issue 37 — Decommission old Next.js + DNS/deploy cutover + rollback

- Old anchovy code is read-only by this point.
- Cutover checklist: backup, freeze writes on old, run Issue 35, flip
  DNS/deploy target to openhealth, smoke, unfreeze.
- Rollback: keep previous image/tag + pg_dump/volume snapshot.
- Acceptance: documented runbook + dry-run on staging.

---

## Cross-cutting constraints

These are non-negotiable and apply to every issue:

1. **PHI-safe logging** — every log line uses `Issue 9`'s logger;
   `BLOCKED_FIELDS` is enforced at the call site.
2. **Correlation id** — every mobile → server call carries
   `x-correlation-id`; server preserves it end-to-end.
3. **Tenant guard** — every oRPC procedure that touches PHI runs through
   `Issue 10`'s tenant guard.
4. **v2 boundaries** — `src/lib/v2/README.md` rules apply: cross-domain
   access only via typed contracts.
5. **Org-scoped RBAC** — every mutation calls `requirePermission`.
6. **Migration safety** — quarantine over DELETE; `NOT VALID` →
   `VALIDATE CONSTRAINT`; documented in
   `docs/migration-safety.md`.
7. **No Better Auth sessions for mobile** — the mobile device-session
   contract (Issue 7) is intentional and not interchangeable.
8. **No server actions** — every API surface is an oRPC procedure on the
   Hono server.
9. **Health Connect change tokens are valid 30 days** — never let them
   expire; fall back to full re-read on `changesTokenExpired`.
10. **HealthKit read revocation is unobservable** — design for graceful
    empty results.

---

## Open decisions (call out before starting each phase)

- **Phase 0, Issue 2:** do we deploy server as a separate Docker
  container, or co-locate web + server behind one reverse proxy?
- **Phase 1, Issue 6:** confirm RBAC resource/action matrix from
  `anchovy/src/lib/access/permissions.ts` matches current policy.
- **Phase 1, Issue 8:** oRPC server in same repo (`apps/server`) per BTS
  default, or separate?
- **Phase 4, Issue 27:** is the 14-day slice / 6-month horizon still the
  right backfill strategy, or should we change with the new Expo
  background-task 15-min OS throttle?
- **Phase 6, Issue 35:** schema-mapping edge cases (column renames,
  type changes) — resolve during Issue 3.
