import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { exerciseCatalogAsset, exercise, exerciseMedia } from "@openvalens/db/schema/exercises";
import type { Database } from "@openvalens/db";
import type { ExerciseCatalogMediaPreview } from "@openvalens/api/context";
import type { ObjectStorage, StorageStoreIdentity } from "@openvalens/storage/object-storage";
import type { ImageSanitizationLimits } from "@openvalens/body/sanitize-image";

const LICENSE_URLS: Readonly<Record<string, string>> = Object.freeze({
  "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
  "CC-BY-SA-3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
  "CC-BY-SA-4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
});
const TRANSFORMATION_NOTICE =
  "Image decoded, EXIF-oriented, resized within publication limits, metadata-stripped, and re-encoded as JPEG or PNG.";

export type ExerciseAssetPublicationEvidence = {
  sourceExerciseId: number;
  sourceExternalExerciseId: string;
  exerciseMediaId: number;
  sourceExternalMediaId: string;
  snapshotVersion: string;
  snapshotAt: Date;
  licenseCode: string;
  licenseUrl: string;
  author: string | null;
  attribution: string | null;
  sourceUrl: string;
  transformationNotice: string;
};

export type ExerciseCatalogAssetLimits = ImageSanitizationLimits & {
  maxPublishedBytes: number;
  storageIdentity: StorageStoreIdentity;
};

export class ExerciseCatalogAssetError extends Error {
  constructor(
    readonly code:
      | "ineligible"
      | "evidence_mismatch"
      | "invalid_input"
      | "asset_pending"
      | "storage_identity_mismatch"
      | "asset_unavailable",
  ) {
    super(code);
    this.name = "ExerciseCatalogAssetError";
  }
}

type SourceRow = {
  media: typeof exerciseMedia.$inferSelect;
  parent: typeof exercise.$inferSelect;
};

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const sameDate = (a: Date | null, b: Date): boolean =>
  a instanceof Date && a.getTime() === b.getTime();
const normalizedMetadata = (row: SourceRow) => ({
  exerciseId: row.parent.id,
  source: row.parent.source,
  organizationId: row.parent.organizationId,
  externalExerciseId: row.parent.externalId,
  mediaId: row.media.id,
  externalMediaId: row.media.sourceExternalMediaId,
  kind: row.media.kind,
  snapshotVersion: row.parent.snapshotVersion,
  snapshotAt: row.parent.snapshotAt?.toISOString() ?? null,
  mediaSnapshotVersion: row.media.snapshotVersion,
  mediaSnapshotAt: row.media.snapshotAt?.toISOString() ?? null,
  publicationActive: row.media.publicationActive,
  publicationRevision: row.media.publicationRevision,
  licenseCode: row.media.licenseCode,
  licenseUrl: row.media.licenseUrl,
  author: row.media.author,
  attribution: row.media.rawAttribution,
  sourceUrl: row.media.sourceMediaUrl,
});
const fingerprint = (row: SourceRow): string =>
  sha256(Buffer.from(JSON.stringify(normalizedMetadata(row))));

function approved(row: SourceRow): boolean {
  const expectedUrl = row.media.licenseCode ? LICENSE_URLS[row.media.licenseCode] : undefined;
  const cc0 = row.media.licenseCode === "CC0-1.0";
  return (
    row.parent.source === "wger" &&
    row.parent.organizationId === null &&
    row.media.kind === "image" &&
    row.media.publicationActive &&
    Number.isSafeInteger(row.media.publicationRevision) &&
    row.media.publicationRevision >= 0 &&
    Boolean(row.parent.externalId && row.parent.snapshotVersion && row.parent.snapshotAt) &&
    row.media.snapshotVersion === row.parent.snapshotVersion &&
    sameDate(row.media.snapshotAt, row.parent.snapshotAt!) &&
    Boolean(expectedUrl && row.media.licenseUrl === expectedUrl && row.media.sourceMediaUrl) &&
    (cc0 || Boolean(row.media.author && row.media.rawAttribution))
  );
}

