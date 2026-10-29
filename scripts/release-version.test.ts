import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  isReleaseVersion,
  readVersions,
  setVersion,
  stampDocs,
  VERSION_FILES,
  VERSIONED_DOC_DIRS,
  versionFromTag,
  versionProblems,
} from "./release-version";

const repo = join(import.meta.dir, "..");
const temps: string[] = [];

/** A copy of the three version files in a throwaway directory. */
function copyRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "openvalens-release-version-"));
  temps.push(dir);
  for (const file of Object.values(VERSION_FILES)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), readFileSync(join(repo, file)));
  }
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("release version (#306)", () => {
  test("root package.json, app.json and SERVER_VERSION agree in this checkout", () => {
    expect(versionProblems(readVersions(repo))).toEqual([]);
  });

  test("only plain MAJOR.MINOR.PATCH is a release version", () => {
    expect(isReleaseVersion("1.0.0")).toBe(true);
    expect(isReleaseVersion("0.12.3")).toBe(true);
    for (const bad of ["v1.0.0", "1.0", "1.0.0-rc.1", "01.0.0", "1.0.0 ", ""])
      expect(isReleaseVersion(bad)).toBe(false);
  });

  test("a tag maps to its version", () => {
    expect(versionFromTag("v1.2.3")).toBe("1.2.3");
    expect(versionFromTag("1.2.3")).toBeNull();
    expect(versionFromTag("v1.2.3-beta")).toBeNull();
  });

  test("setVersion bumps all three files and keeps the rest byte for byte", () => {
    const dir = copyRepo();
    const before = Object.fromEntries(
      Object.entries(VERSION_FILES).map(([key, file]) => [
        key,
        readFileSync(join(dir, file), "utf8"),
      ]),
    );
    setVersion(dir, "9.8.7");
    expect(readVersions(dir)).toEqual({ root: "9.8.7", app: "9.8.7", server: "9.8.7" });
    expect(versionProblems(readVersions(dir), "9.8.7")).toEqual([]);
    for (const [key, file] of Object.entries(VERSION_FILES)) {
      const after = readFileSync(join(dir, file), "utf8");
      const changed = after.split("\n").filter((line, i) => line !== before[key]!.split("\n")[i]);
      expect(changed).toHaveLength(1);
      expect(changed[0]).toContain("9.8.7");
    }
  });

  test("stampDocs moves the versioned pages' Applies to line only", () => {
    const dir = copyRepo();
    mkdirSync(join(dir, "docs/self-hosting"), { recursive: true });
    const page =
      "# Install\n\n**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-01\n\nRuns 0.1.0.\n";
    writeFileSync(join(dir, "docs/self-hosting/install.md"), page);
    writeFileSync(join(dir, "docs/self-hosting/other.md"), "# No version line\n");
    expect(stampDocs(dir, "1.0.0")).toEqual(["docs/self-hosting/install.md"]);
    expect(readFileSync(join(dir, "docs/self-hosting/install.md"), "utf8")).toBe(
      page.replace("OpenValens 0.1.0", "OpenValens 1.0.0"),
    );
  });

  test("every versioned page in this checkout has a line stampDocs can move", () => {
    const pages = VERSIONED_DOC_DIRS.flatMap((dir) =>
      readdirSync(join(repo, dir), { recursive: true, encoding: "utf8" })
        .filter((path) => path.endsWith(".md"))
        .map((path) => join(repo, dir, path)),
    );
    expect(pages.length).toBeGreaterThan(5);
    for (const page of pages)
      expect(readFileSync(page, "utf8")).toMatch(/\*\*Applies to:\*\* OpenValens \d+\.\d+\.\d+/);
  });

  test("setVersion refuses a tag or a pre-release", () => {
    const dir = copyRepo();
    expect(() => setVersion(dir, "v1.0.0")).toThrow();
    expect(() => setVersion(dir, "1.0.0-rc.1")).toThrow();
    expect(versionProblems(readVersions(dir))).toEqual([]);
  });

  test("a mismatch names the file and the expected version", () => {
    const problems = versionProblems({ root: "1.0.0", app: "0.9.0", server: "1.0.0" });
    expect(problems).toEqual([`${VERSION_FILES.app} has "0.9.0", expected "1.0.0"`]);
    expect(versionProblems(readVersions(repo), "999.0.0")).toHaveLength(3);
  });
});
