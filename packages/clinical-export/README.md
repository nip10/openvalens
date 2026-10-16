# Issue #20 clinical export slice

Bounded `clinical.export` backend slice mirroring anchovy's `apps/web/src/lib/v2/clinical-export/build-bundle.ts` and `/api/v2/records/clinical/export` (canonical bundle, Issue #20 part 1), plus the legacy `apps/web/src/lib/export/` and `/api/records/export/csv` (legacy domain CSV pipeline, Issue #20 part 2). PDF rendering remains on the anchovy side.

## Scope

### Part 1 — canonical bounded bundle (commit `0632837`)

- `packages/clinical-export` package — pure `selectCanonicalRecords` / `buildClinicalExportBundle` assembly plus the read-only `createClinicalExportRepository` boundary against the actual `health_event`, `metric_sample`, `metric_definition`, `data_source`, `ingestion_raw_artifact` and `provenance_link` schema.
- `packages/api/src/routers/exports.ts` — oRPC `appRouter.exports.clinicalBundle` gated on `records:read` only. Inputs are Zod-strict (`limit` only); `x-organization-id` is rejected; org identity is authz-derived exclusively.

### Part 2 — legacy CSV slice (this slice)

- `packages/clinical-export/src/domains.ts` — `EXPORT_DOMAINS`, `DEFAULT_EXPORT_DOMAINS`, canonical ordering (`["blood", "body", "medications", "supplements", "workouts", "goals", "familyHistory", "calendar", "insights", "imaging", "cardiac", "dexa", "weight", "audit"]`).
- `packages/clinical-export/src/types.ts` — JSON-safe payload types matching the source contract (`ExportBloodRecord`, `ExportBodySnapshot`, `ExportInsightsSnapshot`, per-domain collections).
- `packages/clinical-export/src/request.ts` — `parseExportRequest` with sanitized `invalid_json | invalid_format | invalid_domains | empty_domains | invalid_domain | invalid_payload` error codes. Unknown domains, format overrides, extra keys and primitive bodies never echo raw caller values.
- `packages/clinical-export/src/build-payload.ts` — `buildExportPayload` runs each registered extractor in canonical order with deterministic dedup; `EXPORT_SCHEMA_VERSION = "export-v1"`. Extractors reuse the target repositories (`@openvalens/clinical`, `@openvalens/body`, `@openvalens/coach`, `@openvalens/plans`) and the Drizzle tables, each filtered by the active organization id.
- `packages/clinical-export/src/render-csv.ts` — per-domain CSV renderer, deterministic column order, `""` doubling and `=` / `+` / `-` / `@` / `\t` / `\r` formula-prefix neutralization. Filenames `health-export-{domain}-{YYYY-MM-DD}.csv`.
- `packages/clinical-export/src/extractors/` — per-domain extractor files that read from the target domain repositories or Drizzle tables with strict org predicates; `body-source.ts` exports the `selectLatestBodyWeight` helper.
- `packages/api/src/routers/exports.ts` — oRPC `appRouter.exports.legacyDownload` gated on `records:read` only. Zod-strict input (`domains` filtered through `isExportDomain`, `format` literal `"csv"`); `x-organization-id` is rejected; org identity is authz-derived exclusively; default domains are the canonical `["blood", "body", "medications", "supplements"]`. Success path emits a sanitized `EXPORT_GENERATED` audit entry (`metadata.schemaVersion`, `metadata.format`, `metadata.selectedDomains`, `metadata.fileCount`); no payload values, file contents, row IDs or raw invalid values ever reach the audit row.
- `packages/api/src/routers/exports.test.ts` — adds eight tests on top of the part-1 six: mount + canonical defaults, canonical reordering, audit metadata sanitization, unknown-domain rejection, header rejection (including active-org and empty), auth denial, strict input rejection (extra keys, format overrides, malformed arrays, payload bodies), and PHI-bearing CSV render without console output.

### Issue #132 — clinical PDF and audit timeline

