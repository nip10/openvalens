#!/usr/bin/env bun
/**
 * Issue #306 — one release version for the repository.
 *
 * The root `package.json` version is the source of truth. Three places carry
 * it and must agree:
 *
 * - `package.json` → `version` (the release; the tag is `v<version>`);
 * - `apps/native/app.json` → `expo.version` (the store "marketing" version);
 * - `packages/api/src/server-meta.ts` → `SERVER_VERSION` (what
 *   `GET /.well-known/openvalens` reports as `serverVersion`).
 *
 * Build numbers are not here: EAS keeps them (`appVersionSource: remote`).
 *
 *   bun run release:version 1.2.3          # set all three to 1.2.3, and the
 *                                          # "Applies to" line of versioned docs
 *   bun run release:version --check        # fail unless all three agree
 *   bun run release:version --check v1.2.3 # ...and equal the tag
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const VERSION_FILES = {
  root: "package.json",
  app: "apps/native/app.json",
  server: "packages/api/src/server-meta.ts",
} as const;

export type VersionSource = keyof typeof VERSION_FILES;
export type Versions = Record<VersionSource, string | null>;

/**
 * Store versions must be plain `MAJOR.MINOR.PATCH`: App Store Connect rejects
 * a pre-release suffix in `CFBundleShortVersionString`.
 */
const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SERVER_VERSION_LINE = /(export const SERVER_VERSION = ")([^"]*)(";)/;

export function isReleaseVersion(value: string): boolean {
  return RELEASE_VERSION.test(value);
}

/** `v1.2.3` → `1.2.3`; anything else → null. */
export function versionFromTag(tag: string): string | null {
  const match = /^v(.+)$/.exec(tag.trim());
  return match && isReleaseVersion(match[1]!) ? match[1]! : null;
}

function read(repo: string, source: VersionSource): string {
  return readFileSync(join(repo, VERSION_FILES[source]), "utf8");
}

export function readVersions(repo: string): Versions {
  const root = JSON.parse(read(repo, "root")) as { version?: unknown };
  const app = JSON.parse(read(repo, "app")) as { expo?: { version?: unknown } };
  const server = SERVER_VERSION_LINE.exec(read(repo, "server"));
  return {
    root: typeof root.version === "string" ? root.version : null,
    app: typeof app.expo?.version === "string" ? app.expo.version : null,
    server: server ? server[2]! : null,
  };
}

/** Problems that stop a release; empty when every file carries `expected`. */
export function versionProblems(versions: Versions, expected?: string): string[] {
  const want = expected ?? versions.root;
  const problems: string[] = [];
  if (!want) return [`${VERSION_FILES.root} has no "version"`];
  if (!isReleaseVersion(want)) problems.push(`"${want}" is not a MAJOR.MINOR.PATCH version`);
  for (const source of Object.keys(VERSION_FILES) as VersionSource[]) {
    const found = versions[source];
    if (found !== want)
      problems.push(
        `${VERSION_FILES[source]} has ${found === null ? "no version" : `"${found}"`}, expected "${want}"`,
      );
  }
  return problems;
}

/**
 * Replaces the one top-level `"version"` value in a JSON file's text without
 * reformatting the rest, then checks the result parses to the new value.
 */
type VersionedJson = { version?: unknown; expo?: { version?: unknown } };

function replaceJsonVersion(
  text: string,
  version: string,
  pick: (json: VersionedJson) => unknown,
): string {
  // The first `"version": "..."` in both files is the one we want: in the root
  // package.json it is the third line, in app.json the third key under `expo`.
  const next = text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
  if (pick(JSON.parse(next) as VersionedJson) !== version)
    throw new Error("could not update the version field");
  return next;
}

/**
 * Self-hosting and reference pages say which version they apply to, and
 * `scripts/self-hosting-docs.test.ts` holds them to the root version.
 */
export const VERSIONED_DOC_DIRS = ["docs/self-hosting", "docs/reference"] as const;
const APPLIES_TO = /(\*\*Applies to:\*\* OpenValens )(\d+\.\d+\.\d+)/;

/** Rewrites the "Applies to" version of each versioned page; returns the pages changed. */
export function stampDocs(repo: string, version: string): string[] {
  const changed: string[] = [];
  for (const dir of VERSIONED_DOC_DIRS) {
    if (!existsSync(join(repo, dir))) continue;
    const pages = readdirSync(join(repo, dir), { recursive: true, encoding: "utf8" });
    for (const page of pages.filter((path) => path.endsWith(".md")).sort()) {
      const path = join(repo, dir, page);
      const text = readFileSync(path, "utf8");
      const next = text.replace(APPLIES_TO, `$1${version}`);
      if (next === text) continue;
      writeFileSync(path, next);
      changed.push(join(dir, page));
    }
  }
  return changed;
}

export function setVersion(repo: string, version: string): void {
  if (!isReleaseVersion(version))
    throw new Error(`"${version}" is not a MAJOR.MINOR.PATCH version (no "v", no suffix)`);
  const root = replaceJsonVersion(read(repo, "root"), version, (json) => json.version);
  const app = replaceJsonVersion(read(repo, "app"), version, (json) => json.expo?.version);
  const serverText = read(repo, "server");
  if (!SERVER_VERSION_LINE.test(serverText))
    throw new Error(`${VERSION_FILES.server} has no SERVER_VERSION constant`);
  const server = serverText.replace(SERVER_VERSION_LINE, `$1${version}$3`);
  writeFileSync(join(repo, VERSION_FILES.root), root);
  writeFileSync(join(repo, VERSION_FILES.app), app);
  writeFileSync(join(repo, VERSION_FILES.server), server);
}

function main(argv: string[]): number {
  const repo = join(import.meta.dir, "..");
  const [first, second] = argv;
  if (first === "--check") {
    let expected: string | undefined;
    if (second) {
      const fromTag = versionFromTag(second);
      if (!fromTag) {
        console.error(`"${second}" is not a release tag (vMAJOR.MINOR.PATCH)`);
        return 1;
      }
      expected = fromTag;
    }
    const problems = versionProblems(readVersions(repo), expected);
    if (problems.length > 0) {
      for (const problem of problems) console.error(`version mismatch: ${problem}`);
      console.error("Fix with: bun run release:version <MAJOR.MINOR.PATCH>");
      return 1;
    }
    console.log(`All release versions are ${expected ?? readVersions(repo).root}.`);
    return 0;
  }
  if (!first || first.startsWith("-")) {
    console.error("usage: bun run release:version <MAJOR.MINOR.PATCH> | --check [vX.Y.Z]");
    return 1;
  }
  const version = first.replace(/^v/, "");
  try {
    setVersion(repo, version);
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
  for (const file of Object.values(VERSION_FILES)) console.log(`${file} → ${version}`);
  const pages = stampDocs(repo, version);
  if (pages.length > 0) {
    console.log(
      `"Applies to" set to ${version} in ${pages.length} pages; review that they still hold:`,
    );
    for (const page of pages) console.log(`  ${page}`);
  }
  console.log(`Next: commit, merge, then tag v${version} (docs/releasing.md).`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
