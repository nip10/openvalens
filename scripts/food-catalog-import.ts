#!/usr/bin/env bun
/**
 * Food catalog import CLI (Issue #72). Imports one downloaded upstream
 * artifact into its own mirror table and records the release: artifact name,
 * SHA-256, license and attribution. Self-hosters run it through
 * `deploy/setup.sh catalogs` (docs/self-hosting/food-catalogs.md).
 *
 *   DATABASE_URL=... bun --no-env-file scripts/food-catalog-import.ts \
 *     --source off --file ./openfoodfacts-products.jsonl \
 *     --dataset products --version 2026-10-14 \
 *     --source-url https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz
 *
 * Inputs (see DATA-LICENSES.md for exact artifacts and how to regenerate),
 * chosen by file name and streamed, never loaded whole:
 * - `.jsonl` / `.jsonl.gz`: one food/product per line, e.g. the Open Food
 *   Facts dump `openfoodfacts-products.jsonl.gz` as published.
 * - `.json` / `.zip`: a USDA FoodData Central JSON download as published
 *   (`{"FoundationFoods": [...]}`), or its zip with that one JSON file.
 *
 * This script is the published transform for the OFF-derived tables (ODbL
 * §4.6b): running it over the same dump regenerates them. It is an operator
 * tool, never a request path. It needs an explicit `DATABASE_URL` (or
 * `DATABASE_URL_FILE`), refuses a non-loopback database without
 * `--allow-remote`, and prints counts only — never record contents.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { createGunzip, createInflateRaw } from "node:zlib";

import { createDb } from "../packages/db/src/index.ts";
import {
  createFoodCatalog,
  isCatalogSource,
  readJsonArrayItems,
  readJsonLines,
  type CatalogImportResult,
  type CatalogReleaseManifest,
} from "../packages/nutrition/src/catalog.ts";
import { isLoopbackDatabaseUrl } from "./admission.ts";

export type ImportCommand = {
  file: string;
  manifest: Omit<CatalogReleaseManifest, "artifact" | "artifactSha256">;
  allowRemote: boolean;
};

export type ParseResult = { ok: true; command: ImportCommand } | { ok: false; message: string };

const USAGE =
  "Usage: food-catalog-import --source fdc|off --file <path.jsonl|.jsonl.gz|.json|.zip> --dataset <name> --version <release> --source-url <url> [--allow-remote]";

export type InputFormat = "jsonl" | "jsonl.gz" | "json" | "zip";

/** Input format from the file name; `null` when it is not supported. */
export function inputFormat(file: string): InputFormat | null {
  const name = basename(file).toLowerCase();
  if (name.endsWith(".jsonl")) return "jsonl";
  if (name.endsWith(".jsonl.gz")) return "jsonl.gz";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".zip")) return "zip";
  return null;
}

/** A problem with the input file itself; its message names no record content. */
class InputError extends Error {}

const VALUE_FLAGS = ["--source", "--file", "--dataset", "--version", "--source-url"] as const;

/** Pure argument parser; failure messages never echo values. */
export function parseArgs(argv: readonly string[]): ParseResult {
  const values: Partial<Record<(typeof VALUE_FLAGS)[number], string>> = {};
  let allowRemote = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--allow-remote") {
      allowRemote = true;
      continue;
    }
    const flag = VALUE_FLAGS.find((name) => name === arg);
    const value = argv[i + 1];
    if (!flag || value === undefined || value.startsWith("--") || values[flag] !== undefined)
      return { ok: false, message: `Invalid arguments.\n${USAGE}` };
    values[flag] = value;
    i += 1;
  }
  const missing = VALUE_FLAGS.filter((flag) => !values[flag]?.trim());
  if (missing.length) return { ok: false, message: `Missing ${missing.join(", ")}.\n${USAGE}` };
  if (!isCatalogSource(values["--source"]))
    return { ok: false, message: `Source must be fdc or off.\n${USAGE}` };
  if (!values["--source-url"]!.startsWith("https://"))
    return { ok: false, message: `Source URL must be https.\n${USAGE}` };
  if (!inputFormat(values["--file"]!))
    return { ok: false, message: `File must be .jsonl, .jsonl.gz, .json or .zip.\n${USAGE}` };
  return {
    ok: true,
    command: {
      file: values["--file"]!,
      allowRemote,
      manifest: {
        source: values["--source"],
        dataset: values["--dataset"]!.trim(),
        version: values["--version"]!.trim(),
        sourceUrl: values["--source-url"]!.trim(),
      },
    },
  };
}

