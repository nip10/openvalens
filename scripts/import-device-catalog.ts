#!/usr/bin/env bun
/**
 * Import the upstream Gadgetbridge device catalog (Issue #430).
 *
 * `device_support.yml` is reference data published by the Gadgetbridge website
 * under AGPL-3.0-or-later. This tool pins one commit, keeps the verbatim source
 * bytes next to the normalized artifact, and regenerates the artifact from
 * those bytes. See `docs/device-catalog.md` for the refresh procedure.
 *
 * Modes:
 *   --check     Offline. Verify source SHA-256 and artifact freshness.
 *   --revision  Fetch a pinned commit and rewrite source + artifact.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse } from "yaml";

import type {
  GadgetbridgeCatalog,
  GadgetbridgeCatalogMeta,
  GadgetbridgeDevice,
  GadgetbridgeFeatureLevel,
} from "../packages/health-record/src/device-catalog/types";

const REPO_ROOT = join(import.meta.dir, "..");
export const SOURCE_PATH = join(
  REPO_ROOT,
  "packages/health-record/src/device-catalog/source/device_support.yml",
);
export const ARTIFACT_PATH = join(
  REPO_ROOT,
  "packages/health-record/src/device-catalog/gadgetbridge-catalog.json",
);

const SOURCE_FILE = "device_support.yml";
const REPOSITORY_URL = "https://codeberg.org/Freeyourgadget/website";
const LICENSE = "AGPL-3.0-or-later";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const FEATURE_LEVELS = new Set<string>(["high", "most", "partial", "poor", "unknown"]);

const USAGE = `Usage:
  bun scripts/import-device-catalog.ts --check
      Offline. Verify the committed source SHA-256 and that the artifact
      regenerates exactly from the committed source. This is the default.

  bun scripts/import-device-catalog.ts --revision <40-hex-commit-sha> [--retrieved-at <iso>]
      Fetch device_support.yml at a pinned commit, then rewrite the verbatim
      source snapshot and the normalized artifact.

Options:
  --check          Verify only; never uses the network. Default mode.
  --revision       Full 40-character hexadecimal commit SHA. Branch names and
                   short SHAs are rejected.
  --retrieved-at   ISO-8601 timestamp recorded in meta.retrievedAt.
                   Defaults to now, UTC, seconds precision.
  -h, --help       Show this help.`;

type CatalogProvenance = Readonly<{
  revision: string;
  retrievedAt: string;
  sha256: string;
}>;

export type CheckResult =
  | { ok: true; deviceCount: number; sha256: string }
  | { ok: false; reason: string; details?: string };

export type CatalogPaths = Readonly<{ sourcePath?: string; artifactPath?: string }>;

export type Command =
  | { mode: "check" }
  | { mode: "refresh"; revision: string; retrievedAt?: string }
  | { mode: "help" };

export type ParseResult = { ok: true; command: Command } | { ok: false; error: string };

/** SHA-256 of the exact bytes, lowercase hex. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** True only for a full lowercase 40-character commit SHA. */
export function isCommitRevision(value: string): boolean {
  return COMMIT_PATTERN.test(value);
}

