import { createHash } from "node:crypto";

import { sql, type Database } from "@openvalens/db";
import type { SQL } from "drizzle-orm";

import { toCsv } from "./csv";
import { DATA_RIGHTS_REGISTRY, isExported, type TableEntry } from "./registry";

/**
 * Full data export for a subject (Issue #89, GDPR Art. 20): JSON and CSV per
 * table, plus a manifest with row counts, exclusions, redactions and SHA-256
 * checksums. Rows keep their database column names so an export can be
 * re-imported. The caller authorizes: only an organization's owner may export
 * it.
 */

export const EXPORT_FORMAT = "openvalens-export";
export const EXPORT_FORMAT_VERSION = 1;

export type DataRightsSubject = {
  userId: string;
  /** Organizations (health records) the user owns. */
  organizationIds: readonly string[];
};

export type ExportFile = { path: string; content: string };

export type ExportManifest = {
  format: typeof EXPORT_FORMAT;
  formatVersion: typeof EXPORT_FORMAT_VERSION;
  generatedAt: string;
  subject: { userId: string; organizationIds: string[] };
  entities: { table: string; rows: number; files: string[] }[];
  excluded: { table: string; kind: string; reason: string }[];
  redacted: { table: string; columns: string[] }[];
  checksums: Record<string, string>;
};

export type DataExport = { manifest: ExportManifest; files: ExportFile[] };

type Row = Record<string, unknown>;

/** `column in (...)`; `false` for an empty list so nothing matches. */
function inList(column: string, values: readonly string[]): SQL {
  if (values.length === 0) return sql`false`;
  return sql`${sql.identifier(column)} in (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}

/** Row filters for tables reachable only through a parent. */
const CHILD_QUERIES: Record<string, (orgIds: string[]) => SQL> = {
  access_request_decision: (orgIds) =>
    sql`request_id in (select id from access_request where ${inList("organization_id", orgIds)})`,
  supplement: (orgIds) =>
    sql`id in (
      select supplement_id from supplement_schedule where ${inList("organization_id", orgIds)}
      union
      select supplement_id from supplement_change
      where ${inList("organization_id", orgIds)} and supplement_id is not null
    )`,
};

function filterFor(table: string, entry: TableEntry, subject: DataRightsSubject): SQL {
  const orgIds = [...subject.organizationIds];
  switch (entry.kind) {
    case "organization":
      return inList("organization_id", orgIds);
    case "user":
      return sql`user_id = ${subject.userId}`;
    case "self":
      return entry.match === "user" ? sql`id = ${subject.userId}` : inList("id", orgIds);
    case "child": {
      const query = CHILD_QUERIES[table];
      if (!query) throw new Error(`No child query registered for ${table}`);
      return query(orgIds);
    }
    default:
      throw new Error(`${table} is not exported`);
  }
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function toJson(value: unknown): string {
  return `${JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`;
}

export async function exportSubjectData(
  db: Database,
  subject: DataRightsSubject,
  now: Date = new Date(),
): Promise<DataExport> {
  const files: ExportFile[] = [];
  const entities: ExportManifest["entities"] = [];
  const excluded: ExportManifest["excluded"] = [];
  const redacted: ExportManifest["redacted"] = [];

  const tables = Object.keys(DATA_RIGHTS_REGISTRY).sort();
  for (const table of tables) {
    const entry = DATA_RIGHTS_REGISTRY[table]!;
    if (!isExported(entry)) {
      excluded.push({ table, kind: entry.kind, reason: "reason" in entry ? entry.reason : "" });
      continue;
    }

    const result = await db.execute(
      sql`select * from ${sql.identifier(table)} where ${filterFor(table, entry, subject)} order by 1`,
    );
    const rows = (result.rows as Row[]).map((row) => {
      if (!entry.redact?.length) return row;
      const copy = { ...row };
      for (const column of entry.redact) delete copy[column];
      return copy;
    });
    if (entry.redact?.length) redacted.push({ table, columns: [...entry.redact] });

    const paths = [`entities/${table}.json`];
    files.push({ path: paths[0]!, content: toJson(rows) });
    if (rows.length > 0) {
      paths.push(`entities/${table}.csv`);
      files.push({ path: paths[1]!, content: toCsv(rows) });
    }
    entities.push({ table, rows: rows.length, files: paths });
  }

  const checksums: Record<string, string> = {};
  for (const file of files) checksums[file.path] = sha256(file.content);

  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    generatedAt: now.toISOString(),
    subject: { userId: subject.userId, organizationIds: [...subject.organizationIds] },
    entities,
    excluded,
    redacted,
    checksums,
  };
  files.push({ path: "manifest.json", content: toJson(manifest) });
  return { manifest, files };
}

/** Recomputes every checksum in the manifest; returns the paths that differ. */
export function verifyExport(exported: DataExport): string[] {
  const byPath = new Map(exported.files.map((file) => [file.path, file.content]));
  return Object.entries(exported.manifest.checksums)
    .filter(
      ([path, digest]) => byPath.get(path) === undefined || sha256(byPath.get(path)!) !== digest,
    )
    .map(([path]) => path);
}
