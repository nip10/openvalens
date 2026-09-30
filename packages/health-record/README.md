# Issue #17 bounded backend slice

Reads canonical `health_event` and `metric_sample` rows, with tenant-scoped source/definition joins and provenance, preserving anchovy's canonical item, exact case-insensitive source-label/source-ID filters, UTC date-only boundaries and severity/confidence inference. Samples are separate records, never median-resolved. Stable occurrence-descending/ID-ascending pagination filters before slicing; cursors are ordering boundaries, not snapshot tokens under concurrent writes.

`changesSinceReview` preserves the source endpoint's occurrence-window semantics: latest org weekly-review `weekStart`, otherwise seven UTC days, summarized over the returned page. It is **not** a mutation diff: there is no metric `updatedAt`, tombstone or persisted review snapshot. Historical late imports and edits outside the window are not represented. No fabricated deletions.

Provenance inserts validate and share-lock both referenced IDs in a transaction, using org predicates. Only existing canonical/raw-artifact tables are supported. Projection pseudo-tables are rejected; metadata cannot be persisted by this schema and is rejected by the repository. API inputs reject org/user/metadata overrides and writes require `records:write` with membership; one `RECORD_CREATED` audit is emitted after success, without payloads.

Remaining parity: anchor consultation/imaging/cardiac/weekly-review/insight/calendar adapters, timeline links, taxonomy seeding, source preferences/priority resolution, interval helpers, mutation-history tracking, ingest integration. Partial predecessor domain adapters and generic priority/taxonomy stand-ins were inspected and removed rather than published as source parity. Source-identity helpers and core pagination/provenance helper tests were reused.

Scaling gap: full org candidate scans ensure correctness for derived filters/cursors but are not suitable for massive tenants. SQL keyset/filter pushdown, bounded provenance fetches, snapshot consistency and suitable indexes require follow-up. No performance claim is made.

## Verification

Owner: this bounded migration lane; parent owns final review before push.

- Pure package tests cover canonical projection, exact source matching, date boundaries, mixed ordering/cursors and source identity.
- API boundary tests mock auth, repository and audit; they establish permission selection, strict inputs, authz identity propagation, success audit cardinality and no console output. They do not replace real auth/database integration.
- `repository.integration.test.ts` applies all existing DB migration SQL to an **empty disposable** PostgreSQL database and tests actual joins, filters, pagination, latest-review lookup, real insert/rollback and cross-tenant referenced-ID rejection. It skips unless `TIMELINE_TEST_DATABASE_URL` points to a loopback database named `timeline_issue17`; do not point it at an existing database. Use a fresh local container (PostgreSQL 17) and remove it afterward. This does not exercise live services or real auth/audit persistence through the router.
- Run package tests and `bun test packages/api/src/routers/timeline.test.ts` in separate processes to avoid Bun module-mock contamination. Run project `bun run check-types`, touched-file oxlint/oxfmt and `git diff --check`.
- Full-repository tests were not run: the previously introduced `packages/plans/src/workouts.test.ts` hang is outside this lane. No claim of full-suite success.