- `src/clinical-pdf-domains.ts` — PDF-eligible domains (`blood`, `body`, `medications`, `supplements`, `familyHistory`, `imaging`, `cardiac`, `dexa`, `weight`). `insights`, `audit` and the planning domains stay CSV-only. Dependency-free, so presenters can import it.
- `src/clinical-pdf-document.ts` — all PDF copy as plain data: title, "About this document" disclaimer, per-section provenance (source, dates, units), fixed columns, WinAnsi text mapping, 500-row and 1000-character caps with visible markers. The stored HIGH/LOW flag and free-text notes are never rendered.
- `src/render-clinical-pdf.ts` — PDFKit (`pdfkit@0.20.2`, pure JS, built-in Helvetica) layout with repeated table headers and "Page X of Y" footers. Returns bytes in memory; nothing is persisted. The server bundle keeps `pdfkit` external (see `apps/server/tsdown.config.ts`).
- `packages/api/src/routers/exports.ts` — `exports.clinicalPdf` (`records:read`, base64 response, value-free `EXPORT_GENERATED` audit row). `legacyPdfDownload` remains the HTML view used by the mobile app.
- `@openvalens/audit-security` `buildAuditTimeline` — tenant-scoped, filtered, paginated, redacted read seam over `access_audit_log`; `extractAudit` now reads through it. `packages/api/src/routers/audit.ts` exposes it as `audit.timeline` (`records:admin_access`).
- Tests: `render-clinical-pdf.test.ts` parses the generated PDF with `unpdf`; `packages/api/src/routers/clinical-pdf-audit.integration.test.ts` covers both procedures over HTTP against PostgreSQL.

## Deferred scope

- The mobile app still uses the HTML `legacyPdfDownload` view.
- No migrations, schema changes, mobile/UI changes, observability changes, real auth or audit mutators ship here. No production calls. No third-party sends.

## Verification

- `packages/clinical-export/src/build-bundle.test.ts` — 5 tests, anchor fixture metadata, default/clamp semantics, snapshot/ISO/offset normalization, deterministic provenance sorting and equal-timestamp merge determinism.
- `packages/clinical-export/src/request.test.ts` — 7 tests, valid CSV/PDF parse, sanitized rejection of unknown domains, invalid formats, empty lists, extra keys, primitive bodies, and wrong-shape domain arrays.
- `packages/clinical-export/src/render-csv.test.ts` — 7 tests, header stability per representative domain, null/undefined cells, escape rules, formula-prefix neutralization, normal-value preservation, missing object-domain data, sanitized filename.
- `packages/clinical-export/src/build-payload.test.ts` — 3 tests, selected-only domain surface, canonical reordering of duplicates, active-organization-id propagation to extractors.
- `packages/clinical-export/src/extractors/body-source.test.ts` — 4 tests, canonical preference, legacy fallback, empty-case null and `maxIsoDate`.
- `packages/clinical-export/src/repository.legacy.integration.test.ts` — opt-in 4-test integration suite: default-domain tenant scope, explicit-domain cross-extractor tenant scope (medications, supplements, workouts, goals, familyHistory, calendar, insights, imaging, cardiac, dexa, weight, audit), sanitized invalid bodies, no-PHI console output.
- `packages/api/src/routers/exports.test.ts` — 14 tests (6 part-1 + 8 part-2). Synchronous module mocks with full exports snapshot and `afterAll` restore (timeline.test.ts repair pattern). No `console.*` calls during PHI-bearing responses. The legacyDownload audit metadata never contains payload values, raw row ids or raw invalid values.
- Run package tests and `bun test packages/api/src/routers/exports.test.ts` in separate processes to avoid Bun module-mock contamination. Run project `bun run check-types`, touched-file oxlint/oxfmt and `git diff --check`.

## Recovery notes

Owner: this bounded migration lane; parent owns final review before push.

- Project `bun run check-types` succeeds (20/20 tasks).
- `bun test packages/api/src/routers/exports.test.ts` passes (14/14).
- `bun test packages/clinical-export/` passes (27 unit + 4 integration = 31 pass; 13 skip when env is unset).
- Disposable PostgreSQL integration passes (4/4) against `legacy_export_issue20`. Container was removed afterward.
- `bun test` baseline (no opt-in env): **676 pass / 26 skip / 0 fail / 1995 expect() calls / 702 tests across 89 files.** Skips include the 11 health-record, 1 body and 14 legacy-export integration tests (6 clinical-export part-1 + 6 clinical-export part-2 + 2 unnamed wrappers). With `LEGACY_EXPORT_TEST_DATABASE_URL` set: **680 pass / 20 skip / 0 fail / 2026 expect() calls / 700 tests across 89 files.** The 20 remaining skips are the unchanged health-record (11), body (1) and clinical-export part-1 (5 + 1 wrapper) integration tests.
- No full-suite hang or unrelated test was disturbed. PDF rendering remains in anchovy untouched.
