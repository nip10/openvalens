import { createHash } from "node:crypto";

import { sql, type Database } from "@openvalens/db";

import type { DataRightsSubject } from "./export";

/**
 * Canonical subject photo export (Issues #85/#89).
 *
 * This is the byte component of a subject export. The text export in
 * `export.ts` carries `stored_object` metadata only; it is not a substitute
 * for these photo bytes. The caller supplies the already-authorized subject
 * and a trusted reader bound to the configured object store. No HTTP/session
 * authorization happens here.
 *
 * Enumeration is a short read-only repeatable-read snapshot across all
 * memberships (a photo belongs to its uploader, not to the workspace owner).
 * The transaction releases before any object-store I/O. The generator then
 * reads one bounded file at a time, verifies its actual length and SHA-256
 * against the indexed metadata, and yields it. The manifest is last and is
 * marked `complete` only when every enumerated row was read and verified.
 *
 * This is a metadata/bytes snapshot, not an atomic database-plus-store
 * snapshot: a photo deleted or changed after enumeration becomes an explicit
 * `incomplete` failure instead of silently disappearing or being guessed.
 */

export const PHOTO_EXPORT_FORMAT = "openvalens-photo-export";
export const PHOTO_EXPORT_FORMAT_VERSION = 1;
export const PHOTO_MANIFEST_PATH = "photos/manifest.json" as const;

/** Indexed metadata needed to resolve and verify one photo. */
export type SubjectPhotoRecord = {
  id: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
};

export type SubjectPhoto = {
  object: SubjectPhotoRecord;
  body: ReadableStream<Uint8Array>;
};

/**
 * Narrow structural dependency for photo export. `StorageService` satisfies
 * it without this package depending on `@openvalens/storage`.
 */
export type SubjectPhotoReader = {
  /** Configured maximum bytes read for one photo. */
  readonly maxObjectBytes: number;
  getSubjectPhoto(input: { subjectUserId: string; objectId: string }): Promise<SubjectPhoto | null>;
};

export type PhotoExportFailureReason = "unavailable" | "read_failed" | "integrity";

export type PhotoExportManifestPhoto = {
  objectId: string;
  path: string;
  contentType: "image/jpeg" | "image/png";
  /** Actual bytes read from storage, not the indexed value. */
  sizeBytes: number;
  /** Lowercase hex SHA-256 of the actual bytes. */
  sha256: string;
};

export type PhotoExportManifest = {
  format: typeof PHOTO_EXPORT_FORMAT;
  formatVersion: typeof PHOTO_EXPORT_FORMAT_VERSION;
  subjectUserId: string;
  enumeratedAt: string;
  status: "complete" | "incomplete";
  photos: PhotoExportManifestPhoto[];
  /** Safe categories only; never a provider message, key or store identity. */
  failures: { objectId: string; reason: PhotoExportFailureReason }[];
};

export type PhotoExportFile =
  | {
      kind: "file";
      /** `photos/<validated opaque object id>.<jpg|png>`; never a user filename. */
      path: string;
      contentType: "image/jpeg" | "image/png";
      content: Uint8Array;
    }
  | {
      kind: "manifest";
      path: typeof PHOTO_MANIFEST_PATH;
      manifest: PhotoExportManifest;
    };

const PAGE_SIZE = 200;

/** Same canonical opaque id grammar as `@openvalens/storage/keys`. */
const OBJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const APPROVED_TYPES: Readonly<
  Record<string, { contentType: "image/jpeg" | "image/png"; ext: string }>
> = Object.freeze({
  "image/jpeg": { contentType: "image/jpeg", ext: "jpg" },
  "image/png": { contentType: "image/png", ext: "png" },
});

type Candidate = {
  objectId: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
};

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Reads one body into memory, refusing anything over `limit`. A stream error
 * is `read_failed`; an oversized body is `integrity` (the indexed object does
 * not match what the store returned).
 */
type ByteReader = {
  read(): Promise<{ done?: boolean; value?: Uint8Array }>;
  cancel(reason?: unknown): Promise<void>;
};

async function readBounded(
  body: ReadableStream<Uint8Array>,
  limit: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: "read_failed" | "integrity" }> {
  let reader: ByteReader;
  try {
    reader = body.getReader() as unknown as ByteReader;
  } catch {
    return { ok: false, reason: "read_failed" };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      const value = result.value;
      if (!value) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "read_failed" };
      }
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "integrity" };
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, reason: "read_failed" };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/**
 * All subject-created progress-photo rows across memberships, in stable
 * keyset order. Only safe metadata leaves the transaction; keys, provider
 * identity and lifecycle internals are never selected here.
 */
