#!/usr/bin/env bun
/**
 * Food catalog import CLI (Issue #72). Imports one downloaded upstream
 * artifact (JSON Lines, one food/product per line) into its own mirror table
 * and records the release: artifact name, SHA-256, license and attribution.
 *
 *   DATABASE_URL=... bun --no-env-file scripts/food-catalog-import.ts \
 *     --source off --file ./openfoodfacts-products.jsonl \
 *     --dataset products --version 2026-10-14 \
 *     --source-url https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz
 *
 * Inputs (see DATA-LICENSES.md for exact artifacts and how to regenerate):
 * - Open Food Facts: the decompressed `openfoodfacts-products.jsonl` dump.
 * - USDA FoodData Central: a download JSON flattened to JSON Lines, e.g.
 *   `jq -c '.FoundationFoods[]' FoodData_Central_foundation_food_json_*.json`.
 *
 * This script is the published transform for the OFF-derived tables (ODbL
 * §4.6b): running it over the same dump regenerates them. It is an operator
 * tool, never a request path. It needs an explicit `DATABASE_URL` (or
 * `DATABASE_URL_FILE`), refuses a non-loopback database without
 * `--allow-remote`, and prints counts only — never record contents.
 */

import { createHash } from "node:crypto";
import { basename } from "node:path";

import { createDb } from "../packages/db/src/index.ts";
import {
  createFoodCatalog,
  isCatalogSource,
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
  "Usage: food-catalog-import --source fdc|off --file <path.jsonl> --dataset <name> --version <release> --source-url <url> [--allow-remote]";

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

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
  return hash.digest("hex");
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

  const manifest: CatalogReleaseManifest = {
    ...command.manifest,
    artifact: basename(command.file),
    artifactSha256: await sha256File(command.file),
  };
  const db = createDb({ DATABASE_URL: url });
  try {
    const result = await createFoodCatalog(db).importRelease(
      manifest,
      readJsonLines(Bun.file(command.file).stream()),
    );
    process.stdout.write(`${describeResult(result)}\n`);
  } catch {
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
