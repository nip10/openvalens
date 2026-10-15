/**
 * Builds the adapter selected by `STORAGE_PROVIDER` (Issue #62). Returns
 * `null` when storage is off (S3 selected without a bucket or credentials);
 * the server then binds no storage service and storage callers fail closed.
 */

import type { StorageConfig } from "./config";
import type { ObjectStorage } from "./object-storage";
import { LocalObjectStorage } from "./providers/local";
import { S3ObjectStorage } from "./providers/s3";

export function createObjectStorage(config: StorageConfig): ObjectStorage | null {
  if (config.provider === "local") return new LocalObjectStorage(config.localDir);
  if (config.provider === "s3" && config.s3) return new S3ObjectStorage(config.s3);
  return null;
}
