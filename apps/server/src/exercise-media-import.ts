import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;
const MAX_ITEMS = 5_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const TRANSFORMATION_NOTICE = "Image decoded, EXIF-oriented, resized within publication limits, metadata-stripped, and re-encoded as JPEG or PNG.";
const LICENSE_URLS: Readonly<Record<string, string>> = {
  "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
  "CC-BY-SA-3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
  "CC-BY-SA-4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
};

type ManifestItem = {
  exerciseMediaId: number;
  sourceExerciseId: number;
  sourceExternalExerciseId: string;
  sourceExternalMediaId: string;
  snapshotVersion: string;
  snapshotAt: Date;
  licenseCode: keyof typeof LICENSE_URLS;
  licenseUrl: string;
  author: string | null;
  attribution: string | null;
  sourceUrl: string;
  transformationNotice: string;
  expectedOriginalSha256: string;
  file: string;
};

class InputError extends Error {
  constructor(readonly code: string) { super(code); }
}

const asObject = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown, max: number): string | null => typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : null;
const positiveInteger = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function parseManifest(value: unknown): ManifestItem[] {
  const root = asObject(value);
  const version = text(root?.snapshotVersion, 128);
  const snapshotAt = new Date(String(root?.snapshotAt ?? ""));
  if (!root || root.source !== "wger" || root.complete !== true || !version || !Number.isFinite(snapshotAt.getTime()) || !Array.isArray(root.items) || root.items.length > MAX_ITEMS) throw new InputError("manifest_invalid");
  const items: ManifestItem[] = [];
  for (const raw of root.items) {
    const row = asObject(raw);
    const licenseCode = text(row?.licenseCode, 32);
    const licenseUrl = text(row?.licenseUrl, 300);
    const author = row?.author === null ? null : text(row?.author, 500);
    const attribution = row?.attribution === null ? null : text(row?.attribution, 2000);
    const itemVersion = text(row?.snapshotVersion, 128);
    const itemAt = new Date(String(row?.snapshotAt ?? ""));
    const id = positiveInteger(row?.sourceExerciseId);
    const mediaId = positiveInteger(row?.exerciseMediaId);
    const externalExerciseId = text(row?.sourceExternalExerciseId, 80);
    const externalMediaId = text(row?.sourceExternalMediaId, 80);
    const sourceUrl = text(row?.sourceUrl, 2048);
    const notice = text(row?.transformationNotice, 500);
    const digest = text(row?.expectedOriginalSha256, 64);
    const file = text(row?.file, 500);
    if (!row || !id || !mediaId || !externalExerciseId || !externalMediaId || itemVersion !== version || !Number.isFinite(itemAt.getTime()) || itemAt.getTime() !== snapshotAt.getTime() ||
      !licenseCode || !(licenseCode in LICENSE_URLS) || licenseUrl !== LICENSE_URLS[licenseCode] || !sourceUrl || !notice || notice !== TRANSFORMATION_NOTICE ||
      (licenseCode !== "CC0-1.0" && (!author || !attribution)) || (row.author !== null && !author) || (row.attribution !== null && !attribution) ||
      !digest || !/^[0-9a-f]{64}$/.test(digest) || !file || isAbsolute(file) || file.includes("\\") || file.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new InputError("item_invalid");
    }
    items.push({ exerciseMediaId: mediaId, sourceExerciseId: id, sourceExternalExerciseId: externalExerciseId, sourceExternalMediaId: externalMediaId,
      snapshotVersion: itemVersion, snapshotAt: itemAt, licenseCode: licenseCode as ManifestItem["licenseCode"], licenseUrl, author, attribution,
      sourceUrl, transformationNotice: notice, expectedOriginalSha256: digest, file });
  }
  return items;
}

async function readBoundedFile(filePath: string, maxBytes: number, rejectLinks: boolean): Promise<Buffer> {
  if (rejectLinks) {
    const fileInfo = await lstat(filePath);
    if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) throw new InputError("file_not_regular");
  }
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) throw new InputError("file_size_or_type");
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maxBytes) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes - total + 1));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) throw new InputError("file_size_or_type");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

async function resolveContainedFile(root: string, relativePath: string): Promise<string> {
  const segments = relativePath.split("/");
  let current = root;
  for (let index = 0; index < segments.length; index++) {
    current = join(current, segments[index]!);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (index < segments.length - 1 && !info.isDirectory()) || (index === segments.length - 1 && !info.isFile())) throw new InputError("file_not_regular");
  }
  const resolved = await realpath(current);
  const rel = relative(root, resolved);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new InputError("file_outside_root");
  return resolved;
}

