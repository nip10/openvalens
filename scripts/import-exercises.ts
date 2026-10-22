import { readFile, stat } from "node:fs/promises";
import { createDb } from "../packages/db/src/index";
import { importWgerSnapshot } from "../apps/server/src/services/exercise-catalog-import";
import { normalizeWgerSnapshot } from "../apps/server/src/services/exercise-catalog-normalization";

const MAX_SNAPSHOT_BYTES = 100 * 1024 * 1024;

function usage(): never {
  console.log(
    "Usage: bun run exercises:import --file <local-wger-bundle.json> [--apply]\nDefault is dry-run (no database connection). Apply requires explicit --apply and DATABASE_URL. Offline JSON contract: {source:'wger',complete:true,snapshotVersion,snapshotAt,results:[exerciseinfo...]}; results may instead be {results:[...],next:null}. Each item requires positive id and translations:[{language:{short_name} or languageCode, name, sourceUrl, description|instructions, license:{short_name|code|name,url}, author?, attribution?}]. Optional lookups.{languages,licenses} maps IDs to those objects. Muscles/equipment use id,name/name_en; secondary muscles use muscles_secondary; image metadata uses images:[{id,license,author?,attribution?,image?}]. License is per translation/media and is never inherited. No network or media fetch is performed.",
  );
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) usage();
  const fileIndex = args.indexOf("--file");
  const file = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
  const apply = args.includes("--apply");
  if (args.some((arg) => arg !== "--apply" && arg !== "--file" && arg !== file) || !file) {
    console.error("Invalid arguments. Use --help for usage.");
    process.exitCode = 2;
    return;
  }
  const fileStat = await stat(file);
  if (!fileStat.isFile() || fileStat.size > MAX_SNAPSHOT_BYTES)
    throw new Error("Snapshot must be a regular file no larger than 100 MiB.");
  const bytes = await readFile(file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("Snapshot JSON is invalid.");
  }
  const normalized = normalizeWgerSnapshot(parsed, bytes);
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      source: "wger",
      snapshotVersion: normalized.snapshotVersion,
      snapshotAt: normalized.snapshotAt.toISOString(),
      artifactSha256: normalized.artifactSha256,
      accepted: normalized.accepted.length,
      rejectedRecords: normalized.rejectedRecords,
      rejectedTranslations: normalized.rejectedTranslations,
      rejectedMedia: normalized.rejectedMedia,
      rejectedReasonCounts: normalized.rejectedReasonCounts,
      normalizedTranslations: normalized.accepted.reduce(
        (n, row) => n + row.translations.length,
        0,
      ),
      normalizedMuscles: normalized.accepted.reduce((n, row) => n + row.muscles.length, 0),
      normalizedEquipment: normalized.accepted.reduce((n, row) => n + row.equipment.length, 0),
      normalizedMediaMetadata: normalized.accepted.reduce((n, row) => n + row.media.length, 0),
    }),
  );
  if (!apply) return;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required with --apply.");
  const db = createDb({ DATABASE_URL: databaseUrl });
  try {
    const counts = await importWgerSnapshot(db, normalized);
    console.log(JSON.stringify({ persisted: true, ...counts }));
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  // Never echo file contents, DB URL, upstream payloads, or raw driver errors.
  console.error(
    error instanceof Error &&
      /Snapshot|bundle|limit|paginated|invalid|complete|unsupported/i.test(error.message)
      ? error.message
      : "Exercise catalog import failed.",
  );
  process.exitCode = 1;
});
