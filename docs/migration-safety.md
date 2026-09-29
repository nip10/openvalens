# Migration safety for PHI-bearing tables

Last updated: 2026-05-26

> ## Port note (openhealth)
>
> This document was ported verbatim from `anchovy/docs/migration-safety.md`.
> It applies to **this repo's migrations as well**.
>
> The 35 historical anchovy migrations (`0000`–`0034`) are preserved here
> byte-for-byte. The canonical on-disk shape is drizzle-kit's V3 folder format
> (`src/migrations/<UTC-timestamp>_<name>/migration.sql`) because the pinned
> `drizzle-kit` `1.0.0-rc.4` rejects the legacy flat `.sql` + `meta/` layout.
> The SQL itself is unmodified:
>
> - `drizzle/migrations/0024_silly_king_cobra.sql` →
>   `packages/db/src/migrations/20260308185538_silly_king_cobra/migration.sql`
> - `drizzle/migrations/0034_dexa_regional_scan_index.sql` →
>   `packages/db/src/migrations/20260526160024_dexa_regional_scan_index/migration.sql`
>
> The destructive cleanup in `0024_silly_king_cobra` is therefore _already in
> this repo's history_. It is part of the baseline, not a change to be applied
> again. The quarantine-over-DELETE, preflight, and `NOT VALID` →
> `VALIDATE CONSTRAINT` rules below still bind **every new migration** added
> after this baseline.
>
> A single known deviation from anchovy: `0034_dexa_regional_scan_index` was
> committed upstream without a `_journal.json` entry, so upstream's migration
> history never applied it. This port includes it as the 35th migration so the
> baseline reproduces the schema declared in `schema.ts` (which contains the
> index). No SQL was changed.

This repo stores health data, so destructive cleanup in migrations must be treated as PHI-risky by default. Prefer repairable, auditable changes over silent deletes.

## Existing destructive migration risk

`drizzle/migrations/0024_silly_king_cobra.sql` contains several `DELETE` and `UPDATE ... SET ... = null` cleanup steps before adding composite keys and `NOT VALID` foreign keys.

If this migration has already been applied, the dangerous part is not the later constraints — it is the earlier data cleanup. Any rows removed by the `DELETE` statements are permanently lost unless recovered from backups/WAL, and any nulled references may have already destroyed lineage needed for reconciliation.

Affected tables include:

- `data_source`
- `ingestion_job`
- `ingestion_batch`
- `metric_sample`
- `health_event`
- `ingestion_error`

## Safety pattern

### 1) Preflight checks first

Before applying a migration that tightens integrity, run explicit checks and abort on inconsistent data.

Typical checks:

- count orphaned rows
- compare source/target row counts
- detect duplicate natural keys
- verify tenant/org scope alignment

If any check fails, stop and quarantine the bad rows for review instead of deleting them.

### 2) Quarantine, do not silently delete

Move invalid rows into a repair table or quarantine table that preserves original payload, timestamps, and reason codes.

Suggested fields:

- `id`
- `organization_id`
- `source_table`
- `source_row_id`
- `reason`
- `payload_json`
- `detected_at`
- `resolved_at`

Use quarantine tables for:

- orphaned PHI-bearing records
- records with broken tenant scope
- rows that fail schema assumptions during backfills

### 3) Add constraints in phases

Use the `NOT VALID` / `VALIDATE CONSTRAINT` pattern:

1. add the constraint as `NOT VALID`
2. fix or quarantine bad rows
3. run `VALIDATE CONSTRAINT`

This reduces lock time while still enforcing correctness for future writes.

### 4) Rollback and reconciliation notes

- Rollbacks should assume data may already be repaired, not deleted.
- Keep a reconciliation report with row counts before/after migration.
- If destructive cleanup is unavoidable, require a backup restore plan and a manual sign-off.
- Document how to map quarantined rows back into production tables.

## Migration checklist for future PHI-bearing tables

- [ ] Identify tenant/org scope for every table touched.
- [ ] Add preflight SQL that fails on orphaned or duplicate data.
- [ ] Prefer quarantine tables over `DELETE`.
- [ ] Add constraints with `NOT VALID`, then validate after cleanup.
- [ ] Record row counts and anomaly counts in the migration note.
- [ ] Confirm rollback path and backup availability.
- [ ] Review whether the migration can expose or destroy PHI lineage.

## Recommended pattern

When a future migration needs repair work:

1. create `*_quarantine` or `*_repair_queue`
2. copy invalid rows with full context
3. make the schema stricter in a forward-only step
4. validate after remediation
5. keep a short reconciliation note in the migration PR

## Schema parity verification

The 35-migration baseline was verified to produce the same schema as a single
migration generated from `packages/db/src/schema/*`.

Method (offline, not run in CI):

1. Fresh Postgres 18 database `A`; `bun run db:migrate` applied all 35
   migrations in order. Result: **69 tables** in `public`, **35** rows in
   `drizzle.__drizzle_migrations`.
2. `drizzle-kit generate` was run against the modular schema into a scratch
   output folder, producing **one** migration (`migration.sql` + `snapshot.json`).
3. That single migration was applied to a fresh database `B`. Result: **69
   tables**.
4. Normalized schema metadata was dumped from both databases and diffed:
   - columns (`table`, `column`, `format_type`, nullability, default): **656**
   - indexes (`table`, definition with the index name stripped): **289**
   - constraints (FK/CHECK/UNIQUE/PK definitions, names stripped): **226**
   - enums (label lists): **10**

   Diff result: **0 differences** across all four categories, after ignoring
   column _ordinal position_ (the migrations add `organization_id` via
   `ALTER TABLE`, so it appears last; generated DDL interleaves it) and
   index/constraint _names_ only where they coincide structurally. Column order
   and constraint naming carry no semantic or query-visible difference.

Conclusion: the 35 historical migrations and the current schema are
schema-equivalent. Any future drift must be corrected with a new migration that
follows the rules above — never by editing the baseline.

## See also

- [Project README](../README.md)
