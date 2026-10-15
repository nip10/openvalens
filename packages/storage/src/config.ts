/**
 * Object storage configuration (Issue #62).
 *
 * The storage package stays pure: {@link parseStorageConfig} validates a plain
 * env object and never reads `process.env`. The server binds its varlock `ENV`
 * in `apps/server/src/services.ts`.
 *
 * `STORAGE_PROVIDER` selects one of two adapters:
 *
 * - `local` (default) — files under `STORAGE_LOCAL_DIR` on the server's disk,
 *   which the production compose stack mounts as the `storage` volume.
 * - `s3` — any S3-compatible endpoint (AWS S3, Cloudflare R2, MinIO, B2).
 *   Missing bucket or credentials leave storage `off` (callers fail closed);
 *   they never fail boot.
 *
 * Either way objects are private: there is no public bucket or public URL.
 * Errors name keys only, never values.
 */

import type { IntegrationStatus } from "@openvalens/config/integrations";

export const STORAGE_PROVIDERS = ["local", "s3"] as const;

export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

export const STORAGE_DEFAULT_LOCAL_DIR = "./.data/storage";
/** 25 MiB — enough for a phone photo or a lab PDF. */
export const STORAGE_DEFAULT_MAX_OBJECT_BYTES = 25 * 1024 * 1024;
/** Hard ceiling for `STORAGE_MAX_OBJECT_BYTES` (objects are buffered in memory). */
export const STORAGE_MAX_OBJECT_BYTES_CEILING = 100 * 1024 * 1024;
export const STORAGE_DEFAULT_SIGNED_URL_TTL_SECONDS = 300;
/** Signed URLs are short-lived by design; one hour is the longest allowed. */
export const STORAGE_MAX_SIGNED_URL_TTL_SECONDS = 3600;
export const STORAGE_DEFAULT_S3_REGION = "us-east-1";

export const STORAGE_S3_SSE_MODES = ["AES256", "none"] as const;

export type StorageS3SseMode = (typeof STORAGE_S3_SSE_MODES)[number];

export type S3StorageConfig = {
  /** Endpoint origin, e.g. `https://s3.eu-west-1.amazonaws.com` or `http://minio:9000`. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style addressing (`endpoint/bucket/key`), required by MinIO. */
  forcePathStyle: boolean;
  /** Server-side encryption header sent on every upload. */
  sse: StorageS3SseMode;
};

export type StorageConfig = {
  /** Selected provider, or `null` when storage is off (S3 selected but incomplete). */
  provider: StorageProvider | null;
  localDir: string;
  /** Present only when `provider === "s3"`. */
  s3: S3StorageConfig | null;
  maxObjectBytes: number;
  signedUrlTtlSeconds: number;
};

/** Env-shaped input. Accepts the varlock `ENV` proxy or a plain test object. */
export type StorageEnv = {
  STORAGE_PROVIDER?: string | null;
  STORAGE_LOCAL_DIR?: string | null;
  STORAGE_MAX_OBJECT_BYTES?: string | number | null;
  STORAGE_SIGNED_URL_TTL_SECONDS?: string | number | null;
  STORAGE_S3_ENDPOINT?: string | null;
  STORAGE_S3_REGION?: string | null;
  STORAGE_S3_BUCKET?: string | null;
  STORAGE_S3_ACCESS_KEY_ID?: string | null;
  STORAGE_S3_SECRET_ACCESS_KEY?: string | null;
  STORAGE_S3_FORCE_PATH_STYLE?: string | boolean | null;
  STORAGE_S3_SSE?: string | null;
};

/** Invalid storage env. The message names keys only, never values. */
export class StorageConfigError extends Error {
  readonly code = "STORAGE_CONFIG_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "StorageConfigError";
  }
}

function readOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readEnum<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  key: string,
): T | null {
  const raw = readOptionalString(value);
  if (raw === null) return null;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new StorageConfigError(`${key} must be one of: ${allowed.join(", ")}.`);
}

function readBoolean(value: string | boolean | null | undefined, key: string): boolean | null {
  if (typeof value === "boolean") return value;
  const raw = readOptionalString(value);
  if (raw === null) return null;
  const lower = raw.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  throw new StorageConfigError(`${key} must be true or false.`);
}

function readInteger(
  value: string | number | null | undefined,
  key: string,
  { min, max }: { min: number; max: number },
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new StorageConfigError(`${key} must be an integer between ${min} and ${max}.`);
  }
  return n;
}

