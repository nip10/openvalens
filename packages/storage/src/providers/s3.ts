/**
 * S3-compatible object storage adapter (Issue #62): AWS S3, Cloudflare R2,
 * MinIO, Backblaze B2 and anything else that speaks the S3 REST API with
 * Signature Version 4.
 *
 * Plain `fetch` + a small SigV4 signer — no vendor SDK, so nothing is added to
 * the `no-restricted-imports` list. Only four object operations are used
 * (PUT, GET, HEAD, DELETE) plus query-string presigning for short-lived GET
 * URLs. The bucket is never made public and no ACL header is ever sent.
 *
 * Errors are mapped to {@link StorageError} with the HTTP status only; the
 * response body (which can echo the key or bucket) is never read into an
 * error or log.
 */

import { createHash, createHmac } from "node:crypto";

import type { S3StorageConfig } from "../config";
import {
  assertStorageKey,
  categorizeStorageStatus,
  StorageError,
  type ObjectStorage,
  type PutBlobOptions,
  type SignedGetUrlOptions,
  type StoredBlob,
  type StoredBlobHead,
} from "../object-storage";

/** Upper bound on one S3 request before the body starts streaming. */
export const DEFAULT_S3_TIMEOUT_MS = 30_000;

const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

// ─── SigV4 ─────────────────────────────────────────────────────

/** RFC 3986 encoding as SigV4 requires (`encodeURIComponent` leaves `!'()*`). */
export function sigv4Encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** `20130524T000000Z` form of a date. */
export function amzDate(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

export type SigV4Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

export type CanonicalRequestInput = {
  method: string;
  /** Already-encoded absolute path, e.g. `/bucket/org/abc`. */
  path: string;
  query: Record<string, string>;
  /** Lowercase header names. Must include `host`. */
  headers: Record<string, string>;
  payloadHash: string;
};

function canonicalQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .sort()
    .map((key) => `${sigv4Encode(key)}=${sigv4Encode(query[key]!)}`)
    .join("&");
}

/**
 * Signs a canonical request and returns the hex signature, the credential
 * scope and the signed-header list.
 */