const PROGRESS_EVERY = 100_000;

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * The stream of the single JSON file inside a FoodData Central download zip.
 * Only the first entry is read (stored or deflated); the inflater stops at
 * the end of its compressed data, so the rest of the archive is ignored.
 */
async function zipEntryStream(path: string): Promise<AsyncIterable<Uint8Array>> {
  const header = new DataView(await Bun.file(path).slice(0, 30).arrayBuffer());
  if (header.byteLength < 30 || header.getUint32(0, true) !== 0x04034b50)
    throw new InputError("Input is not a zip archive.");
  const flags = header.getUint16(6, true);
  const method = header.getUint16(8, true);
  const compressedSize = header.getUint32(18, true);
  const nameLength = header.getUint16(26, true);
  const name = await Bun.file(path)
    .slice(30, 30 + nameLength)
    .text();
  if (!name.toLowerCase().endsWith(".json"))
    throw new InputError("The zip's first entry must be a .json file.");
  const start = 30 + nameLength + header.getUint16(28, true);
  if (method === 8) return createReadStream(path, { start }).pipe(createInflateRaw());
  if (method === 0 && !(flags & 0x08) && compressedSize !== 0xffffffff)
    return createReadStream(path, { start, end: start + compressedSize - 1 });
  throw new InputError("Unsupported zip compression.");
}

/** Items of the input file, streamed in its format. */
export async function openItems(
  path: string,
  format: InputFormat,
): Promise<AsyncIterable<unknown>> {
  switch (format) {
    case "jsonl":
      return readJsonLines(createReadStream(path));
    case "jsonl.gz":
      return readJsonLines(createReadStream(path).pipe(createGunzip()));
    case "json":
      return readJsonArrayItems(createReadStream(path));
    case "zip":
      return readJsonArrayItems(await zipEntryStream(path));
  }
}

/** Passes items through, reporting the running count (never content) every `every` items. */
export async function* withProgress<T>(
  items: AsyncIterable<T>,
  every: number,
  report: (count: number) => void,
): AsyncGenerator<T> {
  let count = 0;
  for await (const item of items) {
    yield item;
    count += 1;
    if (count % every === 0) report(count);
  }
}

export function describeResult(result: CatalogImportResult): string {
  return result.imported
    ? `Imported release ${result.releaseId}: ${result.recordCount} records, ${result.rejectedCount} rejected.`
    : `Release ${result.releaseId} was already imported; nothing changed.`;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n`);
    process.exitCode = 1;
    return;
  }
  const { command } = parsed;
  if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_FILE) {
    process.stderr.write("An explicit DATABASE_URL or DATABASE_URL_FILE is required.\n");
    process.exitCode = 1;
    return;
  }
  await import("@openvalens/config/file-secrets-preload.database");
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write("An explicit DATABASE_URL or DATABASE_URL_FILE is required.\n");
    process.exitCode = 1;
    return;
  }
  if (!isLoopbackDatabaseUrl(url) && !command.allowRemote) {
    process.stderr.write("Refusing a remote database without --allow-remote.\n");
    process.exitCode = 1;
    return;
  }
  if (!(await Bun.file(command.file).exists())) {
    process.stderr.write("Input file not found.\n");
    process.exitCode = 1;
    return;
  }

  const artifact = basename(command.file);
  process.stderr.write(`Checksumming ${artifact}...\n`);
  const manifest: CatalogReleaseManifest = {
    ...command.manifest,
    artifact,
    artifactSha256: await sha256File(command.file),
  };
  const db = createDb({ DATABASE_URL: url });
  try {
    process.stderr.write(`Importing ${artifact} (one transaction; large files take a while)...\n`);
    const items = withProgress(
      await openItems(command.file, inputFormat(command.file)!),
      PROGRESS_EVERY,
      (count) => process.stderr.write(`  ${count} items read\n`),
    );
    const result = await createFoodCatalog(db).importRelease(manifest, items);
    process.stdout.write(`${describeResult(result)}\n`);
  } catch (error) {
    if (error instanceof InputError) process.stderr.write(`${error.message}\n`);
    process.stderr.write("Import failed; no rows were changed.\n");
    process.exitCode = 1;
  } finally {
    const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
    if (client) await client.end();
  }
}

if (import.meta.main) {
  await main();
}
