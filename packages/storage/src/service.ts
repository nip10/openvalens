/**
 * Tenant-scoped object storage service (Issue #62).
 *
 * This is the API feature code uses (#85 progress photos, #132 clinical PDF
 * export, #89 export bundles). It wraps one {@link ObjectStorage} adapter and
 * the `stored_object` metadata table:
 *
 * - Every call takes the `organizationId` the caller has already authorized
 *   (derived from the session, never from client input) and only ever touches
 *   that organization's rows and keys. An object id from another organization
 *   behaves exactly like a missing one.
 * - Uploads are checked against the purpose's content-type allowlist and the
 *   size cap before anything is written, hashed (SHA-256) and stored under an
 *   opaque key (`keys.ts`).
 * - Downloads are a short-lived signed URL: an S3 presigned URL, or the
 *   server's HMAC-signed local route (`signed-url.ts`). There are no public
 *   URLs.
 *
 * The service does not check RBAC itself: callers resolve the purpose's
 * `resource` (see `PURPOSE_POLICIES`) with `requirePermission` first.
 */

import { createHash } from "node:crypto";

import type { Database } from "@openvalens/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { photoCleanupIntent, storedObject } from "@openvalens/db/schema/storage";

import { buildObjectKey, newObjectId, READINESS_PROBE_KEY } from "./keys";
import { StorageError, type ObjectStorage, type StorageStoreIdentity } from "./object-storage";
import {
  isStoredObjectPurpose,
  normalizeContentType,
  PURPOSE_POLICIES,
  type StoredObjectPurpose,
} from "./purposes";
import { createLocalSignedPath, verifyLocalSignedPath } from "./signed-url";

export type StoredObjectRecord = {
  id: string;
  organizationId: string;
  createdByUserId: string | null;
  purpose: StoredObjectPurpose;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: Date;
};

export type ObjectBody = Uint8Array | ArrayBuffer | Blob | ReadableStream<Uint8Array>;

export type PutObjectInput = {
  organizationId: string;
  /** The authenticated uploader. */
  createdByUserId: string;
  purpose: StoredObjectPurpose;
  contentType: string;
  body: ObjectBody;
};

export type ObjectRef = { organizationId: string; objectId: string };
export type PhotoRef = ObjectRef & { createdByUserId: string };
export type PhotoLinkCallback = (
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  object: StoredObjectRecord,
) => Promise<void>;

export type DownloadUrl = {
  /** Absolute (S3 presigned) or server-relative (local signed route) URL. */
  url: string;
  expiresAt: Date;
};

export type StorageProbeResult = "ok" | "unwritable";
export type PhotoCleanupReport = {
  scanned: number;
  deleted: number;
  pending: number;
  blocked: number;
  skipped: number;
  failed: number;
};

export interface StorageService {
  /** Stable provider id of the bound adapter (`"local"` or `"s3"`). */
  readonly provider: string;
  readonly storeIdentity: StorageStoreIdentity | null;
  readonly maxObjectBytes: number;
  putObject(input: PutObjectInput): Promise<StoredObjectRecord>;
  reservePhoto(input: {
    organizationId: string;
    createdByUserId: string;
    contentType: string;
    canonicalBytes: Uint8Array;
  }): Promise<PhotoRef>;
  writePhoto(input: {
    ref: PhotoRef;
    bytes: Uint8Array;
    linkPhoto: PhotoLinkCallback;
  }): Promise<StoredObjectRecord>;
  deletePhoto(ref: PhotoRef): Promise<"deleted" | "pending" | "not_found">;
  cleanupPhotos(input?: { limit?: number }): Promise<PhotoCleanupReport>;
  findObject(ref: ObjectRef): Promise<StoredObjectRecord | null>;
  getObject(ref: ObjectRef): Promise<{
    object: StoredObjectRecord;
    body: ReadableStream<Uint8Array>;
  } | null>;
  /**
   * Subject-scoped progress-photo read for trusted server callers (#89 photo
   * export). The caller supplies the subject; there is no session check here.
   * Only a managed, ready/settled photo uploaded by that subject and bound to
   * the configured store is returned. Every other case (missing, another
   * uploader, legacy/unmanaged, hidden, deleting, store mismatch) is `null`
   * with no adapter I/O.
   */
  getSubjectPhoto(input: {
    subjectUserId: string;
    objectId: string;
  }): Promise<{ object: StoredObjectRecord; body: ReadableStream<Uint8Array> } | null>;
  listObjects(input: {
    organizationId: string;
    purpose?: StoredObjectPurpose;
    limit?: number;
  }): Promise<StoredObjectRecord[]>;
  /** Removes the bytes, then the metadata row. Returns `false` when not found. */
  deleteObject(ref: ObjectRef): Promise<"deleted" | "pending" | "not_found">;
  /** Internal delete-path metadata lookup, including logically hidden photos. */
  findObjectForDeletion(ref: ObjectRef): Promise<StoredObjectRecord | null>;
  createDownloadUrl(ref: ObjectRef, expiresInSeconds?: number): Promise<DownloadUrl | null>;
  /** Serves a local signed download path (`GET /api/storage/objects/:id?e=&s=`). */
  serveSignedDownload(url: URL): Promise<Response>;
  /** Storage keys of every object in these organizations (for subject erasure, #89). */
  collectOrganizationKeys(organizationIds: readonly string[]): Promise<string[]>;
  /** Deletes raw keys (after their metadata rows are gone). Never throws. */
  deleteKeys(keys: readonly string[]): Promise<{ deleted: number; failed: number }>;
  /** Write/read/delete round trip on a reserved key; cached briefly. */
  probe(): Promise<StorageProbeResult>;
}

