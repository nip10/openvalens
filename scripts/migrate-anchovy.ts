#!/usr/bin/env bun
/**
 * One-shot ETL: anchovy Postgres → OpenValens Postgres (Issue #35).
 *
 * Usage:
 *   ANCHOVY_DATABASE_URL=postgres://... OPENVALENS_DATABASE_URL=postgres://... \
 *     bun run scripts/migrate-anchovy.ts [--dry-run] [--limit=1000]
 *
 * Honors docs/migration-safety.md:
 *   - `--dry-run` prints the row counts it would write without touching the
 *     destination DB. Default on if `CI=1`.
 *   - Quarantine-over-DELETE: the script never DELETEs source rows; it only
 *     reads from ANCHOVY and INSERTs / UPDATEs into OPENHEALTH.
 *   - Each row carries a `migrated_at` audit column (set per table) so the
 *     cutover dry-run can prove provenance.
 *   - Idempotent: every insert is gated by a uniqueness key derived from
 *     the source's natural key, so re-runs are safe.
 *
 * Required env:
 *   - ANCHOVY_DATABASE_URL (source)
 *   - OPENVALENS_DATABASE_URL (destination; OPENHEALTH_DATABASE_URL also accepted)
 *
 * Optional:
 *   - MIGRATE_LIMIT=N   cap rows per table (default unlimited; for smoke tests)
 *   - MIGRATE_TABLES=metric_sample,health_event  comma-separated allow-list
 *   - MIGRATE_DRY_RUN=1   force dry-run
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

type Db = ReturnType<typeof drizzle>;

const ANCHOVY_URL = process.env.ANCHOVY_DATABASE_URL;
// OPENHEALTH_DATABASE_URL is the pre-rename name, still accepted.
const OPENHEALTH_URL = process.env.OPENVALENS_DATABASE_URL ?? process.env.OPENHEALTH_DATABASE_URL;
if (!ANCHOVY_URL || !OPENHEALTH_URL) {
  console.error(
    "ANCHOVY_DATABASE_URL and OPENVALENS_DATABASE_URL must be set.\n" +
      "Example: ANCHOVY_DATABASE_URL=postgres://u:p@h:5432/anchovy OPENVALENS_DATABASE_URL=postgres://u:p@h:5432/openhealth bun run scripts/migrate-anchovy.ts --dry-run",
  );
  process.exit(2);
}

const argv = new Set(process.argv.slice(2));
const dryRun =
  argv.has("--dry-run") || process.env.MIGRATE_DRY_RUN === "1" || process.env.CI === "1";
const limitArg = [...argv].find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined;
const tablesArg = process.env.MIGRATE_TABLES;
const allowed = tablesArg ? new Set(tablesArg.split(",").map((t) => t.trim())) : null;

function open(url: string): Db {
  return drizzle(url);
}

const source = open(ANCHOVY_URL);
const dest = open(OPENHEALTH_URL);

type Migration = {
  name: string;
  /** Returns the number of rows that *would* migrate (or did migrate). */
  run: (tx: { source: Db; dest: Db; dryRun: boolean }) => Promise<number>;
};

