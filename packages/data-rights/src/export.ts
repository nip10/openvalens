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
export function inList(column: string, values: readonly string[]): SQL {
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

/** WHERE clause selecting the subject's rows in an exported table. */
export function rowFilter(table: string, subject: DataRightsSubject): SQL {
  const entry: TableEntry | undefined = DATA_RIGHTS_REGISTRY[table];
  if (!entry) throw new Error(`${table} is not in the data-rights registry`);
  const orgIds = [...subject.organizationIds];
  switch (entry.kind) {
    case "organization":
      // These rows describe one member's targets, not the workspace owner's
      // record. Keep the organization classification for container erasure,
      // but export only this subject's values across their memberships.
      if (
        table === "nutrition_goal" ||
        table === "nutrition_energy_proposal" ||
        table === "nutrition_target_settings"
      )
        return sql`user_id = ${subject.userId}`;
      return inList("organization_id", orgIds);
    case "user":
      return sql`user_id = ${subject.userId}`;
    case "self":
      return entry.match === "user" ? sql`id = ${subject.userId}` : inList("id", orgIds);
    case "admission":
      // Recipient scope only: the target user, or a pending grant addressed to
      // the subject's current email. The inviter is deliberately excluded so an
      // export can never reveal other recipients of the same invitation.
      return sql`target_user_id = ${subject.userId}
        or canonical_email = lower((select email from "user" where id = ${subject.userId}))`;
    case "child": {
      const query = CHILD_QUERIES[table];
      if (!query) throw new Error(`No child query registered for ${table}`);
      return query(orgIds);
    }
    default:
      throw new Error(`${table} is not exported`);
  }
}

/**
 * Erasure includes the subject's member-private plain-water rows and all
 * water rows inside containers being erased. Export intentionally continues
 * to use {@link rowFilter}, so another member's rows are never exported.
 */
export function deletionRowFilter(table: string, subject: DataRightsSubject): SQL {
  if (
    table === "plain_water_entry" ||
    table === "plain_water_preference" ||
    table === "plain_water_mutation"
  )
    return sql`user_id = ${subject.userId} or ${inList("organization_id", subject.organizationIds)}`;
  if (
    table === "nutrition_goal" ||
    table === "nutrition_energy_proposal" ||
    table === "nutrition_target_settings"
  )
    return sql`user_id = ${subject.userId} or ${inList("organization_id", subject.organizationIds)}`;
  return rowFilter(table, subject);
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
      sql`select * from ${sql.identifier(table)} where ${rowFilter(table, subject)} order by 1`,
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
