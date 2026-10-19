/**
 * The object storage adapter interface (Issue #62).
 *
 * One small interface, two implementations in `src/providers/`: `local` (disk)
 * and `s3` (any S3-compatible endpoint, plain `fetch` + SigV4, no SDK). Adapters
 * deal in raw keys and bytes only; tenant scoping, metadata and authorization
 * live in {@link StorageService} (`service.ts`), which is what feature code
 * uses.
 *
 * Keys are validated by every adapter with {@link assertStorageKey}: only
 * `[A-Za-z0-9_-]` segments joined by `/`, so a key can never escape the local
 * root or carry free text.
 */

export type StoredBlob = {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  size: number;
};

export type StoredBlobHead = {
  contentType: string;
  size: number;
};

export type PutBlobOptions = {
  contentType: string;
  /** Lowercase hex SHA-256 of `body`; stored alongside so copies can be verified. */
  sha256: string;
};

export type SignedGetUrlOptions = {
  expiresInSeconds: number;
  /** Content type the response must carry. */
  contentType: string;
};

export type StorageStoreIdentity = {
  provider: "local" | "s3";
  storeId: string;
};

export interface ObjectStorage {
  /** Stable lowercase provider id (`"local"`, `"s3"`). */
  readonly provider: string;
  /** Present on built-in adapters; custom legacy adapters may omit it. */
  readonly storeIdentity?: StorageStoreIdentity;
  /** Writes (or atomically replaces) the object. */
  put(key: string, body: Uint8Array, options: PutBlobOptions): Promise<void>;
  /** Streams the object, or `null` when it does not exist. */
  get(key: string): Promise<StoredBlob | null>;
  /** Object size and type, or `null` when it does not exist. */
  head(key: string): Promise<StoredBlobHead | null>;
  /** Deletes the object. Deleting a missing object succeeds. */
  delete(key: string): Promise<void>;
  /**
   * A short-lived URL that downloads the object without a session, or `null`
   * when the adapter has no native signing (local disk: the server mints an
   * HMAC route instead; see `signed-url.ts`).
   */
  signedGetUrl(key: string, options: SignedGetUrlOptions): Promise<string | null>;
}

const KEY_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_KEY_SEGMENTS = 6;

export function isValidStorageKey(key: string): boolean {
  const segments = key.split("/");
  return (
    segments.length >= 1 &&
    segments.length <= MAX_KEY_SEGMENTS &&
    segments.every((segment) => KEY_SEGMENT.test(segment))
  );
}

/** Rejects any key outside the opaque `[A-Za-z0-9_-]` segment grammar. */
export function assertStorageKey(key: string): void {
  if (!isValidStorageKey(key)) throw new StorageError("invalid_key", 0);
}

/**
 * Storage failure category (mirrors the email/AI vocabularies):
 *
 * - `network` / `timeout` — no response from the backend.
 * - `rate_limited` — HTTP 429 or S3 `SlowDown` (503).
 * - `provider_unavailable` — HTTP 5xx, or a local I/O failure.
 * - `auth` — HTTP 401/403 (bad credentials, bucket policy).
 * - `rejected` — any other 4xx.
 * - `invalid_key` — the key failed {@link assertStorageKey}.
 * - `too_large` / `unsupported_type` / `integrity` — refused before storing.
 * - `unavailable` — storage is off (S3 selected without credentials).
 */
export type StorageErrorCategory =
  | "network"
  | "timeout"
  | "rate_limited"
  | "provider_unavailable"
  | "auth"
  | "rejected"
  | "invalid_key"
  | "too_large"
  | "unsupported_type"
  | "integrity"
  | "unavailable";

const RETRYABLE: ReadonlySet<StorageErrorCategory> = new Set([
  "network",
  "timeout",
  "rate_limited",
  "provider_unavailable",
]);

export function categorizeStorageStatus(status: number): StorageErrorCategory {
  if (status === 429 || status === 503) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  if (status === 401 || status === 403) return "auth";
  return "rejected";
}

/**
 * Typed storage failure. The message holds only the category and HTTP status —
 * never a key, bucket, endpoint, credential or object content.
 */
export class StorageError extends Error {
  readonly code = "STORAGE_ERROR";
  readonly category: StorageErrorCategory;
  /** HTTP status, or `0` when no response was involved. */
  readonly status: number;
  readonly retryable: boolean;

  constructor(category: StorageErrorCategory, status: number) {
    super(`Object storage error (${category}${status ? `, status ${status}` : ""})`);
    this.name = "StorageError";
    this.category = category;
    this.status = status;
    this.retryable = RETRYABLE.has(category);
  }
}

export type StorageErrorSummary = {
  errorCode: "STORAGE_ERROR" | "STORAGE_UNKNOWN";
  errorCategory: StorageErrorCategory | "unknown";
  retryable: boolean;
  status?: number;
};

/** Value-free summary of any thrown value, safe to spread into a log line. */
export function describeStorageError(error: unknown): StorageErrorSummary {
  if (error instanceof StorageError) {
    return {
      errorCode: error.code,
      errorCategory: error.category,
      retryable: error.retryable,
      ...(error.status ? { status: error.status } : {}),
    };
  }
  return {
    errorCode: "STORAGE_UNKNOWN",
    errorCategory: "unknown",
    retryable: false,
  };
}