function evidenceMatches(row: SourceRow, evidence: ExerciseAssetPublicationEvidence): boolean {
  return (
    approved(row) &&
    evidence.sourceExerciseId === row.parent.id &&
    evidence.sourceExternalExerciseId === row.parent.externalId &&
    evidence.exerciseMediaId === row.media.id &&
    evidence.sourceExternalMediaId === row.media.sourceExternalMediaId &&
    evidence.snapshotVersion === row.parent.snapshotVersion &&
    sameDate(evidence.snapshotAt, row.parent.snapshotAt!) &&
    evidence.licenseCode === row.media.licenseCode &&
    evidence.licenseUrl === row.media.licenseUrl &&
    evidence.author === row.media.author &&
    evidence.attribution === row.media.rawAttribution &&
    evidence.sourceUrl === row.media.sourceMediaUrl &&
    evidence.transformationNotice === TRANSFORMATION_NOTICE
  );
}

async function loadSource(db: Database, mediaId: number): Promise<SourceRow | null> {
  const [result] = await db
    .select({ media: exerciseMedia, parent: exercise })
    .from(exerciseMedia)
    .innerJoin(exercise, eq(exerciseMedia.exerciseId, exercise.id))
    .where(eq(exerciseMedia.id, mediaId))
    .limit(1);
  return result ?? null;
}

async function readBounded(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ExerciseCatalogAssetError("asset_unavailable");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    size,
  );
}