export function signSigV4(
  input: CanonicalRequestInput,
  credentials: SigV4Credentials,
  now: Date,
): { signature: string; scope: string; signedHeaders: string } {
  const date = amzDate(now);
  const day = date.slice(0, 8);
  const scope = `${day}/${credentials.region}/${SERVICE}/aws4_request`;
  const names = Object.keys(input.headers)
    .map((name) => name.toLowerCase())
    .sort();
  const lowered = Object.fromEntries(
    Object.entries(input.headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const signedHeaders = names.join(";");
  const canonicalHeaders = names
    .map((name) => `${name}:${lowered[name]!.trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const canonicalRequest = [
    input.method,
    input.path,
    canonicalQuery(input.query),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const stringToSign = [ALGORITHM, date, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), credentials.region), SERVICE),
    "aws4_request",
  );
  return {
    signature: createHmac("sha256", signingKey).update(stringToSign).digest("hex"),
    scope,
    signedHeaders,
  };
}

/**
 * Builds a query-string presigned URL (SigV4 "UNSIGNED-PAYLOAD"). Only `host`
 * is signed, so the URL works from a browser `<img>` or download link.
 */
export function presignUrl(
  input: { method: string; url: URL; expiresInSeconds: number; query?: Record<string, string> },
  credentials: SigV4Credentials,
  now: Date,
): string {
  const day = amzDate(now).slice(0, 8);
  const query: Record<string, string> = {
    ...input.query,
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": `${credentials.accessKeyId}/${day}/${credentials.region}/${SERVICE}/aws4_request`,
    "X-Amz-Date": amzDate(now),
    "X-Amz-Expires": String(input.expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const { signature } = signSigV4(
    {
      method: input.method,
      path: input.url.pathname,
      query,
      headers: { host: input.url.host },
      payloadHash: "UNSIGNED-PAYLOAD",
    },
    credentials,
    now,
  );
  return `${input.url.origin}${input.url.pathname}?${canonicalQuery({
    ...query,
    "X-Amz-Signature": signature,
  })}`;
}

// ─── Adapter ───────────────────────────────────────────────────

export type S3ObjectStorageOptions = {
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
};

export class S3ObjectStorage implements ObjectStorage {
  readonly provider = "s3";
  readonly #config: S3StorageConfig;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #timeoutMs: number;

  constructor(config: S3StorageConfig, options: S3ObjectStorageOptions = {}) {
    this.#config = config;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_S3_TIMEOUT_MS;
  }

  get #credentials(): SigV4Credentials {
    return {
      accessKeyId: this.#config.accessKeyId,
      secretAccessKey: this.#config.secretAccessKey,
      region: this.#config.region,
    };
  }

  /** Object URL in path-style (`endpoint/bucket/key`) or virtual-hosted style. */
  objectUrl(key: string): URL {
    assertStorageKey(key);
    const endpoint = new URL(this.#config.endpoint);
    const encodedKey = key.split("/").map(sigv4Encode).join("/");
    if (this.#config.forcePathStyle) {
      return new URL(`${endpoint.origin}/${this.#config.bucket}/${encodedKey}`);
    }
    return new URL(`${endpoint.protocol}//${this.#config.bucket}.${endpoint.host}/${encodedKey}`);
  }

  async #send(
    method: "PUT" | "GET" | "HEAD" | "DELETE",
    key: string,
    body?: Uint8Array,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const url = this.objectUrl(key);
    const now = this.#now();
    const payloadHash = body ? sha256Hex(body) : EMPTY_SHA256;
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate(now),
      ...extraHeaders,
    };
    const { signature, scope, signedHeaders } = signSigV4(
      { method, path: url.pathname, query: {}, headers, payloadHash },
      this.#credentials,
      now,
    );
    const { host: _host, ...sendHeaders } = headers;
    try {
      return await this.#fetch(url, {
        method,
        headers: {
          ...sendHeaders,
          authorization: `${ALGORITHM} Credential=${this.#config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        },
        // Every caller passes an ArrayBuffer-backed view (never shared memory).
        ...(body ? { body: body as Uint8Array<ArrayBuffer> } : {}),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      const name = (error as { name?: unknown })?.name;
      throw new StorageError(
        name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
        0,
      );
    }
  }

  async put(key: string, body: Uint8Array, options: PutBlobOptions): Promise<void> {
    const headers: Record<string, string> = {
      "content-type": options.contentType,
      "x-amz-meta-sha256": options.sha256,
    };
    if (this.#config.sse !== "none") headers["x-amz-server-side-encryption"] = this.#config.sse;
    const response = await this.#send("PUT", key, body, headers);
    await response.body?.cancel();
    if (!response.ok)
      throw new StorageError(categorizeStorageStatus(response.status), response.status);
  }

  async head(key: string): Promise<StoredBlobHead | null> {
    const response = await this.#send("HEAD", key);
    if (response.status === 404) return null;
    if (!response.ok)
      throw new StorageError(categorizeStorageStatus(response.status), response.status);
    return {
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      size: Number(response.headers.get("content-length") ?? 0),
    };
  }

  async get(key: string): Promise<StoredBlob | null> {
    const response = await this.#send("GET", key);
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new StorageError(categorizeStorageStatus(response.status), response.status);
    }
    return {
      body: response.body,
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      size: Number(response.headers.get("content-length") ?? 0),
    };
  }

  async delete(key: string): Promise<void> {
    const response = await this.#send("DELETE", key);
    await response.body?.cancel();
    if (!response.ok && response.status !== 404) {
      throw new StorageError(categorizeStorageStatus(response.status), response.status);
    }
  }

  async signedGetUrl(key: string, options: SignedGetUrlOptions): Promise<string> {
    return presignUrl(
      {
        method: "GET",
        url: this.objectUrl(key),
        expiresInSeconds: options.expiresInSeconds,
        query: {
          "response-cache-control": "private, no-store",
          "response-content-disposition": "attachment",
          "response-content-type": options.contentType,
        },
      },
      this.#credentials,
      this.#now(),
    );
  }
}