export type StorageServiceOptions = {
  db: Database;
  storage: ObjectStorage;
  maxObjectBytes: number;
  signedUrlTtlSeconds: number;
  /** HMAC key for local signed URLs (see `deriveStorageSigningKey`). */
  signingKey: Buffer;
  now?: () => Date;
  /** How long a probe result is reused. Defaults to 30 seconds. */
  probeCacheMs?: number;
};

const SECURITY_HEADERS = {
  "cache-control": "private, no-store",
  "content-disposition": "attachment",
  "content-security-policy": "default-src 'none'; sandbox",
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-origin",
} as const;

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Reads a body into memory, refusing anything over `limit` bytes. */
async function readBounded(body: ObjectBody, limit: number): Promise<Uint8Array> {
  if (body instanceof Uint8Array) {
    if (body.byteLength > limit) throw new StorageError("too_large", 0);
    return body;
  }
  if (body instanceof ArrayBuffer) {
    if (body.byteLength > limit) throw new StorageError("too_large", 0);
    return new Uint8Array(body);
  }
  if (body instanceof Blob) {
    if (body.size > limit) throw new StorageError("too_large", 0);
    return new Uint8Array(await body.arrayBuffer());
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new StorageError("too_large", 0);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function toRecord(row: typeof storedObject.$inferSelect): StoredObjectRecord {
  if (!isStoredObjectPurpose(row.purpose)) throw new StorageError("integrity", 0);
  return {
    id: row.id,
    organizationId: row.organizationId,
    createdByUserId: row.createdByUserId,
    purpose: row.purpose,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    createdAt: row.createdAt,
  };
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

/**
 * Storage keys of every object in these organizations. Usable without a bound
 * adapter, so subject erasure (#89) can refuse to run when objects exist but
 * storage is off, instead of orphaning their bytes.
 */
export async function collectStoredObjectKeys(
  db: Database,
  organizationIds: readonly string[],
): Promise<string[]> {
  if (organizationIds.length === 0) return [];
  const rows = await db
    .select({ storageKey: storedObject.storageKey })
    .from(storedObject)
    .where(inArray(storedObject.organizationId, [...organizationIds]));
  return rows.map((row) => row.storageKey);
}

export function createStorageService(options: StorageServiceOptions): StorageService {
  const { db, storage, maxObjectBytes, signedUrlTtlSeconds, signingKey } = options;
  const now = options.now ?? (() => new Date());
  const probeCacheMs = options.probeCacheMs ?? 30_000;
  let probeCache: { at: number; result: StorageProbeResult } | null = null;

  async function findRow(ref: ObjectRef) {
    const [row] = await db
      .select()
      .from(storedObject)
      .where(
        and(eq(storedObject.id, ref.objectId), eq(storedObject.organizationId, ref.organizationId)),
      )
      .limit(1);
    return row ?? null;
  }

  async function findPhotoRow(ref: PhotoRef) {
    const [row] = await db
      .select()
      .from(storedObject)
      .where(
        and(
          eq(storedObject.id, ref.objectId),
          eq(storedObject.organizationId, ref.organizationId),
          eq(storedObject.createdByUserId, ref.createdByUserId),
          eq(storedObject.purpose, "progress_photo"),
          eq(storedObject.storageProvider, storage.storeIdentity?.provider ?? ""),
          eq(storedObject.storageStoreId, storage.storeIdentity?.storeId ?? ""),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async function findObject(ref: ObjectRef): Promise<StoredObjectRecord | null> {
    const row = await findRow(ref);
    return row && row.photoDeletionRequestedAt === null && isReadable(row) ? toRecord(row) : null;
  }

  async function findObjectForDeletion(ref: ObjectRef): Promise<StoredObjectRecord | null> {
    const row = await findRow(ref);
    return row ? toRecord(row) : null;
  }

  async function getSubjectPhoto(input: {
    subjectUserId: string;
    objectId: string;
  }): Promise<{ object: StoredObjectRecord; body: ReadableStream<Uint8Array> } | null> {
    const [row] = await db
      .select()
      .from(storedObject)
      .where(
        and(
          eq(storedObject.id, input.objectId),
          eq(storedObject.createdByUserId, input.subjectUserId),
          eq(storedObject.purpose, "progress_photo"),
        ),
      )
      .limit(1);
    if (!row) return null;
    // Generic isReadable() accepts legacy rows (NULL lifecycle identity) for
    // compatibility. Subject photo export is stricter: legacy provenance is
    // unknown, so it is unavailable here.
    if (row.photoDeletionRequestedAt !== null) return null;
    if (!row.storageProvider || !row.storageStoreId) return null;
    if (row.photoState !== "ready" || row.photoWriteState !== "settled") return null;
    if (
      row.storageProvider !== storage.storeIdentity?.provider ||
      row.storageStoreId !== storage.storeIdentity?.storeId
    )
      return null;
    const blob = await storage.get(row.storageKey);
    if (!blob) return null;
    return { object: toRecord(row), body: blob.body };
  }

  function isReadable(row: typeof storedObject.$inferSelect): boolean {
    if (row.photoDeletionRequestedAt !== null) return false;
    if (row.photoState === null) return true;
    if (
      row.storageProvider !== storage.storeIdentity?.provider ||
      row.storageStoreId !== storage.storeIdentity?.storeId
    ) {
      throw new StorageError("unavailable", 0);
    }
    return row.photoState === "ready";
  }

  async function recordCleanup(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    row: typeof storedObject.$inferSelect,
    writeState: "not_started" | "uncertain" | "settled",
  ): Promise<void> {
    await tx
      .insert(photoCleanupIntent)
      .values({
        id: row.id,
        storageKey: row.storageKey,
        storageProvider: row.storageProvider,
        storageStoreId: row.storageStoreId,
        subjectUserId: row.createdByUserId,
        organizationId: row.organizationId,
        writeState,
        createdAt: now(),
        nextAttemptAt: now(),
      })
      .onConflictDoUpdate({
        target: photoCleanupIntent.storageKey,
        set: {
          writeState: sql`case when ${photoCleanupIntent.writeState} = 'uncertain' or excluded.write_state = 'uncertain' then 'uncertain' when ${photoCleanupIntent.writeState} = 'settled' or excluded.write_state = 'settled' then 'settled' else 'not_started' end`,
        },
      });
  }

  async function setPhotoFailure(
    ref: PhotoRef,
    expected: "not_started" | "uncertain",
    state: "not_started" | "uncertain" | "settled",
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(storedObject)
        .set({ photoState: "deleting", photoWriteState: state })
        .where(
          and(
            eq(storedObject.id, ref.objectId),
            eq(storedObject.organizationId, ref.organizationId),
            eq(storedObject.createdByUserId, ref.createdByUserId),
            eq(storedObject.purpose, "progress_photo"),
            eq(storedObject.storageProvider, storage.storeIdentity?.provider ?? ""),
            eq(storedObject.storageStoreId, storage.storeIdentity?.storeId ?? ""),
            eq(storedObject.photoState, "pending"),
            eq(storedObject.photoWriteState, expected),
          ),
        )
        .returning();
      if (row) await recordCleanup(tx, row, state);
    });
  }

  function backoff(attempts: number): Date {
    const seconds = Math.min(3600, 2 ** Math.min(attempts, 12));
    return new Date(now().getTime() + seconds * 1000);
  }

  function pgCode(error: unknown): string | undefined {
    const value = error as { code?: string; cause?: { code?: string; cause?: { code?: string } } };
    return value?.code ?? value?.cause?.code ?? value?.cause?.cause?.code;
  }

  async function lockRowNowait(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    id: string,
  ) {
    const result = await tx.execute(
      sql`select id from stored_object where id = ${id} for update nowait`,
    );
    return result.rows.length > 0;
  }

  async function cleanupOne(
    id: string,
  ): Promise<"deleted" | "pending" | "blocked" | "skipped" | "missing" | "failed"> {
    try {
      return await db.transaction(async (tx) => {
        // Always acquire object before intent; a locked live publisher is skipped, never interpreted as absent.
        const objectExists = await lockRowNowait(tx, id);
        await tx.execute(
          sql`select id from photo_cleanup_intent where id = ${id} for update nowait`,
        );
        const [intent] = await tx
          .select()
          .from(photoCleanupIntent)
          .where(eq(photoCleanupIntent.id, id))
          .limit(1);
        if (!intent) return "missing";
        if (intent.nextAttemptAt > now()) return "skipped";
        const [row] = objectExists
          ? await tx.select().from(storedObject).where(eq(storedObject.id, id)).limit(1)
          : [undefined];
        if (
          row &&
          (row.storageKey !== intent.storageKey ||
            row.organizationId !== intent.organizationId ||
            row.storageProvider !== intent.storageProvider ||
            row.storageStoreId !== intent.storageStoreId)
        ) {
          await tx
            .update(photoCleanupIntent)
            .set({
              attempts: sql`${photoCleanupIntent.attempts} + 1`,
              lastAttemptAt: now(),
              nextAttemptAt: backoff(intent.attempts),
            })
            .where(eq(photoCleanupIntent.id, id));
          return "blocked";
        }
        if (
          !intent.storageProvider ||
          !intent.storageStoreId ||
          intent.storageProvider !== storage.storeIdentity?.provider ||
          intent.storageStoreId !== storage.storeIdentity?.storeId
        ) {
          await tx
            .update(photoCleanupIntent)
            .set({
              attempts: sql`${photoCleanupIntent.attempts} + 1`,
              lastAttemptAt: now(),
              nextAttemptAt: backoff(intent.attempts),
            })
            .where(eq(photoCleanupIntent.id, id));
          return "blocked";
        }
        if (row && row.purpose === "progress_photo" && row.photoState !== "deleting") {
          await tx
            .update(storedObject)
            .set({ photoState: "deleting" })
            .where(eq(storedObject.id, id));
        }
        try {
          if (intent.storageProvider === "local") {
            if (!storage.deleteWithStaging) throw new StorageError("unavailable", 0);
            await storage.deleteWithStaging(intent.storageKey, intent.id);
          } else await storage.delete(intent.storageKey);
        } catch {
          await tx
            .update(photoCleanupIntent)
            .set({
              attempts: sql`${photoCleanupIntent.attempts} + 1`,
              lastAttemptAt: now(),
              nextAttemptAt: backoff(intent.attempts),
            })
            .where(eq(photoCleanupIntent.id, id));
          return "failed";
        }
        if (intent.writeState === "uncertain") {
          if (row) await tx.delete(storedObject).where(eq(storedObject.id, id));
          await tx
            .update(photoCleanupIntent)
            .set({
              attempts: sql`${photoCleanupIntent.attempts} + 1`,
              lastAttemptAt: now(),
              nextAttemptAt: backoff(intent.attempts),
            })
            .where(eq(photoCleanupIntent.id, id));
          return "pending";
        }
        if (row) await tx.delete(storedObject).where(eq(storedObject.id, id));
        await tx.delete(photoCleanupIntent).where(eq(photoCleanupIntent.id, id));
        return "deleted";
      });
    } catch (error) {
      if (pgCode(error) === "55P03") return "skipped";
      await db
        .update(photoCleanupIntent)
        .set({
          attempts: sql`${photoCleanupIntent.attempts} + 1`,
          lastAttemptAt: now(),
          nextAttemptAt: backoff(0),
        })
        .where(eq(photoCleanupIntent.id, id))
        .catch(() => undefined);
      return "failed";
    }
  }

  async function sweepAbandonedPending(
    limit: number,
  ): Promise<{ candidates: number; skipped: number; failed: number }> {
    const cutoff = new Date(now().getTime() - 10 * 60_000);
    const candidates = await db
      .select({ id: storedObject.id })
      .from(storedObject)
      .where(
        and(
          eq(storedObject.purpose, "progress_photo"),
          eq(storedObject.photoState, "pending"),
          sql`${storedObject.createdAt} < ${cutoff}`,
        ),
      )
      .orderBy(storedObject.createdAt)
      .limit(limit);
    let skipped = 0;
    let failed = 0;
    for (const { id } of candidates) {
      try {
        await db.transaction(async (tx) => {
          if (!(await lockRowNowait(tx, id))) return;
          const [row] = await tx
            .select()
            .from(storedObject)
            .where(eq(storedObject.id, id))
            .limit(1);
          if (!row || row.purpose !== "progress_photo" || row.photoState !== "pending") return;
          const state = row.photoWriteState === "not_started" ? "not_started" : "uncertain";
          const [updated] = await tx
            .update(storedObject)
            .set({ photoState: "deleting" })
            .where(and(eq(storedObject.id, row.id), eq(storedObject.photoState, "pending")))
            .returning();
          if (updated) await recordCleanup(tx, updated, state);
        });
      } catch (error) {
        if (pgCode(error) === "55P03") skipped += 1;
        else failed += 1;
      }
    }
    return { candidates: candidates.length, skipped, failed };
  }

  async function cleanupPhotos(input: { limit?: number } = {}): Promise<PhotoCleanupReport> {
    const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 25)));
    const swept = await sweepAbandonedPending(Math.max(1, Math.floor(limit / 2)));
    const dueLimit = Math.max(0, limit - swept.candidates);
    const due = await db
      .select({ id: photoCleanupIntent.id })
      .from(photoCleanupIntent)
      .where(sql`${photoCleanupIntent.nextAttemptAt} <= ${now()}`)
      .orderBy(photoCleanupIntent.nextAttemptAt)
      .limit(dueLimit);
    const report: PhotoCleanupReport = {
      scanned: swept.candidates + due.length,
      deleted: 0,
      pending: 0,
      blocked: 0,
      skipped: swept.skipped,
      failed: swept.failed,
    };
    for (const { id } of due) {
      const result = await cleanupOne(id);
      if (result === "deleted") report.deleted += 1;
      else if (result === "pending") report.pending += 1;
      else if (result === "blocked") report.blocked += 1;
      else if (result === "skipped") report.skipped += 1;
      else if (result === "failed") report.failed += 1;
    }
    return report;
  }

  async function deletePhoto(ref: PhotoRef): Promise<"deleted" | "pending" | "not_found"> {
    const row = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(storedObject)
        .where(
          and(
            eq(storedObject.id, ref.objectId),
            eq(storedObject.organizationId, ref.organizationId),
            eq(storedObject.createdByUserId, ref.createdByUserId),
            eq(storedObject.purpose, "progress_photo"),
          ),
        )
        .for("update");
      if (!locked) {
        const [intent] = await tx
          .select()
          .from(photoCleanupIntent)
          .where(
            and(
              eq(photoCleanupIntent.id, ref.objectId),
              eq(photoCleanupIntent.organizationId, ref.organizationId),
              eq(photoCleanupIntent.subjectUserId, ref.createdByUserId),
            ),
          )
          .limit(1);
        return intent ? ("pending" as const) : null;
      }
      if (locked.photoState === null) {
        await tx
          .update(storedObject)
          .set({ photoDeletionRequestedAt: locked.photoDeletionRequestedAt ?? now() })
          .where(
            and(
              eq(storedObject.id, locked.id),
              eq(storedObject.organizationId, ref.organizationId),
              eq(storedObject.createdByUserId, ref.createdByUserId),
            ),
          );
        await recordCleanup(
          tx,
          { ...locked, storageProvider: null, storageStoreId: null },
          "uncertain",
        );
        return "pending" as const;
      }
      const [deleting] = await tx
        .update(storedObject)
        .set({ photoState: "deleting" })
        .where(
          and(
            eq(storedObject.id, locked.id),
            eq(storedObject.organizationId, ref.organizationId),
            eq(storedObject.createdByUserId, ref.createdByUserId),
            eq(storedObject.photoState, locked.photoState),
          ),
        )
        .returning();
      if (deleting)
        await recordCleanup(
          tx,
          deleting,
          deleting.photoWriteState === "uncertain"
            ? "uncertain"
            : deleting.photoWriteState === "not_started"
              ? "not_started"
              : "settled",
        );
      return deleting ? ("pending" as const) : null;
    });
    if (row === null) return "not_found";
    if (row === "pending") {
      // A matching active store gets one immediate attempt; mismatch/unknown provenance stays pending.
      const [intent] = await db
        .select()
        .from(photoCleanupIntent)
        .where(eq(photoCleanupIntent.id, ref.objectId))
        .limit(1);
      if (!intent) return "pending";
      const result = await cleanupOne(ref.objectId);
      return result === "deleted" ? "deleted" : "pending";
    }
    return "pending";
  }

  const service: StorageService = {
    provider: storage.provider,
    storeIdentity: storage.storeIdentity ?? null,
    maxObjectBytes,

    async reservePhoto(input) {
      const contentType = normalizeContentType(input.contentType);
      if (!storage.storeIdentity || !["image/jpeg", "image/png"].includes(contentType))
        throw new StorageError("unsupported_type", 0);
      if (input.canonicalBytes.byteLength === 0) throw new StorageError("integrity", 0);
      if (input.canonicalBytes.byteLength > maxObjectBytes) throw new StorageError("too_large", 0);
      const id = newObjectId();
      const key = buildObjectKey(input.organizationId, id);
      const digest = sha256Hex(input.canonicalBytes);
      await db.insert(storedObject).values({
        id,
        organizationId: input.organizationId,
        createdByUserId: input.createdByUserId,
        purpose: "progress_photo",
        storageKey: key,
        contentType,
        sizeBytes: input.canonicalBytes.byteLength,
        sha256: digest,
        storageProvider: storage.storeIdentity.provider,
        storageStoreId: storage.storeIdentity.storeId,
        photoState: "pending",
        photoWriteState: "not_started",
        createdAt: now(),
      });
      return {
        organizationId: input.organizationId,
        objectId: id,
        createdByUserId: input.createdByUserId,
      };
    },

    async writePhoto({ ref, bytes, linkPhoto }) {
      const reserved = await findPhotoRow(ref);
      if (!reserved) throw new StorageError("unavailable", 0);
      let actual: Uint8Array;
      try {
        actual = await readBounded(bytes, maxObjectBytes);
      } catch (error) {
        await setPhotoFailure(ref, "not_started", "not_started");
        throw error;
      }
      const digest = sha256Hex(actual);
      if (
        reserved.purpose !== "progress_photo" ||
        reserved.photoState !== "pending" ||
        reserved.photoWriteState !== "not_started" ||
        reserved.createdByUserId !== ref.createdByUserId ||
        reserved.sizeBytes !== actual.byteLength ||
        reserved.sha256 !== digest ||
        reserved.storageProvider !== storage.storeIdentity?.provider ||
        reserved.storageStoreId !== storage.storeIdentity?.storeId
      ) {
        if (reserved?.photoState === "pending" && reserved.photoWriteState === "not_started")
          await setPhotoFailure(ref, "not_started", "not_started");
        throw new StorageError("unavailable", 0);
      }
      // Lock parent then object and transition to uncertain before touching storage.
      const armed = await db.transaction(async (tx) => {
        await tx.execute(sql`select id from "user" where id = ${ref.createdByUserId} for update`);
        await tx.execute(
          sql`select id from organization where id = ${ref.organizationId} for update`,
        );
        const [row] = await tx
          .select()
          .from(storedObject)
          .where(
            and(
              eq(storedObject.id, ref.objectId),
              eq(storedObject.organizationId, ref.organizationId),
              eq(storedObject.createdByUserId, ref.createdByUserId),
              eq(storedObject.purpose, "progress_photo"),
              eq(storedObject.storageProvider, storage.storeIdentity?.provider ?? ""),
              eq(storedObject.storageStoreId, storage.storeIdentity?.storeId ?? ""),
            ),
          )
          .for("update");
        if (
          !row ||
          row.createdByUserId !== ref.createdByUserId ||
          row.purpose !== "progress_photo" ||
          row.createdByUserId === null ||
          row.photoState !== "pending" ||
          row.photoWriteState !== "not_started" ||
          row.storageProvider !== storage.storeIdentity?.provider ||
          row.storageStoreId !== storage.storeIdentity?.storeId ||
          row.sizeBytes !== actual.byteLength ||
          row.sha256 !== digest
        )
          throw new StorageError("unavailable", 0);
        const [updated] = await tx
          .update(storedObject)
          .set({ photoWriteState: "uncertain" })
          .where(
            and(
              eq(storedObject.id, ref.objectId),
              eq(storedObject.organizationId, ref.organizationId),
              eq(storedObject.createdByUserId, ref.createdByUserId),
              eq(storedObject.purpose, "progress_photo"),
              eq(storedObject.storageProvider, storage.storeIdentity.provider),
              eq(storedObject.storageStoreId, storage.storeIdentity.storeId),
              eq(storedObject.photoState, "pending"),
              eq(storedObject.photoWriteState, "not_started"),
            ),
          )
          .returning();
        return updated ?? null;
      });
      if (!armed) throw new StorageError("unavailable", 0);
      let putStarted = false;
      let acknowledged = false;
      try {
        return await db.transaction(async (tx) => {
          await tx.execute(
            sql`select id from "user" where id = ${armed.createdByUserId} for update`,
          );
          await tx.execute(
            sql`select id from organization where id = ${armed.organizationId} for update`,
          );
          const [row] = await tx
            .select()
            .from(storedObject)
            .where(
              and(
                eq(storedObject.id, ref.objectId),
                eq(storedObject.organizationId, ref.organizationId),
                eq(storedObject.createdByUserId, ref.createdByUserId),
                eq(storedObject.purpose, "progress_photo"),
                eq(storedObject.storageProvider, storage.storeIdentity?.provider ?? ""),
                eq(storedObject.storageStoreId, storage.storeIdentity?.storeId ?? ""),
              ),
            )
            .for("update");
          if (
            !row ||
            row.createdByUserId !== ref.createdByUserId ||
            row.organizationId !== ref.organizationId ||
            row.photoState !== "pending" ||
            row.photoWriteState !== "uncertain" ||
            row.sizeBytes !== actual.byteLength ||
            row.sha256 !== digest ||
            row.storageProvider !== storage.storeIdentity?.provider ||
            row.storageStoreId !== storage.storeIdentity?.storeId
          )
            throw new StorageError("unavailable", 0);
          // Consent/member validation and metadata linking run before any PUT.
          const record = toRecord(row);
          await linkPhoto(tx, record);
          // Hold parent and object locks through bounded PUT and ready activation.
          putStarted = true;
          await storage.put(row.storageKey, actual, {
            contentType: row.contentType,
            sha256: row.sha256,
            stagingId: row.id,
          });
          acknowledged = true;
          const [ready] = await tx
            .update(storedObject)
            .set({ photoState: "ready", photoWriteState: "settled" })
            .where(
              and(
                eq(storedObject.id, row.id),
                eq(storedObject.photoState, "pending"),
                eq(storedObject.photoWriteState, "uncertain"),
              ),
            )
            .returning();
          if (!ready) throw new StorageError("unavailable", 0);
          return toRecord(ready);
        });
      } catch (error) {
        await setPhotoFailure(
          ref,
          "uncertain",
          acknowledged ? "settled" : putStarted ? "uncertain" : "not_started",
        );
        throw error;
      }
    },

    async putObject(input: PutObjectInput): Promise<StoredObjectRecord> {
      if (input.purpose === "progress_photo") throw new StorageError("unavailable", 0);
      const policy = PURPOSE_POLICIES[input.purpose];
      if (!policy) throw new StorageError("unsupported_type", 0);
      const contentType = normalizeContentType(input.contentType);
      if (!policy.contentTypes.includes(contentType)) throw new StorageError("unsupported_type", 0);

      const bytes = await readBounded(input.body, maxObjectBytes);
      const id = newObjectId();
      const key = buildObjectKey(input.organizationId, id);
      const sha256 = sha256Hex(bytes);

      await storage.put(key, bytes, { contentType, sha256 });
      try {
        const [row] = await db
          .insert(storedObject)
          .values({
            id,
            organizationId: input.organizationId,
            createdByUserId: input.createdByUserId,
            purpose: input.purpose,
            storageKey: key,
            contentType,
            sizeBytes: bytes.byteLength,
            sha256,
            createdAt: now(),
          })
          .returning();
        return toRecord(row!);
      } catch (error) {
        // No metadata row means nobody can reach the bytes; remove them too.
        await storage.delete(key).catch(() => undefined);
        throw error;
      }
    },

    findObject,
    findObjectForDeletion,
    getSubjectPhoto,

    async getObject(ref: ObjectRef) {
      const row = await findRow(ref);
      if (!row || !isReadable(row)) return null;
      const blob = await storage.get(row.storageKey);
      if (!blob) return null;
      return { object: toRecord(row), body: blob.body };
    },

    deletePhoto,

    cleanupPhotos,

    async listObjects({ organizationId, purpose, limit = 100 }) {
      const rows = await db
        .select()
        .from(storedObject)
        .where(
          purpose
            ? and(
                eq(storedObject.organizationId, organizationId),
                eq(storedObject.purpose, purpose),
              )
            : eq(storedObject.organizationId, organizationId),
        )
        .orderBy(desc(storedObject.createdAt))
        .limit(Math.min(Math.max(1, limit), 500));
      return rows.filter(isReadable).map(toRecord);
    },

    async deleteObject(ref: ObjectRef): Promise<"deleted" | "pending" | "not_found"> {
      const row = await findRow(ref);
      if (!row) return "not_found";
      if (row.purpose === "progress_photo") {
        if (!row.createdByUserId) return "pending";
        const result = await deletePhoto({ ...ref, createdByUserId: row.createdByUserId });
        return result;
      }
      // Bytes first: if the row delete then fails, the row points at nothing,
      // which is safer than an unindexed object that erasure can never find.
      await storage.delete(row.storageKey);
      await db
        .delete(storedObject)
        .where(
          and(eq(storedObject.id, row.id), eq(storedObject.organizationId, ref.organizationId)),
        );
      return "deleted";
    },

    async createDownloadUrl(ref: ObjectRef, expiresInSeconds = signedUrlTtlSeconds) {
      const ttl = Math.min(Math.max(1, Math.floor(expiresInSeconds)), signedUrlTtlSeconds);
      const row = await findRow(ref);
      if (!row || !isReadable(row)) return null;
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + ttl * 1000);
      const native = await storage.signedGetUrl(row.storageKey, {
        expiresInSeconds: ttl,
        contentType: row.contentType,
      });
      return {
        url: native ?? createLocalSignedPath(signingKey, row.id, ttl, issuedAt),
        expiresAt,
      };
    },

    async serveSignedDownload(url: URL): Promise<Response> {
      const verdict = verifyLocalSignedPath(signingKey, url, now());
      if (!verdict.ok) return jsonError(403, "INVALID_SIGNATURE");
      const [row] = await db
        .select()
        .from(storedObject)
        .where(eq(storedObject.id, verdict.objectId))
        .limit(1);
      if (!row) return jsonError(404, "NOT_FOUND");
      if (!isReadable(row)) return jsonError(404, "NOT_FOUND");
      const blob = await storage.get(row.storageKey);
      if (!blob) return jsonError(404, "NOT_FOUND");
      return new Response(blob.body, {
        status: 200,
        headers: {
          ...SECURITY_HEADERS,
          "content-type": row.contentType,
          "content-length": String(row.sizeBytes),
        },
      });
    },

    collectOrganizationKeys: (organizationIds: readonly string[]) =>
      collectStoredObjectKeys(db, organizationIds),

    async deleteKeys(keys: readonly string[]) {
      let deleted = 0;
      let failed = 0;
      for (const key of keys) {
        try {
          await storage.delete(key);
          deleted += 1;
        } catch {
          failed += 1;
        }
      }
      return { deleted, failed };
    },

    async probe(): Promise<StorageProbeResult> {
      const at = now().getTime();
      if (probeCache && at - probeCache.at < probeCacheMs) return probeCache.result;
      let result: StorageProbeResult = "unwritable";
      try {
        const bytes = new TextEncoder().encode("ok");
        await storage.put(READINESS_PROBE_KEY, bytes, {
          contentType: "text/plain",
          sha256: sha256Hex(bytes),
        });
        const head = await storage.head(READINESS_PROBE_KEY);
        await storage.delete(READINESS_PROBE_KEY);
        if (head?.size === bytes.byteLength) result = "ok";
      } catch {
        // Any failure is "unwritable"; details stay out of the public probe.
      }
      probeCache = { at, result };
      return result;
    },
  };
  return Object.freeze(service);
}
