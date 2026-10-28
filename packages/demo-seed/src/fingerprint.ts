import { createHash } from "node:crypto";

import { sql, type Database } from "@openvalens/db";

/**
 * A digest of everything the demo seed wrote (Issue #301), for proving that
 * two runs give the same result.
 *
 * Account and workspace ids come from the admission core and are random by
 * design, and some rows carry the wall-clock time they were written. So each
 * table's rows are compared with UUIDs masked and without columns that only
 * record when or how a row was stored (`created_at`, `updated_at`, other
 * `*_at` times outside the data's own time fields, hashes, tokens and
 * idempotency fingerprints). Every
 * value the demo person sees (dates, amounts, names, notes) stays in.
 */

/** Timestamp columns that are part of the data itself, so they must match. */
const DATA_TIMESTAMPS = new Set(["sampled_at", "event_at", "measured_at", "observed_at"]);
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** Write times copied into stored JSON (idempotency logs keep the response). */
const JSON_WRITE_TIME = '""(createdAt|updatedAt)"": ""[^""]*""';

type Column = { table_name: string; column_name: string; data_type: string };

function compared(column: Column): boolean {
  const name = column.column_name;
  if (name === "created_at" || name === "updated_at") return false;
  if (/hash|token|secret|fingerprint|idempotency/.test(name)) return false;
  if (column.data_type.startsWith("timestamp") || name.endsWith("_at"))
    return DATA_TIMESTAMPS.has(name);
  return true;
}

export async function demoFingerprint(db: Database): Promise<Record<string, string>> {
  const columns = (
    await db.execute<Column>(
      sql`select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`,
    )
  ).rows;
  const byTable = new Map<string, string[]>();
  for (const column of columns) {
    if (!compared(column)) continue;
    const list = byTable.get(column.table_name) ?? [];
    list.push(`"${column.column_name}"`);
    byTable.set(column.table_name, list);
  }
  const digest: Record<string, string> = {};
  for (const [table, names] of [...byTable].sort(([a], [b]) => a.localeCompare(b))) {
    const rows = (
      await db.execute<{ row: string }>(
        sql.raw(
          `select regexp_replace(regexp_replace(row(${names.join(", ")})::text, '${UUID}', '<uuid>', 'g'), '${JSON_WRITE_TIME}', '<time>', 'g') as row from "${table}"`,
        ),
      )
    ).rows.map((value) => value.row);
    if (rows.length === 0) continue;
    rows.sort();
    digest[table] =
      `${rows.length}:${createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 16)}`;
  }
  return digest;
}
