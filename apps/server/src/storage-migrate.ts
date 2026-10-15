/**
 * `bun run storage:migrate` — copy every stored object from local disk to the
 * configured S3-compatible bucket (Issue #62).
 *
 *   bun run storage:migrate            # dry run: report what would be copied
 *   bun run storage:migrate -- --apply # copy, verifying SHA-256 both ways
 *
 * Reads `STORAGE_LOCAL_DIR` as the source and the `STORAGE_S3_*` variables as
 * the target, whatever `STORAGE_PROVIDER` currently says, so it can run before
 * the switch. It is idempotent (objects already in the bucket with a matching
 * checksum are skipped) and never deletes the source. Switch
 * `STORAGE_PROVIDER=s3` and restart only after a clean `--apply` run. Output is
 * counts and object ids only — never keys, paths or credentials.
 */

import { createDb } from "@openvalens/db";
import { storedObject } from "@openvalens/db/schema/storage";
import { LocalObjectStorage } from "@openvalens/storage/providers/local";
import { S3ObjectStorage } from "@openvalens/storage/providers/s3";
import { migrateObjects, parseStorageConfig } from "@openvalens/storage";

import { ENV } from "./env.server";

const apply = process.argv.includes("--apply");
const target = parseStorageConfig({
  STORAGE_PROVIDER: "s3",
  STORAGE_LOCAL_DIR: ENV.STORAGE_LOCAL_DIR,
  STORAGE_S3_ENDPOINT: ENV.STORAGE_S3_ENDPOINT,
  STORAGE_S3_REGION: ENV.STORAGE_S3_REGION,
  STORAGE_S3_BUCKET: ENV.STORAGE_S3_BUCKET,
  STORAGE_S3_ACCESS_KEY_ID: ENV.STORAGE_S3_ACCESS_KEY_ID,
  STORAGE_S3_SECRET_ACCESS_KEY: ENV.STORAGE_S3_SECRET_ACCESS_KEY,
  STORAGE_S3_FORCE_PATH_STYLE: ENV.STORAGE_S3_FORCE_PATH_STYLE,
  STORAGE_S3_SSE: ENV.STORAGE_S3_SSE,
});
if (!target.s3) {
  console.error(
    "storage:migrate needs STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID and STORAGE_S3_SECRET_ACCESS_KEY.",
  );
  process.exit(2);
}

const db = createDb(ENV);
const items = await db
  .select({
    id: storedObject.id,
    storageKey: storedObject.storageKey,
    sha256: storedObject.sha256,
    contentType: storedObject.contentType,
  })
  .from(storedObject)
  .orderBy(storedObject.createdAt);

const report = await migrateObjects({
  source: new LocalObjectStorage(target.localDir),
  target: new S3ObjectStorage(target.s3),
  items,
  dryRun: !apply,
});

console.log(JSON.stringify(report, null, 2));
process.exit(report.failed.length > 0 ? 1 : 0);
