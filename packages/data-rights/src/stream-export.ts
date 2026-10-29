import { createHash } from "node:crypto";

import { sql, type Database } from "@openvalens/db";

import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  exportRedactedColumns,
  rowFilter,
  serializeExportRow,
  type DataRightsSubject,
  type ExportManifest,
} from "./export";
import { DATA_RIGHTS_REGISTRY, isExported } from "./registry";

/** Internal SQL builder, exported for deterministic query-shape regression tests. */
export function buildRowLimitPreflightQuery(
  table: string,
  subject: DataRightsSubject,
  maxRowBytes: number,
) {
  return sql`select exists (
    select 1 from ${sql.identifier(table)}
    where (${rowFilter(table, subject)})
      and octet_length(row_to_json(${sql.identifier(table)})::text) > ${maxRowBytes}
  ) as oversized`;
}

export type SubjectJsonSink = {
  write(path: string, chunks: AsyncIterable<Uint8Array>): Promise<void>;
};

export type SubjectJsonLimits = {
  maxRowBytes: number;
  fetchRows: number;
  maxMetadataBytes: number;
};

const DEFAULT_LIMITS: SubjectJsonLimits = {
  maxRowBytes: 1024 * 1024,
  fetchRows: 16,
  maxMetadataBytes: 256 * 1024 * 1024,
};

export class SubjectExportLimitError extends Error {
  readonly code = "SUBJECT_EXPORT_LIMIT";
  constructor(readonly limit: "row" | "metadata") {
    super("Subject export exceeded a configured size limit.");
    this.name = "SubjectExportLimitError";
  }
}

function json(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

function asBytes(chunk: string): Uint8Array {
  return new TextEncoder().encode(chunk);
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Subject export was aborted.");
    error.name = "AbortError";
    throw error;
  }
}

/**
 * Stream portable entity JSON and a final manifest from one read-only snapshot.
 * manifest.json is written by this function last and intentionally has no checksum
 * entry for itself. The sink owns persistence/hash tracking for each file.
 */
export async function writeSubjectJsonFiles(
  db: Database,
  subject: DataRightsSubject,
  sink: SubjectJsonSink,
  options: { signal?: AbortSignal; limits?: Partial<SubjectJsonLimits>; now?: Date } = {},
): Promise<ExportManifest> {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  if (
    !Number.isSafeInteger(limits.maxRowBytes) || limits.maxRowBytes < 1 ||
    !Number.isSafeInteger(limits.fetchRows) || limits.fetchRows < 1 ||
    !Number.isSafeInteger(limits.maxMetadataBytes) || limits.maxMetadataBytes < 1
  ) throw new TypeError("Invalid subject export limits.");

  const entities: ExportManifest["entities"] = [];
  const excluded: ExportManifest["excluded"] = [];
  const redacted: ExportManifest["redacted"] = [];
  const checksums: Record<string, string> = {};
  let metadataBytes = 0;
  await db.transaction(async (tx) => {
    await tx.execute(sql`set transaction isolation level repeatable read, read only`);
    for (const table of Object.keys(DATA_RIGHTS_REGISTRY).sort()) {
      checkAbort(options.signal);
      const entry = DATA_RIGHTS_REGISTRY[table]!;
      if (!isExported(entry)) {
        excluded.push({ table, kind: entry.kind, reason: "reason" in entry ? entry.reason : "" });
        continue;
      }

      // The preflight returns only a boolean and executes in the same snapshot.
      // `table` is drawn exclusively from the checked-in registry.
      const oversized = await tx.execute(buildRowLimitPreflightQuery(table, subject, limits.maxRowBytes));
      if ((oversized.rows[0] as { oversized?: boolean } | undefined)?.oversized)
        throw new SubjectExportLimitError("row");

      const cursor = `subject_export_${entities.length}`;
      await tx.execute(sql`declare ${sql.identifier(cursor)} no scroll cursor for
        select * from ${sql.identifier(table)} where ${rowFilter(table, subject)} order by 1`);
      let count = 0;
      let fileBytes = 0;
      const hash = createHash("sha256");
      async function* chunks(): AsyncIterable<Uint8Array> {
        const emit = (text: string): Uint8Array => {
          const bytes = asBytes(text);
          fileBytes += bytes.byteLength;
          metadataBytes += bytes.byteLength;
          if (metadataBytes > limits.maxMetadataBytes) throw new SubjectExportLimitError("metadata");
          hash.update(bytes);
          return bytes;
        };
        yield emit("[\n");
        let first = true;
        try {
          for (;;) {
            checkAbort(options.signal);
            const result = await tx.execute(sql`fetch forward ${sql.raw(String(limits.fetchRows))} from ${sql.identifier(cursor)}`);
            const rows = result.rows as Record<string, unknown>[];
            if (rows.length === 0) break;
            for (const raw of rows) {
              checkAbort(options.signal);
              const serialized = json(serializeExportRow(table, entry, raw));
              // Count the exact emitted row representation before yielding it.
              const part = `${first ? "" : ",\n"}  ${serialized.replace(/\n/g, "\n  ")}`;
              const rowSize = asBytes(part).byteLength;
              if (rowSize > limits.maxRowBytes) throw new SubjectExportLimitError("row");
              yield emit(part);
              first = false;
              count++;
            }
          }
        } finally {
          await tx.execute(sql`close ${sql.identifier(cursor)}`);
        }
        yield emit("\n]\n");
      }
      const path = `entities/${table}.json`;
      await sink.write(path, chunks());
      checksums[path] = hash.digest("hex");
      entities.push({ table, rows: count, files: [path] });
      const columns = exportRedactedColumns(table, entry);
      if (columns.length) redacted.push({ table, columns });
    }
  });

  checkAbort(options.signal);
  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    generatedAt: (options.now ?? new Date()).toISOString(),
    subject: { userId: subject.userId, organizationIds: [...subject.organizationIds] },
    entities,
    excluded,
    redacted,
    checksums,
  };
  const manifestBytes = asBytes(`${json(manifest)}\n`);
  if (metadataBytes + manifestBytes.byteLength > limits.maxMetadataBytes)
    throw new SubjectExportLimitError("metadata");
  await sink.write("manifest.json", (async function* () { yield manifestBytes; })());
  return manifest;
}