function readEndpoint(value: string | null | undefined, region: string): string {
  const raw = readOptionalString(value);
  if (raw === null) return `https://s3.${region}.amazonaws.com`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new StorageConfigError("STORAGE_S3_ENDPOINT must be an absolute http(s) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new StorageConfigError("STORAGE_S3_ENDPOINT must be an absolute http(s) URL.");
  }
  if (url.username || url.password) {
    // Credentials belong in the access-key variables (which are redacted).
    throw new StorageConfigError("STORAGE_S3_ENDPOINT must not embed credentials.");
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new StorageConfigError("STORAGE_S3_ENDPOINT must be an origin without a path.");
  }
  return url.origin;
}

const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION_PATTERN = /^[a-z0-9-]{1,32}$/;

/**
 * Parses + validates the storage env.
 *
 * - `STORAGE_PROVIDER` defaults to `local`.
 * - `s3` needs `STORAGE_S3_BUCKET`, `STORAGE_S3_ACCESS_KEY_ID` and
 *   `STORAGE_S3_SECRET_ACCESS_KEY`; when any is missing, storage is `off`
 *   (`provider: null`) rather than a boot failure.
 * - `STORAGE_S3_ENDPOINT` defaults to the AWS regional endpoint.
 * - `STORAGE_S3_SSE` defaults to `AES256` (SSE-S3). Set `none` only for
 *   endpoints that reject the header (MinIO without KMS).
 *
 * @throws {StorageConfigError} for a malformed value.
 */
export function parseStorageConfig(env: StorageEnv): StorageConfig {
  const requested =
    readEnum(env.STORAGE_PROVIDER, STORAGE_PROVIDERS, "STORAGE_PROVIDER") ?? "local";
  const localDir = readOptionalString(env.STORAGE_LOCAL_DIR) ?? STORAGE_DEFAULT_LOCAL_DIR;
  const maxObjectBytes =
    readInteger(env.STORAGE_MAX_OBJECT_BYTES, "STORAGE_MAX_OBJECT_BYTES", {
      min: 1,
      max: STORAGE_MAX_OBJECT_BYTES_CEILING,
    }) ?? STORAGE_DEFAULT_MAX_OBJECT_BYTES;
  const signedUrlTtlSeconds =
    readInteger(env.STORAGE_SIGNED_URL_TTL_SECONDS, "STORAGE_SIGNED_URL_TTL_SECONDS", {
      min: 1,
      max: STORAGE_MAX_SIGNED_URL_TTL_SECONDS,
    }) ?? STORAGE_DEFAULT_SIGNED_URL_TTL_SECONDS;

  const base = { localDir, maxObjectBytes, signedUrlTtlSeconds };
  if (requested === "local") return { provider: "local", s3: null, ...base };

  const region = readOptionalString(env.STORAGE_S3_REGION) ?? STORAGE_DEFAULT_S3_REGION;
  if (!REGION_PATTERN.test(region)) {
    throw new StorageConfigError("STORAGE_S3_REGION must be a region id such as us-east-1.");
  }
  const endpoint = readEndpoint(env.STORAGE_S3_ENDPOINT, region);
  const bucket = readOptionalString(env.STORAGE_S3_BUCKET);
  if (bucket !== null && !BUCKET_PATTERN.test(bucket)) {
    throw new StorageConfigError("STORAGE_S3_BUCKET must be a valid S3 bucket name.");
  }
  const forcePathStyle =
    readBoolean(env.STORAGE_S3_FORCE_PATH_STYLE, "STORAGE_S3_FORCE_PATH_STYLE") ?? false;
  const sse = readEnum(env.STORAGE_S3_SSE, STORAGE_S3_SSE_MODES, "STORAGE_S3_SSE") ?? "AES256";
  const accessKeyId = readOptionalString(env.STORAGE_S3_ACCESS_KEY_ID);
  const secretAccessKey = readOptionalString(env.STORAGE_S3_SECRET_ACCESS_KEY);

  if (bucket === null || accessKeyId === null || secretAccessKey === null) {
    return { provider: null, s3: null, ...base };
  }

  return {
    provider: "s3",
    s3: { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle, sse },
    ...base,
  };
}

/**
 * Issue #57 — value-free readiness status of the storage family: the provider
 * id and state only, never a directory, endpoint, bucket or key. Local disk is
 * the default and always `configured`; S3 without a bucket or credentials is
 * `off`, and storage callers fail closed.
 */
export function describeStorageIntegration(
  config: StorageConfig,
): IntegrationStatus<StorageProvider> {
  return config.provider === null
    ? { provider: null, state: "off" }
    : { provider: config.provider, state: "configured" };
}
