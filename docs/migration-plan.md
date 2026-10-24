# OpenValens migration plan

Source: [`health/anchovy`](../) (private, sibling monorepo).
Target: this monorepo (`openvalens`) — `create-better-t-stack` v3.44.2 scaffold
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

### Issue 7 — Mobile ingest contract + mobile auth

Rescoped by #40 ([`docs/architecture/mobile-sync-decision.md`](architecture/mobile-sync-decision.md)). The anchovy pairing / sync-session endpoints are
**not** ported.

- **Done:** `appRouter.mobile` with `registerDevice`, `ingestBatch` and
  `syncStatus` (contract in `packages/api/src/contracts/mobile-ingest.ts`,
  domain in `packages/ingestion/src/mobile-batch.ts`). Ingest is idempotent
  by batch content hash; deletions and edited records supersede canonical
  rows (#44).
- **Pending #42 (auth spike):** if a Better Auth Expo session survives
  background sync on a locked or long-idle phone, add the `emailOTP` plugin
  and 30-day sliding sessions and drop the 3-token contract; otherwise add a
  long-lived device token scoped to `mobile.ingestBatch` only.

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
connect-token,security,webhook}.ts`
  (the connect token became a stored one-time token in `connect.ts`).
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

- **Done:** `react-native-health-connect` v4 with its Expo config plugin,
  `expo-build-properties` (`minSdkVersion: 26`), and the read permissions
  declared in `apps/native/app.json` (weight, body fat, steps, heart rate,
  active calories, distance, sleep, exercise, background, history).
- Eight record types (anchovy had five), mapped to the shared contract in
  `apps/native/lib/health-sync/map-health-connect.ts`. Read-only: the app
  requests no write scopes and drops records it wrote itself.
- Health apps declaration in Play Console (now through Console, not the
  retired standalone form).
- **Do not** install `expo-health-connect` (archived 2026-08-01, merged
  into RNHC v4) — duplicate `HealthConnectPackage` class on build.

### Issue 26 — @kingstinct/react-native-healthkit integration

- **Done (unverified on device):** `@kingstinct/react-native-healthkit` v16
  with `react-native-nitro-modules`; config plugin with read usage text,
  no write usage text and the background-delivery entitlement.
- Anchored queries per type (`apps/native/lib/health-sync/healthkit-source.ts`),
  including deleted samples. Types: weight, body fat, steps, heart rate,
  active calories, walking/running distance, workouts. Sleep needs segments
  grouped into sessions (#52).
- Read authorization is unobservable: once asked, every type is queried and
  denied types return nothing.

### Issue 27 — Mobile ingest client

Rescoped by #40 ([`docs/architecture/mobile-sync-decision.md`](architecture/mobile-sync-decision.md)); the Kotlin sync engine is **not** ported.

- **Done:** `apps/native/lib/health-sync/drain.ts`. One cursor per record
  type (Health Connect changes token or HealthKit anchor), advanced only
  after every batch read from it is acknowledged. Deterministic batches
  (≤1000 records, ~900 KB) so retries are answered `duplicate`. Health
  Connect backfills 30 days one day at a time; HealthKit walks its history
  through the anchor. Runs are bounded by a batch budget and deadline.

### Issue 28 — Background sync

- **Done:** `expo-background-task` (WorkManager / BGTaskScheduler), 6-hour
  minimum interval, 10 batches or 20 s per run; the cursor resumes next run.
  The task is defined at module scope (root layout import) for headless
  launches. Settings has Sync now and a background toggle; sign-out clears
  cursors and the device registration.
- Permission revoked mid-run surfaces as `SOURCE_FAILED` for that type and
  leaves its cursor in place.
- Not done: HealthKit `subscribeToChanges` observers and the iOS
  locked-device check (depends on #42's outcome for the session store).
- Accept iOS force-quit / OEM battery-optimization constraints; design for
  "best effort" not "guaranteed."

### Issue 29 — Mobile auth client

Blocked on #42. If the spike passes, close this: the Better Auth Expo client
in `apps/native/lib/auth-client.ts` already stores and forwards the session.
If it fails, this becomes the client for the device token scoped to ingest.

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

### Issue 35 — Data migration script (anchovy → OpenValens Postgres)

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
  DNS/deploy target to OpenValens, smoke, unfreeze.
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
   _Under review:_ #40 proposes replacing it with the Better Auth Expo
   session; this rule stands until the auth spike (#42) passes.
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