async function enumerateSubjectPhotos(db: Database, subjectUserId: string): Promise<Candidate[]> {
  return db.transaction(async (tx) => {
    // One consistent snapshot for every page; released before any byte I/O.
    await tx.execute(sql`set transaction isolation level repeatable read, read only`);
    const rows: Candidate[] = [];
    let lastId: string | null = null;
    for (;;) {
      const page = (
        await tx.execute(sql`
          select id, content_type, size_bytes, sha256
          from stored_object
          where purpose = 'progress_photo'
            and created_by_user_id = ${subjectUserId}
            ${lastId === null ? sql`` : sql`and id > ${lastId}`}
          order by id
          limit ${PAGE_SIZE}
        `)
      ).rows as {
        id: string;
        content_type: string;
        size_bytes: string | number;
        sha256: string;
      }[];
      for (const row of page) {
        rows.push({
          objectId: row.id,
          contentType: row.content_type,
          sizeBytes: Number(row.size_bytes),
          sha256: row.sha256,
        });
      }
      if (page.length < PAGE_SIZE) break;
      lastId = page[page.length - 1]!.id;
    }
    return rows;
  });
}

/**
 * Yields verified photo files, then exactly one manifest. If enumeration
 * throws, no manifest is produced. If the consumer cancels early, the
 * manifest is never reached — an export can only carry a `complete` marker
 * when the whole snapshot was processed.
 */
export async function* exportSubjectPhotoFiles(
  db: Database,
  reader: SubjectPhotoReader,
  subject: DataRightsSubject,
  now: Date = new Date(),
): AsyncGenerator<PhotoExportFile, void, unknown> {
  const candidates = await enumerateSubjectPhotos(db, subject.userId);
  const photos: PhotoExportManifestPhoto[] = [];
  const failures: PhotoExportManifest["failures"] = [];

  for (const candidate of candidates) {
    if (!OBJECT_ID.test(candidate.objectId)) {
      failures.push({ objectId: candidate.objectId, reason: "unavailable" });
      continue;
    }
    const approved = APPROVED_TYPES[candidate.contentType];
    if (!approved) {
      failures.push({ objectId: candidate.objectId, reason: "unavailable" });
      continue;
    }
    if (!Number.isSafeInteger(candidate.sizeBytes) || candidate.sizeBytes < 0) {
      failures.push({ objectId: candidate.objectId, reason: "integrity" });
      continue;
    }
    if (!SHA256.test(candidate.sha256)) {
      failures.push({ objectId: candidate.objectId, reason: "integrity" });
      continue;
    }

    let photo: SubjectPhoto | null;
    try {
      photo = await reader.getSubjectPhoto({
        subjectUserId: subject.userId,
        objectId: candidate.objectId,
      });
    } catch {
      failures.push({ objectId: candidate.objectId, reason: "read_failed" });
      continue;
    }
    if (!photo) {
      // Missing, hidden/deleted after enumeration, legacy provenance, wrong
      // subject or store mismatch all fail closed with no guessed result.
      failures.push({ objectId: candidate.objectId, reason: "unavailable" });
      continue;
    }
    // The reader must still resolve the same indexed object; a changed row is
    // never exported under the enumerated metadata.
    if (
      photo.object.id !== candidate.objectId ||
      photo.object.contentType !== candidate.contentType ||
      photo.object.sizeBytes !== candidate.sizeBytes ||
      photo.object.sha256 !== candidate.sha256
    ) {
      failures.push({ objectId: candidate.objectId, reason: "integrity" });
      continue;
    }

    const read = await readBounded(photo.body, reader.maxObjectBytes);
    if (!read.ok) {
      failures.push({ objectId: candidate.objectId, reason: read.reason });
      continue;
    }
    const actualSha256 = sha256Hex(read.bytes);
    if (read.bytes.byteLength !== candidate.sizeBytes || actualSha256 !== candidate.sha256) {
      failures.push({ objectId: candidate.objectId, reason: "integrity" });
      continue;
    }

    const path = `photos/${candidate.objectId}.${approved.ext}`;
    photos.push({
      objectId: candidate.objectId,
      path,
      contentType: approved.contentType,
      sizeBytes: read.bytes.byteLength,
      sha256: actualSha256,
    });
    yield {
      kind: "file",
      path,
      contentType: approved.contentType,
      content: read.bytes,
    };
  }

  yield {
    kind: "manifest",
    path: PHOTO_MANIFEST_PATH,
    manifest: {
      format: PHOTO_EXPORT_FORMAT,
      formatVersion: PHOTO_EXPORT_FORMAT_VERSION,
      subjectUserId: subject.userId,
      enumeratedAt: now.toISOString(),
      status: failures.length === 0 ? "complete" : "incomplete",
      photos,
      failures,
    },
  };
}
