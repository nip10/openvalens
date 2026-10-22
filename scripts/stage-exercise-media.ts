import { createHash } from "node:crypto";
import { mkdir, open, lstat, readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createDb, sql } from "../packages/db/src/index";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_MS = 30_000;
const NOTICE =
  "Image decoded, EXIF-oriented, resized within publication limits, metadata-stripped, and re-encoded as JPEG or PNG.";
const LICENSE_URLS: Record<string, string> = {
  "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
  "CC-BY-SA-3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
  "CC-BY-SA-4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
};

type Snapshot = {
  snapshotVersion: string;
  snapshotAt: string;
  results: Array<Record<string, any>>;
};
function usage() {
  console.log(
    "Usage: bun run exercises:media-stage --file <pinned-snapshot.json> --output-dir <new-dir> --manifest <new-manifest.json> [--media-id <wger-image-id>]\nExplicit network staging only; no DB writes or storage publication. Default selects at most one eligible image.",
  );
}
function parse(args: string[]) {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (!["--file", "--output-dir", "--manifest", "--media-id"].includes(flag) || !args[i + 1])
      throw new Error("arguments_invalid");
    values[flag] = args[++i]!;
  }
  if (!values["--file"] || !values["--output-dir"] || !values["--manifest"])
    throw new Error("arguments_invalid");
  return values;
}
function publicImageUrl(value: unknown) {
  if (typeof value !== "string") throw new Error("image_url_invalid");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "wger.de" ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/media\/exercise-images\/\d+\/[0-9a-f-]+\.(?:jpe?g|png)$/i.test(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new Error("image_url_untrusted");
  return url;
}
export async function downloadBounded(url: URL, fetcher: typeof fetch = fetch) {
  if (
    url.protocol !== "https:" ||
    url.hostname !== "wger.de" ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/media\/exercise-images\/\d+\/[0-9a-f-]+\.(?:jpe?g|png)$/i.test(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new Error("image_url_untrusted");
  const response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(MAX_MS) });
  if (response.status >= 300 && response.status < 400) throw new Error("image_redirect_rejected");
  if (!response.ok || !response.body) throw new Error("image_download_failed");
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new Error("image_size_limit");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error("image_size_limit");
    }
    parts.push(next.value);
  }
  if (declared && !response.headers.has("content-encoding") && size !== declared)
    throw new Error("image_truncated");
  return Buffer.concat(
    parts.map((part) => Buffer.from(part)),
    size,
  );
}

export async function createNewOutputDirectory(outputDir: string, manifestPath: string) {
  const parentInfo = await lstat(dirname(outputDir));
  if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory())
    throw new Error("output_parent_invalid");
  if (
    (await realpath(dirname(outputDir))) !== dirname(outputDir) ||
    (await realpath(dirname(manifestPath))) !== dirname(manifestPath)
  )
    throw new Error("output_symlink_escape");
  await mkdir(outputDir, { mode: 0o700 });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) return usage();
  const options = parse(args);
  const snapshotBytes = await readFile(options["--file"]!);
  const snapshot = JSON.parse(snapshotBytes.toString("utf8")) as Snapshot;
  if (
    !snapshot.snapshotVersion ||
    !Number.isFinite(new Date(snapshot.snapshotAt).getTime()) ||
    !Array.isArray(snapshot.results)
  )
    throw new Error("snapshot_invalid");
  const wanted = options["--media-id"];
  const rows = snapshot.results
    .flatMap((row) => (row.images ?? []).map((image: Record<string, any>) => ({ row, image })))
    .filter(
      ({ image }) =>
        (!wanted || String(image.id) === wanted) &&
        LICENSE_URLS[image.license?.short_name] === image.license?.url &&
        (image.license?.short_name === "CC0-1.0" || Boolean(image.author && image.attribution)) &&
        image.image.startsWith("https://wger.de/"),
    );
  if (rows.length === 0) throw new Error("no_eligible_image");
  const selected = rows.slice(0, 1);
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL_required_for_media_binding");
  const db = createDb({ DATABASE_URL: dbUrl });
  const outputDir = resolve(options["--output-dir"]!);
  const manifestPath = resolve(options["--manifest"]!);
  await createNewOutputDirectory(outputDir, manifestPath);
  const manifestItems = [];
  try {
    for (const { row, image } of selected) {
      const exerciseRows = await db.execute(
        sql`select id, external_id, snapshot_version, snapshot_at from exercise where source='wger' and external_id=${String(row.id)} limit 1`,
      );
      const exerciseRow = exerciseRows.rows[0] as
        | { id: number; external_id: string; snapshot_version: string; snapshot_at: Date | string }
        | undefined;
      if (
        !exerciseRow ||
        exerciseRow.snapshot_version !== snapshot.snapshotVersion ||
        !exerciseRow.snapshot_at ||
        new Date(exerciseRow.snapshot_at).toISOString() !==
          new Date(snapshot.snapshotAt).toISOString()
      )
        throw new Error("snapshot_not_imported_or_mismatched");
      const mediaRows = await db.execute(
        sql`select id, license_code, license_url, author, raw_attribution, source_media_url, publication_active from exercise_media where exercise_id=${exerciseRow.id} and source_external_media_id=${String(image.id)} limit 1`,
      );
      const mediaRow = mediaRows.rows[0] as
        | {
            id: number;
            license_code: string;
            license_url: string;
            author: string | null;
            raw_attribution: string | null;
            source_media_url: string;
            publication_active: boolean;
          }
        | undefined;
      if (
        !mediaRow ||
        !mediaRow.publication_active ||
        mediaRow.license_code !== image.license.short_name ||
        mediaRow.license_url !== image.license.url ||
        mediaRow.author !== image.author ||
        mediaRow.raw_attribution !== image.attribution ||
        mediaRow.source_media_url !== image.image
      )
        throw new Error("image_rights_binding_mismatch");
      const url = publicImageUrl(image.image);
      const bytes = await downloadBounded(url);
      const ext = url.pathname.toLowerCase().endsWith(".png")
        ? "png"
        : url.pathname.toLowerCase().endsWith(".jpeg")
          ? "jpeg"
          : "jpg";
      const file = `wger-exercise-${row.id}-image-${image.id}.${ext}`;
      const handle = await open(resolve(outputDir, file), "wx", 0o600);
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
      manifestItems.push({
        exerciseMediaId: mediaRow.id,
        sourceExerciseId: exerciseRow.id,
        sourceExternalExerciseId: String(row.id),
        sourceExternalMediaId: String(image.id),
        snapshotVersion: snapshot.snapshotVersion,
        snapshotAt: snapshot.snapshotAt,
        licenseCode: mediaRow.license_code,
        licenseUrl: mediaRow.license_url,
        author: mediaRow.author,
        attribution: mediaRow.raw_attribution,
        sourceUrl: mediaRow.source_media_url,
        transformationNotice: NOTICE,
        expectedOriginalSha256: createHash("sha256").update(bytes).digest("hex"),
        file,
      });
    }
    const manifest = {
      source: "wger",
      complete: true,
      snapshotVersion: snapshot.snapshotVersion,
      snapshotAt: snapshot.snapshotAt,
      items: manifestItems,
    };
    const handle = await open(manifestPath, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(manifest));
    } finally {
      await handle.close();
    }
    console.log(
      JSON.stringify({
        staged: manifestItems.length,
        manifest: manifestPath,
        files: manifestItems.map((item) => ({
          file: item.file,
          sha256: item.expectedOriginalSha256,
        })),
      }),
    );
  } finally {
    await db.$client.end();
  }
}

if (import.meta.main)
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "media_stage_failed");
    process.exitCode = 1;
  });