/** Normalize an ISO-8601 instant to UTC with seconds precision, or null. */
export function normalizeTimestamp(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function sourceUrlFor(revision: string): string {
  return `${REPOSITORY_URL}/raw/commit/${revision}/${SOURCE_FILE}`;
}

function attributionFor(revision: string): string {
  return `Device support data from the Gadgetbridge website (codeberg.org/Freeyourgadget/website), ${LICENSE}, revision ${revision}.`;
}

function buildMeta(provenance: CatalogProvenance, deviceCount: number): GadgetbridgeCatalogMeta {
  return {
    source: SOURCE_FILE,
    repository: REPOSITORY_URL,
    sourceUrl: sourceUrlFor(provenance.revision),
    revision: provenance.revision,
    retrievedAt: provenance.retrievedAt,
    sha256: provenance.sha256,
    license: LICENSE,
    attribution: attributionFor(provenance.revision),
    deviceCount,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectString(value: unknown, what: string): string {
  if (typeof value !== "string") throw new Error(`${what} must be a string.`);
  return value;
}

function readFlags(value: unknown, id: string): string[] {
  if (!Array.isArray(value)) throw new Error(`device_support.${id}.flags must be a list.`);
  const flags = value.map((flag, index) =>
    expectString(flag, `device_support.${id}.flags[${index}]`),
  );
  return [...new Set(flags)].sort();
}

function readLinks(value: unknown, id: string): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error(`device_support.${id}.links must be a mapping.`);
  const links: Record<string, string> = {};
  for (const key of Object.keys(value).sort()) {
    links[key] = expectString(value[key], `device_support.${id}.links.${key}`);
  }
  return links;
}

function resolveVendor(
  mappings: Record<string, unknown>,
  category: string,
  vendor: string,
): string {
  const categoryMappings = mappings[category];
  if (!isRecord(categoryMappings)) return vendor;
  const mapped = categoryMappings[vendor];
  return typeof mapped === "string" ? mapped : vendor;
}

/**
 * Normalize the verbatim upstream YAML into the committed artifact shape.
 *
 * Keys are sorted with the default JavaScript string order, flags are sorted
 * and deduplicated, and every field is derived only from the YAML plus the
 * pinned provenance. The output must be deterministic.
 */
export function buildCatalog(yamlText: string, provenance: CatalogProvenance): GadgetbridgeCatalog {
  let document: unknown;
  try {
    // Upstream reuses anchors heavily (one per flag combination). The `yaml`
    // package's default alias limit throws `Excessive alias count` on this
    // file, so aliases are resolved without a cap. The source is a trusted,
    // pinned snapshot, not user input.
    document = parse(yamlText, { maxAliasCount: -1 });
  } catch (error) {
    throw new Error(
      `Cannot parse ${SOURCE_FILE}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(document)) throw new Error(`${SOURCE_FILE} must be a YAML mapping.`);

  const rawDevices = document.device_support;
  if (!isRecord(rawDevices)) {
    throw new Error(`${SOURCE_FILE} is missing the "device_support" mapping.`);
  }

  const mappings = isRecord(document.vendor_mappings) ? document.vendor_mappings : {};
  const devices: Record<string, GadgetbridgeDevice> = {};

  for (const id of Object.keys(rawDevices).sort()) {
    const entry = rawDevices[id];
    if (!isRecord(entry)) throw new Error(`device_support.${id} must be a mapping.`);

    const category = expectString(entry.category, `device_support.${id}.category`);
    const vendor = expectString(entry.vendor, `device_support.${id}.vendor`);
    const flags = readFlags(entry.flags, id);

    const featureFlag = flags.find((flag) => flag.startsWith("feature_"));
    const featureSuffix = featureFlag?.slice("feature_".length);
    // Upstream only publishes the five known levels. If a future level appears,
    // keep the artifact valid and let `--check` surface the source change.
    const featureLevel: GadgetbridgeFeatureLevel =
      featureSuffix !== undefined && FEATURE_LEVELS.has(featureSuffix)
        ? (featureSuffix as GadgetbridgeFeatureLevel)
        : "unknown";

    const pairFlag = flags.find((flag) => flag.startsWith("pair_"));
    const osFlag = flags.find((flag) => flag.startsWith("os_"));

    devices[id] = {
      id,
      category,
      vendor,
      resolvedVendor: resolveVendor(mappings, category, vendor),
      flags,
      featureLevel,
      pairMode: pairFlag === undefined ? "unknown" : pairFlag.slice("pair_".length),
      os: osFlag === undefined ? null : osFlag.slice("os_".length),
      experimental: flags.includes("experimental"),
      links: readLinks(entry.links, id),
    };
  }

  const deviceCount = Object.keys(devices).length;
  return { meta: buildMeta(provenance, deviceCount), devices };
}

/** The exact on-disk artifact representation: 2-space JSON plus newline. */
export function serializeCatalog(catalog: GadgetbridgeCatalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

/** Readable, bounded line diff for `--check` failures. */
export function summarizeDiff(expected: string, actual: string, maxDiffs = 12): string {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const total = Math.max(expectedLines.length, actualLines.length);
  const lines: string[] = [];
  let shown = 0;
  for (let index = 0; index < total && shown < maxDiffs; index += 1) {
    if (expectedLines[index] === actualLines[index]) continue;
    shown += 1;
    lines.push(`  line ${index + 1}:`);
    lines.push(`    expected: ${expectedLines[index] ?? "<missing>"}`);
    lines.push(`    actual:   ${actualLines[index] ?? "<missing>"}`);
  }
  return lines.length > 0
    ? lines.join("\n")
    : "  (no line differences; the file may differ only in line endings)";
}

/**
 * Offline verification. Re-parses the committed source, checks its SHA-256
 * against the artifact, then regenerates and compares the artifact with
 * `meta.retrievedAt` taken from the artifact itself.
 */
export async function checkCatalog(paths: CatalogPaths = {}): Promise<CheckResult> {
  const sourcePath = paths.sourcePath ?? SOURCE_PATH;
  const artifactPath = paths.artifactPath ?? ARTIFACT_PATH;

  let sourceBytes: Uint8Array;
  try {
    sourceBytes = await readFile(sourcePath);
  } catch {
    return { ok: false, reason: `Cannot read committed source at ${sourcePath}.` };
  }

  let artifactText: string;
  try {
    artifactText = await readFile(artifactPath, "utf8");
  } catch {
    return { ok: false, reason: `Cannot read committed artifact at ${artifactPath}.` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(artifactText) as unknown;
  } catch {
    return { ok: false, reason: "The committed artifact is not valid JSON." };
  }
  if (!isRecord(parsed) || !isRecord(parsed.meta)) {
    return { ok: false, reason: 'The committed artifact has no "meta" object.' };
  }

  const meta = parsed.meta;
  const revision = meta.revision;
  const retrievedAt = meta.retrievedAt;
  const recordedSha = meta.sha256;
  const recordedCount = meta.deviceCount;
  if (typeof revision !== "string" || !isCommitRevision(revision)) {
    return {
      ok: false,
      reason: "meta.revision is not a full 40-character lowercase commit SHA.",
    };
  }
  if (typeof retrievedAt !== "string") {
    return { ok: false, reason: "meta.retrievedAt must be a string." };
  }
  if (typeof recordedSha !== "string") {
    return { ok: false, reason: "meta.sha256 must be a string." };
  }
  if (typeof recordedCount !== "number") {
    return { ok: false, reason: "meta.deviceCount must be a number." };
  }

  const actualSha = sha256Hex(sourceBytes);
  if (actualSha !== recordedSha) {
    return {
      ok: false,
      reason: `SHA-256 mismatch: source is ${actualSha}, artifact records ${recordedSha}.`,
    };
  }

  let regenerated: GadgetbridgeCatalog;
  try {
    regenerated = buildCatalog(new TextDecoder().decode(sourceBytes), {
      revision,
      retrievedAt,
      sha256: actualSha,
    });
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Cannot normalize the committed source.",
    };
  }

  const regeneratedCount = Object.keys(regenerated.devices).length;
  if (recordedCount !== regeneratedCount) {
    return {
      ok: false,
      reason: `deviceCount mismatch: source has ${regeneratedCount}, artifact records ${recordedCount}.`,
    };
  }

  const expected = serializeCatalog(regenerated);
  if (expected !== artifactText) {
    return {
      ok: false,
      reason: "The committed artifact does not match the normalized source.",
      details: summarizeDiff(expected, artifactText),
    };
  }

  return { ok: true, deviceCount: regeneratedCount, sha256: actualSha };
}

function looksLikeHtml(text: string): boolean {
  return /^(?:\s*<!doctype html|\s*<html[\s>])/i.test(text.slice(0, 512));
}

/**
 * Fetch one pinned commit, write the verbatim source, then the normalized
 * artifact. Nothing is written until the response and YAML have validated.
 */
export async function refreshCatalog(
  revision: string,
  retrievedAt?: string,
): Promise<{ deviceCount: number; sha256: string }> {
  if (!isCommitRevision(revision)) {
    throw new Error("Revision must be a full 40-character lowercase commit SHA.");
  }
  const timestamp = normalizeTimestamp(retrievedAt ?? new Date());
  if (timestamp === null) throw new Error("retrievedAt must be a valid ISO-8601 timestamp.");

  const url = sourceUrlFor(revision);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(
      `Cannot fetch ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (response.status !== 200) {
    throw new Error(`Fetch failed: HTTP ${response.status} for ${url}.`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("text/html") || looksLikeHtml(text)) {
    throw new Error(`Fetch returned HTML instead of ${SOURCE_FILE}; refusing to write it.`);
  }

  const catalog = buildCatalog(text, {
    revision,
    retrievedAt: timestamp,
    sha256: sha256Hex(bytes),
  });

  await mkdir(dirname(SOURCE_PATH), { recursive: true });
  await writeFile(SOURCE_PATH, bytes);
  await writeFile(ARTIFACT_PATH, serializeCatalog(catalog));

  return {
    deviceCount: Object.keys(catalog.devices).length,
    sha256: catalog.meta.sha256,
  };
}

/** Parse the CLI contract without touching the network or the filesystem. */
export function parseArgs(argv: readonly string[]): ParseResult {
  let check = false;
  let revision: string | undefined;
  let retrievedAt: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { ok: true, command: { mode: "help" } };
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg === "--revision") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        return { ok: false, error: "--revision requires a commit SHA." };
      }
      revision = value;
      index += 1;
      continue;
    }
    if (arg === "--retrieved-at") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        return { ok: false, error: "--retrieved-at requires an ISO-8601 timestamp." };
      }
      retrievedAt = value;
      index += 1;
      continue;
    }
    return { ok: false, error: `Unknown argument: ${arg}` };
  }

  if (check && revision !== undefined) {
    return { ok: false, error: "--check and --revision are mutually exclusive." };
  }
  if (retrievedAt !== undefined && revision === undefined) {
    return { ok: false, error: "--retrieved-at requires --revision." };
  }
  if (revision !== undefined) {
    if (!isCommitRevision(revision)) {
      return {
        ok: false,
        error:
          "--revision must be a full 40-character hexadecimal commit SHA, not a branch name or short SHA.",
      };
    }
    if (retrievedAt !== undefined && normalizeTimestamp(retrievedAt) === null) {
      return { ok: false, error: "--retrieved-at must be a valid ISO-8601 timestamp." };
    }
    return { ok: true, command: { mode: "refresh", revision, retrievedAt } };
  }
  return { ok: true, command: { mode: "check" } };
}

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    console.error(`error: ${parsed.error}\n`);
    console.error(USAGE);
    return 2;
  }

  const command = parsed.command;
  if (command.mode === "help") {
    console.log(USAGE);
    return 0;
  }

  if (command.mode === "check") {
    const result = await checkCatalog();
    if (result.ok) {
      console.log(
        `Device catalog is up to date (${result.deviceCount} devices, sha256 ${result.sha256}).`,
      );
      return 0;
    }
    console.error(`Device catalog check failed: ${result.reason}`);
    if (result.details !== undefined) console.error(result.details);
    console.error(
      "Refresh with `bun scripts/import-device-catalog.ts --revision <commit-sha>`, then commit the source and artifact together.",
    );
    return 1;
  }

  try {
    const summary = await refreshCatalog(command.revision, command.retrievedAt);
    console.log(
      `Updated device catalog: ${summary.deviceCount} devices, revision ${command.revision}, sha256 ${summary.sha256}.`,
    );
    return 0;
  } catch (error) {
    console.error(
      `Device catalog refresh failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => {
      if (code !== 0) process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(
        `Device catalog import failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    });
}
