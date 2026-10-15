/**
 * Drift guards for the stage-1 Markdown docs (Issue #68).
 *
 * - Every relative Markdown link (and `#anchor`) in the repository's own docs
 *   resolves to a file (and heading) that exists.
 * - Every self-hosting and reference page states the version it applies to,
 *   which must be the root `package.json` version.
 * - The README links every self-hosting page.
 * - The documented `deploy/.env` variables match the ones `deploy/compose.yml`
 *   actually reads.
 *
 * Pure file reads; no network, no Docker.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const repo = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const version = (JSON.parse(read("package.json")) as { version: string }).version;

/** Repository-relative Markdown files under `dir` (recursive). */
function markdownUnder(dir: string): string[] {
  return readdirSync(join(repo, dir), { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".md"))
    .map((path) => join(dir, path))
    .sort();
}

/** Root Markdown files plus `docs/`, except the archived research notes. */
const CHECKED_FILES = [
  ...readdirSync(repo).filter((name) => name.endsWith(".md")),
  ...markdownUnder("docs").filter((path) => !path.startsWith(join("docs", "research"))),
];

const SELF_HOSTING_PAGES = markdownUnder(join("docs", "self-hosting"));
const VERSIONED_PAGES = [...SELF_HOSTING_PAGES, ...markdownUnder(join("docs", "reference"))];

/** Lines outside fenced code blocks, with inline code spans removed. */
function proseLines(markdown: string): string[] {
  const lines: string[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) lines.push(line.replace(/`[^`]*`/g, "``"));
  }
  return lines;
}

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to dashes. */
export function githubSlug(heading: string): string {
  return heading
    .replace(/`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-");
}

function anchorsOf(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const match = fenced ? null : /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const base = githubSlug(match[1]!);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

function linkTargets(markdown: string): string[] {
  const targets: string[] = [];
  for (const line of proseLines(markdown)) {
    for (const match of line.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      targets.push(match[1]!);
    }
    const definition = /^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+.*)?$/.exec(line);
    if (definition) targets.push(definition[1]!);
  }
  return targets;
}

describe("relative Markdown links", () => {
  test("cover the self-hosting docs", () => {
    for (const page of SELF_HOSTING_PAGES) expect(CHECKED_FILES).toContain(page);
  });

  for (const file of CHECKED_FILES) {
    test(`${file} links resolve`, () => {
      const broken: string[] = [];
      for (const target of linkTargets(read(file))) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // https:, mailto:, …
        const [rawPath = "", anchor] = target.split("#", 2);
        const path = decodeURIComponent(rawPath);
        const resolved = path === "" ? join(repo, file) : resolve(repo, dirname(file), path);
        if (relative(repo, resolved).startsWith("..") || !existsSync(resolved)) {
          broken.push(`${target} (missing file)`);
          continue;
        }
        if (anchor && resolved.endsWith(".md") && statSync(resolved).isFile()) {
          if (!anchorsOf(readFileSync(resolved, "utf8")).has(anchor)) {
            broken.push(`${target} (missing heading)`);
          }
        }
      }
      expect(broken).toEqual([]);
    });
  }
});

describe("self-hosting docs", () => {
  test("every page states the root package.json version", () => {
    const stale = VERSIONED_PAGES.filter(
      (page) => !read(page).includes(`**Applies to:** OpenValens ${version}`),
    );
    expect(stale).toEqual([]);
  });

  test("the README links every self-hosting page and the env reference", () => {
    const readmeTargets = new Set(linkTargets(read("README.md")).map((t) => t.split("#")[0]));
    const missing = [...SELF_HOSTING_PAGES, join("docs", "reference", "env.md")].filter(
      (page) => !readmeTargets.has(page),
    );
    expect(missing).toEqual([]);
  });

  test("the deploy/.env table matches the variables deploy/compose.yml reads", () => {
    const compose = read(join("deploy", "compose.yml"));
    const used = new Set([...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]!));

    const configuration = read(join("docs", "self-hosting", "configuration.md"));
    const section = configuration.split("## `deploy/.env`")[1]!.split("\n### ")[0]!;
    const documented = new Set(
      [...section.matchAll(/^\| `([A-Z][A-Z0-9_]*)`/gm)].map((match) => match[1]!),
    );

    expect([...documented].sort()).toEqual([...used].sort());
  });
});

describe("githubSlug", () => {
  test("matches GitHub's anchors for the heading shapes used here", () => {
    expect(githubSlug("Instance admission (Issue #63)")).toBe("instance-admission-issue-63");
    expect(githubSlug("`deploy/.env`")).toBe("deployenv");
    expect(githubSlug("6. Health readiness")).toBe("6-health-readiness");
    expect(githubSlug("Licensing and sign-off (DCO)")).toBe("licensing-and-sign-off-dco");
    expect(githubSlug("Rollback: enforce → report-only")).toBe("rollback-enforce--report-only");
  });
});