export function createExerciseCatalogAssetService(args: {
  db: Database;
  storage: ObjectStorage;
  limits: ExerciseCatalogAssetLimits;
}) {
  const { db, storage, limits } = args;
  const storageMatches = (): boolean =>
    Boolean(
      storage.storeIdentity &&
      storage.provider === limits.storageIdentity.provider &&
      storage.storeIdentity.provider === limits.storageIdentity.provider &&
      storage.storeIdentity.storeId === limits.storageIdentity.storeId,
    );
  const limitsValid = (): boolean =>
    Number.isSafeInteger(limits.maxPublishedBytes) &&
    limits.maxPublishedBytes > 0 &&
    limits.maxPublishedBytes <= limits.maxOutputBytes &&
    (limits.storageIdentity.provider === "local" || limits.storageIdentity.provider === "s3") &&
    limits.storageIdentity.storeId.length > 0;
  const keyFor = (id: string) => `catalog/exercise/${id}`;

  async function ingestLocalAsset(input: {
    exerciseMediaId: number;
    bytes: Uint8Array;
    expectedOriginalSha256: string;
    publicationEvidence: ExerciseAssetPublicationEvidence;
  }): Promise<{ id: string; state: "ready"; contentType: string; size: number; sha256: string }> {
    if (
      !Number.isSafeInteger(input.exerciseMediaId) ||
      input.exerciseMediaId < 1 ||
      !(input.bytes instanceof Uint8Array) ||
      input.bytes.byteLength === 0 ||
      input.bytes.byteLength > limits.maxInputBytes ||
      !limitsValid() ||
      !/^[0-9a-f]{64}$/.test(input.expectedOriginalSha256) ||
      sha256(input.bytes) !== input.expectedOriginalSha256
    ) {
      throw new ExerciseCatalogAssetError("invalid_input");
    }
    const current = await loadSource(db, input.exerciseMediaId);
    if (!current || !approved(current)) throw new ExerciseCatalogAssetError("ineligible");
    if (!evidenceMatches(current, input.publicationEvidence))
      throw new ExerciseCatalogAssetError("evidence_mismatch");
    if (!storageMatches()) throw new ExerciseCatalogAssetError("storage_identity_mismatch");
    const originalFileSha256 = input.expectedOriginalSha256;
    const { sanitizeImage } = await import("@openvalens/body/sanitize-image");
    const sanitized = await sanitizeImage(input.bytes, limits);
    if (sanitized.bytes.byteLength > limits.maxPublishedBytes)
      throw new ExerciseCatalogAssetError("invalid_input");
    const contentSha256 = sha256(sanitized.bytes);
    const bindingFingerprint = fingerprint(current);
    const assetId = randomUUID();
    const storageKey = keyFor(assetId);
    const evidence = input.publicationEvidence;

    const reservation = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ media: exerciseMedia, parent: exercise })
        .from(exerciseMedia)
        .innerJoin(exercise, eq(exerciseMedia.exerciseId, exercise.id))
        .where(eq(exerciseMedia.id, input.exerciseMediaId))
        .for("update");
      if (
        !locked ||
        !evidenceMatches(locked, evidence) ||
        fingerprint(locked) !== bindingFingerprint
      )
        throw new ExerciseCatalogAssetError("evidence_mismatch");
      if (!storageMatches()) throw new ExerciseCatalogAssetError("storage_identity_mismatch");
      const previous = await tx
        .select({
          id: exerciseCatalogAsset.id,
          state: exerciseCatalogAsset.state,
          writeState: exerciseCatalogAsset.writeState,
          bindingFingerprint: exerciseCatalogAsset.bindingFingerprint,
          storageProvider: exerciseCatalogAsset.storageProvider,
          storageStoreId: exerciseCatalogAsset.storageStoreId,
        })
        .from(exerciseCatalogAsset)
        .where(eq(exerciseCatalogAsset.exerciseMediaId, input.exerciseMediaId));
      const exactReady = previous.find(
        (item) =>
          item.bindingFingerprint === bindingFingerprint &&
          item.state === "ready" &&
          item.writeState === "settled",
      );
      if (exactReady) {
        if (
          exactReady.storageProvider !== limits.storageIdentity.provider ||
          exactReady.storageStoreId !== limits.storageIdentity.storeId
        )
          throw new ExerciseCatalogAssetError("storage_identity_mismatch");
        return { existingId: exactReady.id };
      }
      if (previous.some((item) => item.bindingFingerprint === bindingFingerprint))
        throw new ExerciseCatalogAssetError("asset_pending");
      if (previous.some((item) => item.writeState !== "settled"))
        throw new ExerciseCatalogAssetError("asset_pending");
      await tx.insert(exerciseCatalogAsset).values({
        id: assetId,
        exerciseMediaId: input.exerciseMediaId,
        storageProvider: limits.storageIdentity.provider,
        storageStoreId: limits.storageIdentity.storeId,
        storageKey,
        contentType: sanitized.contentType,
        sizeBytes: sanitized.bytes.byteLength,
        sha256: contentSha256,
        width: sanitized.width,
        height: sanitized.height,
        originalFileSha256,
        sourceExerciseId: evidence.sourceExerciseId,
        sourceExternalExerciseId: evidence.sourceExternalExerciseId,
        sourceExternalMediaId: evidence.sourceExternalMediaId,
        snapshotVersion: evidence.snapshotVersion,
        snapshotAt: evidence.snapshotAt,
        licenseCode: evidence.licenseCode,
        licenseUrl: evidence.licenseUrl,
        author: evidence.author,
        attribution: evidence.attribution,
        sourceUrl: evidence.sourceUrl,
        transformationNotice: TRANSFORMATION_NOTICE,
        bindingFingerprint,
        state: "pending",
        writeState: "not_started",
      });
      return { existingId: null as string | null };
    });
    if (reservation.existingId) {
      const [existing] = await db
        .select()
        .from(exerciseCatalogAsset)
        .where(eq(exerciseCatalogAsset.id, reservation.existingId))
        .limit(1);
      if (!existing) throw new ExerciseCatalogAssetError("asset_unavailable");
      if (
        !storageMatches() ||
        existing.storageProvider !== limits.storageIdentity.provider ||
        existing.storageStoreId !== limits.storageIdentity.storeId
      )
        throw new ExerciseCatalogAssetError("storage_identity_mismatch");
      return {
        id: existing.id,
        state: "ready",
        contentType: existing.contentType,
        size: existing.sizeBytes,
        sha256: existing.sha256,
      };
    }

    await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(exerciseCatalogAsset)
        .where(eq(exerciseCatalogAsset.id, assetId))
        .for("update");
      if (!row || row.state !== "pending" || row.writeState !== "not_started" || !storageMatches())
        throw new ExerciseCatalogAssetError("asset_pending");
      await tx
        .update(exerciseCatalogAsset)
        .set({ writeState: "uncertain", updatedAt: new Date() })
        .where(
          and(
            eq(exerciseCatalogAsset.id, assetId),
            eq(exerciseCatalogAsset.writeState, "not_started"),
          ),
        );
    });

    // After this point every failure deliberately leaves the inventory uncertain and non-public.
    try {
      await storage.put(storageKey, sanitized.bytes, {
        contentType: sanitized.contentType,
        sha256: contentSha256,
      });
      const head = await storage.head(storageKey);
      if (
        !head ||
        head.contentType !== sanitized.contentType ||
        head.size !== sanitized.bytes.byteLength
      )
        throw new ExerciseCatalogAssetError("asset_unavailable");
      const stored = await storage.get(storageKey);
      if (
        !stored ||
        stored.contentType !== sanitized.contentType ||
        stored.size !== sanitized.bytes.byteLength
      )
        throw new ExerciseCatalogAssetError("asset_unavailable");
      const readback = await readBounded(stored.body, limits.maxPublishedBytes);
      if (readback.byteLength !== sanitized.bytes.byteLength || sha256(readback) !== contentSha256)
        throw new ExerciseCatalogAssetError("asset_unavailable");
      await db.transaction(async (tx) => {
        const [locked] = await tx
          .select({ media: exerciseMedia, parent: exercise })
          .from(exerciseMedia)
          .innerJoin(exercise, eq(exerciseMedia.exerciseId, exercise.id))
          .where(eq(exerciseMedia.id, input.exerciseMediaId))
          .for("update");
        if (
          !locked ||
          !evidenceMatches(locked, evidence) ||
          fingerprint(locked) !== bindingFingerprint
        )
          throw new ExerciseCatalogAssetError("evidence_mismatch");
        const [manifest] = await tx
          .select()
          .from(exerciseCatalogAsset)
          .where(eq(exerciseCatalogAsset.id, assetId))
          .for("update");
        if (!manifest || manifest.writeState !== "uncertain" || !storageMatches())
          throw new ExerciseCatalogAssetError("asset_pending");
        await tx
          .update(exerciseCatalogAsset)
          .set({ state: "ready", writeState: "settled", updatedAt: new Date() })
          .where(
            and(
              eq(exerciseCatalogAsset.id, assetId),
              eq(exerciseCatalogAsset.state, "pending"),
              eq(exerciseCatalogAsset.writeState, "uncertain"),
            ),
          );
      });
      return {
        id: assetId,
        state: "ready",
        contentType: sanitized.contentType,
        size: sanitized.bytes.byteLength,
        sha256: contentSha256,
      };
    } catch {
      throw new ExerciseCatalogAssetError("asset_pending");
    }
  }

  async function readPublishedAsset(
    assetId: string,
  ): Promise<{
    bytes: Buffer;
    contentType: "image/jpeg" | "image/png";
    size: number;
    sha256: string;
  } | null> {
    if (
      !limitsValid() ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assetId)
    )
      return null;
    const [asset] = await db
      .select()
      .from(exerciseCatalogAsset)
      .where(eq(exerciseCatalogAsset.id, assetId))
      .limit(1);
    if (
      !asset ||
      asset.state !== "ready" ||
      asset.writeState !== "settled" ||
      asset.storageKey !== keyFor(asset.id) ||
      asset.storageProvider !== limits.storageIdentity.provider ||
      asset.storageStoreId !== limits.storageIdentity.storeId ||
      !storageMatches() ||
      (asset.contentType !== "image/jpeg" && asset.contentType !== "image/png")
    )
      return null;
    const source = await loadSource(db, asset.exerciseMediaId);
    if (
      !source ||
      !approved(source) ||
      fingerprint(source) !== asset.bindingFingerprint ||
      !evidenceMatches(source, {
        sourceExerciseId: asset.sourceExerciseId,
        sourceExternalExerciseId: asset.sourceExternalExerciseId,
        exerciseMediaId: asset.exerciseMediaId,
        sourceExternalMediaId: asset.sourceExternalMediaId,
        snapshotVersion: asset.snapshotVersion,
        snapshotAt: asset.snapshotAt,
        licenseCode: asset.licenseCode,
        licenseUrl: asset.licenseUrl,
        author: asset.author,
        attribution: asset.attribution,
        sourceUrl: asset.sourceUrl,
        transformationNotice: TRANSFORMATION_NOTICE,
      }) ||
      asset.transformationNotice !== TRANSFORMATION_NOTICE ||
      !/^[0-9a-f]{64}$/.test(asset.originalFileSha256) ||
      !/^[0-9a-f]{64}$/.test(asset.sha256) ||
      !/^[0-9a-f]{64}$/.test(asset.bindingFingerprint) ||
      asset.sizeBytes < 1 ||
      asset.sizeBytes > limits.maxPublishedBytes ||
      asset.width < 1 ||
      asset.height < 1 ||
      asset.width > limits.maxOutputEdge ||
      asset.height > limits.maxOutputEdge
    )
      return null;
    try {
      const head = await storage.head(asset.storageKey);
      if (!head || head.contentType !== asset.contentType || head.size !== asset.sizeBytes)
        return null;
      const stored = await storage.get(asset.storageKey);
      if (!stored || stored.contentType !== asset.contentType || stored.size !== asset.sizeBytes)
        return null;
      const bytes = await readBounded(stored.body, limits.maxPublishedBytes);
      if (bytes.byteLength !== asset.sizeBytes || sha256(bytes) !== asset.sha256) return null;
      return {
        bytes,
        contentType: asset.contentType,
        size: bytes.byteLength,
        sha256: asset.sha256,
      };
    } catch {
      return null;
    }
  }

  async function listPublishedMetadata(
    exerciseIds: number[],
  ): Promise<Array<{ exerciseId: number; media: ExerciseCatalogMediaPreview[] }>> {
    if (
      exerciseIds.length === 0 ||
      exerciseIds.length > 50 ||
      exerciseIds.some((id) => !Number.isSafeInteger(id) || id < 1) ||
      !limitsValid() ||
      !storageMatches()
    )
      return [];
    const rows = await db
      .select({ asset: exerciseCatalogAsset, media: exerciseMedia, parent: exercise })
      .from(exerciseCatalogAsset)
      .innerJoin(exerciseMedia, eq(exerciseCatalogAsset.exerciseMediaId, exerciseMedia.id))
      .innerJoin(exercise, eq(exerciseMedia.exerciseId, exercise.id))
      .where(
        and(
          inArray(exercise.id, exerciseIds),
          eq(exerciseCatalogAsset.state, "ready"),
          eq(exerciseCatalogAsset.writeState, "settled"),
        ),
      )
      .orderBy(exercise.id, exerciseCatalogAsset.createdAt)
      .limit(200);
    const grouped = new Map<number, ExerciseCatalogMediaPreview[]>();
    for (const row of rows) {
      const asset = row.asset;
      const source = { media: row.media, parent: row.parent };
      if (
        !approved(source) ||
        !evidenceMatches(source, {
          sourceExerciseId: asset.sourceExerciseId,
          sourceExternalExerciseId: asset.sourceExternalExerciseId,
          exerciseMediaId: asset.exerciseMediaId,
          sourceExternalMediaId: asset.sourceExternalMediaId,
          snapshotVersion: asset.snapshotVersion,
          snapshotAt: asset.snapshotAt,
          licenseCode: asset.licenseCode,
          licenseUrl: asset.licenseUrl,
          author: asset.author,
          attribution: asset.attribution,
          sourceUrl: asset.sourceUrl,
          transformationNotice: TRANSFORMATION_NOTICE,
        }) ||
        fingerprint(source) !== asset.bindingFingerprint ||
        asset.transformationNotice !== TRANSFORMATION_NOTICE ||
        asset.storageProvider !== limits.storageIdentity.provider ||
        asset.storageStoreId !== limits.storageIdentity.storeId ||
        asset.storageKey !== keyFor(asset.id) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(asset.id) ||
        (asset.contentType !== "image/jpeg" && asset.contentType !== "image/png") ||
        asset.sizeBytes < 1 ||
        asset.sizeBytes > limits.maxPublishedBytes ||
        !/^[0-9a-f]{64}$/.test(asset.sha256) ||
        !/^[0-9a-f]{64}$/.test(asset.originalFileSha256) ||
        !Number.isSafeInteger(asset.width) ||
        !Number.isSafeInteger(asset.height) ||
        asset.width < 1 ||
        asset.height < 1 ||
        asset.width > limits.maxOutputEdge ||
        asset.height > limits.maxOutputEdge
      )
        continue;
      const list = grouped.get(row.parent.id) ?? [];
      if (list.length >= 4) continue;
      list.push({
        assetId: asset.id,
        path: `/api/exercise-assets/${asset.id}`,
        contentType: asset.contentType,
        width: asset.width,
        height: asset.height,
        license: asset.licenseCode,
        licenseUrl: asset.licenseUrl,
        author: asset.author,
        attribution: asset.attribution,
        sourceUrl: asset.sourceUrl,
        transformationNotice: asset.transformationNotice,
      });
      grouped.set(row.parent.id, list);
    }
    return [...grouped].map(([exerciseId, media]) => ({ exerciseId, media }));
  }

  return Object.freeze({ ingestLocalAsset, readPublishedAsset, listPublishedMetadata });
}