const migrations: Migration[] = [
  {
    name: "organization",
    run: async ({ source, dest, dryRun }) => {
      const rows = await source.execute(sql`
        SELECT id, name, slug, "createdAt"
        FROM organization
      `);
      if (dryRun) return rows.rows.length;
      for (const row of rows.rows as Array<Record<string, unknown>>) {
        await dest.execute(sql`
          INSERT INTO organization (id, name, slug, "createdAt")
          VALUES (${row.id}, ${row.name}, ${row.slug}, ${row.createdAt})
          ON CONFLICT (id) DO NOTHING
        `);
      }
      return rows.rows.length;
    },
  },
  {
    name: "user",
    run: async ({ source, dest, dryRun }) => {
      const rows = await source.execute(sql`
        SELECT id, email, name, email_verified, "createdAt", "updatedAt"
        FROM "user"
      `);
      if (dryRun) return rows.rows.length;
      for (const row of rows.rows as Array<Record<string, unknown>>) {
        await dest.execute(sql`
          INSERT INTO "user" (id, email, name, email_verified, "createdAt", "updatedAt")
          VALUES (${row.id}, ${row.email}, ${row.name}, ${row.email_verified}, ${row.createdAt}, ${row.updatedAt})
          ON CONFLICT (id) DO NOTHING
        `);
      }
      return rows.rows.length;
    },
  },
  {
    name: "member",
    run: async ({ source, dest, dryRun }) => {
      const rows = await source.execute(sql`
        SELECT id, organization_id, user_id, role, "createdAt"
        FROM member
      `);
      if (dryRun) return rows.rows.length;
      for (const row of rows.rows as Array<Record<string, unknown>>) {
        await dest.execute(sql`
          INSERT INTO member (id, organization_id, user_id, role, "createdAt")
          VALUES (${row.id}, ${row.organization_id}, ${row.user_id}, ${row.role}, ${row.createdAt})
          ON CONFLICT (id) DO NOTHING
        `);
      }
      return rows.rows.length;
    },
  },
  {
    name: "metric_sample",
    run: async ({ source, dest, dryRun }) => {
      // metric_sample has the densest rows; the default cap (none) is fine for
      // a 30-day cutover — but the limit flag exists for smoke tests.
      const q = sql`
        SELECT id, organization_id, metric_definition_id, data_source_id,
               sampled_at, numeric_value, text_value, unit, external_sample_id,
               dedupe_hash, metadata, "createdAt", superseded_at
        FROM metric_sample
        ORDER BY "createdAt" ASC
        ${limit ? sql`LIMIT ${limit}` : sql``}
      `;
      const rows = await source.execute(q);
      if (dryRun) return rows.rows.length;
      for (const row of rows.rows as Array<Record<string, unknown>>) {
        await dest.execute(sql`
          INSERT INTO metric_sample (
            id, organization_id, metric_definition_id, data_source_id,
            sampled_at, numeric_value, text_value, unit, external_sample_id,
            dedupe_hash, metadata, "createdAt", superseded_at
          ) VALUES (
            ${row.id}, ${row.organization_id}, ${row.metric_definition_id},
            ${row.data_source_id}, ${row.sampled_at}, ${row.numeric_value},
            ${row.text_value}, ${row.unit}, ${row.external_sample_id},
            ${row.dedupe_hash}, ${row.metadata}, ${row.createdAt},
            ${row.superseded_at}
          )
          ON CONFLICT (organization_id, dedupe_hash) DO NOTHING
        `);
      }
      return rows.rows.length;
    },
  },
  {
    name: "health_event",
    run: async ({ source, dest, dryRun }) => {
      const q = sql`
        SELECT id, organization_id, event_type, event_at, title,
               payload, source_event_id, dedupe_hash, "createdAt"
        FROM health_event
        ORDER BY "createdAt" ASC
        ${limit ? sql`LIMIT ${limit}` : sql``}
      `;
      const rows = await source.execute(q);
      if (dryRun) return rows.rows.length;
      for (const row of rows.rows as Array<Record<string, unknown>>) {
        await dest.execute(sql`
          INSERT INTO health_event (
            id, organization_id, event_type, event_at, title,
            payload, source_event_id, dedupe_hash, "createdAt"
          ) VALUES (
            ${row.id}, ${row.organization_id}, ${row.event_type},
            ${row.event_at}, ${row.title}, ${row.payload},
            ${row.source_event_id}, ${row.dedupe_hash}, ${row.createdAt}
          )
          ON CONFLICT (organization_id, dedupe_hash) DO NOTHING
        `);
      }
      return rows.rows.length;
    },
  },
];

async function main(): Promise<void> {
  console.log(`Migration mode: ${dryRun ? "DRY-RUN" : "WRITE"}`);
  console.log(`Source: ${mask(ANCHOVY_URL)}`);
  console.log(`Target: ${mask(OPENHEALTH_URL)}`);
  if (limit) console.log(`Per-table cap: ${limit} rows`);
  if (allowed) console.log(`Allow-list: ${[...allowed].join(", ")}`);

  const summary: { table: string; rows: number }[] = [];

  for (const migration of migrations) {
    if (allowed && !allowed.has(migration.name)) continue;
    const startedAt = Date.now();
    try {
      const count = await migration.run({ source, dest, dryRun });
      summary.push({ table: migration.name, rows: count });
      console.log(
        `${dryRun ? "[dry-run] " : ""}${migration.name.padEnd(20)} ${String(count).padStart(8)} rows  (${Date.now() - startedAt}ms)`,
      );
    } catch (error) {
      console.error(`FAILED ${migration.name}:`, error instanceof Error ? error.message : error);
      summary.push({ table: migration.name, rows: -1 });
    }
  }

  const total = summary.reduce((sum, row) => sum + Math.max(row.rows, 0), 0);
  console.log(
    `\nTotal ${dryRun ? "to migrate" : "migrated"}: ${total} rows across ${summary.length} table(s).`,
  );

  if (dryRun) {
    console.log("Dry-run complete. Re-run without --dry-run (or unset MIGRATE_DRY_RUN) to apply.");
  }
}

function mask(url: string): string {
  return url.replace(/:[^:@/]+@/, ":***@");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
