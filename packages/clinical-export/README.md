# Issue #20 canonical clinical export slice

Bounded `clinical.export` slice mirroring anchovy's `apps/web/src/lib/v2/clinical-export/build-bundle.ts` and the `/api/v2/records/clinical/export` route surface.

## Scope

- `packages/clinical-export` package — pure `selectCanonicalRecords`/`buildClinicalExportBundle` assembly plus the read-only `createClinicalExportRepository` boundary against the actual `health_event`, `metric_sample`, `metric_definition`, `data_source`, `ingestion_raw_artifact` and `provenance_link` schema.
- `packages/api/src/routers/exports.ts` — oRPC `appRouter.exports.clinicalBundle` gated on `records:read` only. Inputs are Zod-strict (`limit` only); `x-organization-id` is rejected; org identity is authz-derived exclusively.
- `packages/api/src/routers/exports.test.ts` — six anchor-equivalent fixture tests (default/nonfinite/truncate/clamp, auth denial, strict input rejection, header rejection, no-PHI logs) using synchronous mocks with full-export snapshots and `afterAll` restore (timeline.test.ts repair pattern).

## Deferred scope

CSV/PDF export pipelines and any non-canonical route surface remain on the source side. This slice only ports the **canonical bounded bundle** contract — legacy domain CSV/PDF exports are intentionally not ported and continue to live in anchovy. No migrations, schema changes, mobile/UI changes, observability, audit mutators or auth changes ship here. No production calls.

## Verification

- `packages/clinical-export/src/build-bundle.test.ts` covers anchor generation metadata, empty bundle, default/nonfinite/truncate/clamp semantics, ISO/offset/invalid-string normalization, deterministic provenance sorting, latest-first merge with table/numeric ID tie-break and equal-timestamp determinism. 5 tests.
- `packages/api/src/routers/exports.test.ts` mocks `createClinicalExportRepository`, `requirePermission` and `writeAuditLog` synchronously with eager complete-export snapshots and full restore in `afterAll`. 6 tests, no `console.*` calls during PHI-bearing responses.
- `packages/clinical-export/src/repository.integration.test.ts` applies the actual DB migrations to an **empty disposable** PostgreSQL database named `clinical_export_issue20` and tests cross-tenant canonical isolation, foreign provenance exclusion, dangling-source rejection, empty-tenant envelope, limit clamping and no-PHI console output. It skips unless `CLINICAL_EXPORT_TEST_DATABASE_URL` points to a loopback disposable database; never point it at an existing database. Use a fresh local container (PostgreSQL 18) and remove it afterward. This does not exercise live services or real auth/audit persistence through the router. 5 opt-in tests.
- Run package tests and `bun test packages/api/src/routers/exports.test.ts` in separate processes to avoid Bun module-mock contamination. Run project `bun run check-types`, touched-file oxlint/oxfmt and `git diff --check`.

## Recovery notes

Owner: this bounded migration lane; parent owns final review before push.

- Project `bun run check-types` succeeds (20/20 tasks).
- `bun test packages/api/src/routers/exports.test.ts` passes (6/6).
- `bun test packages/clinical-export/src/build-bundle.test.ts` passes (5/5).
- Disposable PostgreSQL integration passes (5/5) against `clinical_export_issue20`. Container was removed afterward.
- `bun test` baseline (no opt-in env): **646 pass / 20 skip / 0 fail / 1896 expect() calls / 666 tests across 84 files.** Skips include the 11 health-record, 1 body and 7 clinical-export integration tests (5 named + 2 unnamed wrappers). With `CLINICAL_EXPORT_TEST_DATABASE_URL` set: **651 pass / 13 skip / 0 fail / 1915 expect() calls / 664 tests across 84 files.** The 13 remaining skips are the unchanged health-record (11) and body (1) integration tests.
- No full-suite hang or unrelated test was disturbed. CSV/PDF pipelines remain in anchovy untouched.
