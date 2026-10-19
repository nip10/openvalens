/**
 * Copies stored objects between two adapters (Issue #62), e.g. local disk to
 * S3 when an install moves to a bucket: `bun run storage:migrate` in
 * `apps/server`.
 *
 * - Driven by the `stored_object` metadata, so only indexed objects move.
 * - Every copy is verified: the source bytes must match the recorded SHA-256
 *   before upload, and the target is read back and hashed after.
 * - Idempotent: an object already present in the target with the recorded
 *   checksum is skipped, so a rerun after a partial failure only copies what
 *   is missing.
 * - `dryRun` reports what would be copied without writing anything.
 * - The source is never deleted.
 */

import { createHash } from "node:crypto";

import type { ObjectStorage } from "./object-storage";

export type MigrationItem = {
  id: string;
  storageKey: string;
  sha256: string;
  contentType: string;
  photoState?: string | null;
};

export type MigrationReport = {
  dryRun: boolean;
  total: number;
  /** Already in the target with a matching checksum. */
  skipped: number;
  /** Copied and verified (or, in a dry run, would be copied). */
  copied: number;
  /** Object ids that failed: missing or corrupt source, or a target mismatch. */
  failed: {
    id: string;
    reason: "source_missing" | "source_checksum" | "target_checksum" | "managed_photo" | "error";
  }[];
};

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function checksumOf(storage: ObjectStorage, key: string): Promise<string | null> {
  const blob = await storage.get(key);
  return blob ? sha256Hex(await readAll(blob.body)) : null;
}

export async function migrateObjects(input: {
  source: ObjectStorage;
  target: ObjectStorage;
  items: readonly MigrationItem[];
  dryRun: boolean;
}): Promise<MigrationReport> {
  const report: MigrationReport = {
    dryRun: input.dryRun,
    total: input.items.length,
    skipped: 0,
    copied: 0,
    failed: [],
  };

  for (const item of input.items) {
    if (item.photoState !== undefined && item.photoState !== null) {
      report.failed.push({ id: item.id, reason: "managed_photo" });
      continue;
    }
    try {
      if ((await checksumOf(input.target, item.storageKey)) === item.sha256) {
        report.skipped += 1;
        continue;
      }
      const blob = await input.source.get(item.storageKey);
      if (!blob) {
        report.failed.push({ id: item.id, reason: "source_missing" });
        continue;
      }
      const bytes = await readAll(blob.body);
      if (sha256Hex(bytes) !== item.sha256) {
        report.failed.push({ id: item.id, reason: "source_checksum" });
        continue;
      }
      if (input.dryRun) {
        report.copied += 1;
        continue;
      }
      await input.target.put(item.storageKey, bytes, {
        contentType: item.contentType,
        sha256: item.sha256,
      });
      if ((await checksumOf(input.target, item.storageKey)) !== item.sha256) {
        report.failed.push({ id: item.id, reason: "target_checksum" });
        continue;
      }
      report.copied += 1;
    } catch {
      report.failed.push({ id: item.id, reason: "error" });
    }
  }
  return report;
}
