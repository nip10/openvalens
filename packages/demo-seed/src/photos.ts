import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sanitizeImage } from "@openvalens/body/sanitize-image";
import { resolveFileSecrets } from "@openvalens/config/file-secrets";
import { sql, type Database } from "@openvalens/db";
import { privateBodyMeasurementPreference } from "@openvalens/db/schema/body";
import {
  createObjectStorage,
  createStorageService,
  parseStorageConfig,
  type StorageService,
} from "@openvalens/storage";
import { eq } from "drizzle-orm";

type PhotoSubject = { userId: string; organizationId: string };
const FIXTURES = ["synthetic-front.png", "synthetic-side.png"] as const;

/** Only call after the guarded demo/review seed has committed successfully. */
export async function seedDemoPhotos(db: Database, storage: StorageService, subject: PhotoSubject) {
  // Serialize repeated CLI runs without holding the user lock needed by storage's lifecycle.
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`demo-photos:${subject.organizationId}:${subject.userId}`}, 0))`,
    );
    const [preference] = await tx
      .select()
      .from(privateBodyMeasurementPreference)
      .where(eq(privateBodyMeasurementPreference.userId, subject.userId));
    if (!preference?.enabled) return 0;
    const photos = await storage.listPhotos({
      ...subject,
      createdByUserId: subject.userId,
      limit: 500,
    });
    const hashes = new Set(photos.map((photo) => photo.sha256));
    let added = 0;
    for (const name of FIXTURES) {
      const image = await sanitizeImage(
        await readFile(new URL(`../assets/${name}`, import.meta.url)),
      );
      const hash = createHash("sha256").update(image.bytes).digest("hex");
      if (hashes.has(hash)) continue;
      const ref = await storage.reservePhoto({
        organizationId: subject.organizationId,
        createdByUserId: subject.userId,
        contentType: image.contentType,
        canonicalBytes: image.bytes,
      });
      await storage.writePhoto({
        ref,
        bytes: image.bytes,
        linkPhoto: async (linkTx) => {
          const [current] = await linkTx
            .select()
            .from(privateBodyMeasurementPreference)
            .where(eq(privateBodyMeasurementPreference.userId, subject.userId))
            .for("update");
          if (!current?.enabled) throw new Error("Demo photo tracking was turned off.");
        },
      });
      hashes.add(hash);
      added += 1;
    }
    return added;
  });
}

/** Same store as the server, including relative paths and mounted S3 secrets. */
export async function seedConfiguredDemoPhotos(
  db: Database,
  subject: PhotoSubject,
  env: Record<string, string | undefined>,
) {
  const config = parseStorageConfig({
    ...env,
    ...resolveFileSecrets(env, ["STORAGE_S3_ACCESS_KEY_ID", "STORAGE_S3_SECRET_ACCESS_KEY"]),
  });
  config.localDir = resolve(import.meta.dir, "../../../apps/server", config.localDir);
  const adapter = createObjectStorage(config);
  if (!adapter) {
    console.log("Synthetic photos skipped: private storage is off.");
    return;
  }
  const storage = createStorageService({
    db,
    storage: adapter,
    maxObjectBytes: config.maxObjectBytes,
    signedUrlTtlSeconds: config.signedUrlTtlSeconds,
    // This seed service never creates download URLs; the server signs its own reads.
    signingKey: randomBytes(32),
  });
  const added = await seedDemoPhotos(db, storage, subject);
  console.log(`Synthetic private photos: ${added} added; existing photos kept.`);
}
