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
import { and, desc, eq, inArray } from "drizzle-orm";
import { storedObject } from "@openvalens/db/schema/storage";

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

export type DownloadUrl = {
  /** Absolute (S3 presigned) or server-relative (local signed route) URL. */
  url: string;
  expiresAt: Date;
};

export type StorageProbeResult = "ok" | "unwritable";

export interface StorageService {
  /** Stable provider id of the bound adapter (`"local"` or `"s3"`). */
  readonly provider: string;
  readonly storeIdentity: StorageStoreIdentity | null;
  readonly maxObjectBytes: number;
  putObject(input: PutObjectInput): Promise<StoredObjectRecord>;
  findObject(ref: ObjectRef): Promise<StoredObjectRecord | null>;
  getObject(ref: ObjectRef): Promise<{
    object: StoredObjectRecord;
    body: ReadableStream<Uint8Array>;
  } | null>;
  listObjects(input: {
    organizationId: string;
    purpose?: StoredObjectPurpose;
    limit?: number;
  }): Promise<StoredObjectRecord[]>;
  /** Removes the bytes, then the metadata row. Returns `false` when not found. */
  deleteObject(ref: ObjectRef): Promise<boolean>;
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

  async function findObject(ref: ObjectRef): Promise<StoredObjectRecord | null> {
    const row = await findRow(ref);
    return row && isReadable(row) ? toRecord(row) : null;
  }

  function isReadable(row: typeof storedObject.$inferSelect): boolean {
    if (row.photoState === null) return true;
    if (
      row.storageProvider !== storage.storeIdentity?.provider ||
      row.storageStoreId !== storage.storeIdentity?.storeId
    ) {
      throw new StorageError("unavailable", 0);
    }
    return row.photoState === "ready";
  }

  const service: StorageService = {
    provider: storage.provider,
    storeIdentity: storage.storeIdentity ?? null,
    maxObjectBytes,

    async putObject(input: PutObjectInput): Promise<StoredObjectRecord> {
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

    async getObject(ref: ObjectRef) {
      const row = await findRow(ref);
      if (!row || !isReadable(row)) return null;
      const blob = await storage.get(row.storageKey);
      if (!blob) return null;
      return { object: toRecord(row), body: blob.body };
    },

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

    async deleteObject(ref: ObjectRef): Promise<boolean> {
      const row = await findRow(ref);
      if (!row) return false;
      // Bytes first: if the row delete then fails, the row points at nothing,
      // which is safer than an unindexed object that erasure can never find.
      await storage.delete(row.storageKey);
      await db
        .delete(storedObject)
        .where(
          and(eq(storedObject.id, row.id), eq(storedObject.organizationId, ref.organizationId)),
        );
      return true;
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