function parseArgs(args: string[]): { manifest: string; inputDir: string; apply: boolean } {
  let manifest: string | undefined;
  let inputDir: string | undefined;
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--apply") apply = true;
    else if (arg === "--manifest" && args[i + 1]) manifest = args[++i];
    else if (arg === "--input-dir" && args[i + 1]) inputDir = args[++i];
    else throw new InputError("arguments_invalid");
  }
  if (!manifest || !inputDir) throw new InputError("arguments_invalid");
  return { manifest, inputDir, apply };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: bun run exercises:media-import --manifest <local-manifest.json> --input-dir <asset-root> [--apply]. Default validates/dry-runs only; it never initializes DB or storage. Manifest paths must be relative regular files under the explicit root.");
    return;
  }
  const options = parseArgs(args);
  const rootInfo = await lstat(options.inputDir);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new InputError("input_root_invalid");
  const rootPath = await realpath(options.inputDir);
  const manifestInfo = await lstat(options.manifest);
  if (manifestInfo.isSymbolicLink() || !manifestInfo.isFile()) throw new InputError("manifest_file_invalid");
  const manifestPath = await realpath(options.manifest);
  const manifestBytes = await readBoundedFile(manifestPath, MAX_MANIFEST_BYTES, true);
  let manifestValue: unknown;
  try { manifestValue = JSON.parse(manifestBytes.toString("utf8")) as unknown; } catch { throw new InputError("manifest_invalid"); }
  const items = parseManifest(manifestValue);
  const { sanitizeImage } = await import("@openvalens/body/sanitize-image");
  const imageLimits = { maxInputBytes: MAX_IMAGE_BYTES, maxInputPixels: 16_000_000, maxOutputEdge: 2048, maxOutputBytes: MAX_OUTPUT_BYTES };
  const failures: Record<string, number> = {};
  if (!options.apply) {
    let acceptedFiles = 0;
    for (const item of items) {
      try {
        const imagePath = await resolveContainedFile(rootPath, item.file);
        const bytes = await readBoundedFile(imagePath, MAX_IMAGE_BYTES, true);
        if (sha(bytes) !== item.expectedOriginalSha256) throw new InputError("source_sha_mismatch");
        const sanitized = await sanitizeImage(bytes, imageLimits);
        if (sanitized.bytes.byteLength > MAX_OUTPUT_BYTES) throw new InputError("canonical_output_too_large");
        acceptedFiles++;
      } catch (error) {
        const reason = error instanceof InputError ? error.code : "asset_invalid";
        failures[reason] = (failures[reason] ?? 0) + 1;
      }
    }
    console.log(JSON.stringify({ mode: "dry-run", acceptedFiles, rejectedFiles: Object.values(failures).reduce((a, b) => a + b, 0), rejectionCounts: failures, databaseEligibilityVerified: false, publicationVerified: false }));
    return;
  }

  // Apply-only imports: dry-run has not loaded env, database, storage, or the server services module.
  const [{ ENV }, { createDb }, { parseStorageConfig, createObjectStorage }, { createExerciseCatalogAssetService }] = await Promise.all([
    import("./env.server"), import("@openvalens/db"), import("@openvalens/storage"), import("./services/exercise-catalog-assets"),
  ]);
  const db = createDb(ENV);
  try {
    const storageConfig = parseStorageConfig(ENV);
    const storage = createObjectStorage(storageConfig);
    if (!storage?.storeIdentity) throw new InputError("storage_unavailable");
    const service = createExerciseCatalogAssetService({ db, storage, limits: {
      ...imageLimits,
      maxPublishedBytes: Math.min(storageConfig.maxObjectBytes, MAX_OUTPUT_BYTES),
      storageIdentity: storage.storeIdentity,
    } });
    let validatedFiles = 0;
    let published = 0;
    for (const item of items) {
      try {
        const imagePath = await resolveContainedFile(rootPath, item.file);
        const bytes = await readBoundedFile(imagePath, MAX_IMAGE_BYTES, true);
        if (sha(bytes) !== item.expectedOriginalSha256) throw new InputError("source_sha_mismatch");
        const sanitized = await sanitizeImage(bytes, imageLimits);
        if (sanitized.bytes.byteLength > MAX_OUTPUT_BYTES) throw new InputError("canonical_output_too_large");
        validatedFiles++;
        await service.ingestLocalAsset({ exerciseMediaId: item.exerciseMediaId, bytes, expectedOriginalSha256: item.expectedOriginalSha256, publicationEvidence: item });
        published++;
      } catch (error) {
        const reason = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "publication_failed";
        failures[reason] = (failures[reason] ?? 0) + 1;
      }
    }
    console.log(JSON.stringify({ mode: "apply", validatedFiles, readyOrAlreadyReady: published, rejectedFiles: Object.values(failures).reduce((a, b) => a + b, 0), rejectionCounts: failures }));
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  const reason = error instanceof InputError ? error.code : "import_failed";
  console.error(JSON.stringify({ error: reason }));
  process.exitCode = 1;
});
