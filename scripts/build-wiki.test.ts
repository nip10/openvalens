import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
  GROUPS,
  WIKI_PAGES,
  buildWiki,
  rewriteLinks,
  rewriteTarget,
  validateManifest,
  type RewriteContext,
  type WikiPage,
} from "./build-wiki";

const repo = join(import.meta.dir, "..");
const GITHUB = "https://github.com/nip10/openvalens";

const FILES = new Set([
  "README.md",
  "SECURITY.md",
  "docs/self-hosting/install.md",
  "docs/self-hosting/backup.md",
  "docs/deployment.md",
  "docs/research/reports/Preventive care recommendation evidence.md",
  "docs/img/shot.png",
]);
const DIRECTORIES = new Set([".", "docs", "docs/self-hosting", "LICENSES", "docs/img"]);

const context = (source = "docs/self-hosting/install.md"): RewriteContext => ({
  source,
  pages: new Map([
    ["docs/self-hosting/install.md", "Install"],
    ["docs/self-hosting/backup.md", "Backups"],
  ]),
  stat: (path) => (FILES.has(path) ? "file" : DIRECTORIES.has(path) ? "directory" : undefined),
});

describe("rewriteTarget", () => {
  test("a synced doc becomes its wiki page, keeping the anchor", () => {
    expect(rewriteTarget("backup.md", false, context())).toBe(`${GITHUB}/wiki/Backups`);
    expect(rewriteTarget("backup.md#the-backup-key", false, context())).toBe(
      `${GITHUB}/wiki/Backups#the-backup-key`,
    );
    expect(rewriteTarget("./backup.md", false, context())).toBe(`${GITHUB}/wiki/Backups`);
    expect(rewriteTarget("self-hosting/install.md", false, context("docs/wearables.md"))).toBe(
      `${GITHUB}/wiki/Install`,
    );
  });

  test("anything else in the repository points at GitHub", () => {
    expect(rewriteTarget("../deployment.md#6-health-readiness", false, context())).toBe(
      `${GITHUB}/blob/main/docs/deployment.md#6-health-readiness`,
    );
    expect(rewriteTarget("../../SECURITY.md", false, context())).toBe(
      `${GITHUB}/blob/main/SECURITY.md`,
    );
    expect(rewriteTarget("/README.md", false, context())).toBe(`${GITHUB}/blob/main/README.md`);
  });

  test("directories use tree, images use raw", () => {
    expect(rewriteTarget("../../LICENSES", false, context())).toBe(`${GITHUB}/tree/main/LICENSES`);
    expect(rewriteTarget("../../LICENSES/", false, context())).toBe(`${GITHUB}/tree/main/LICENSES`);
    expect(rewriteTarget("../img/shot.png", true, context())).toBe(
      `${GITHUB}/raw/main/docs/img/shot.png`,
    );
  });

  test("encoded paths are decoded to find the file and re-encoded for GitHub", () => {
    expect(
      rewriteTarget(
        "research/reports/Preventive%20care%20recommendation%20evidence.md",
        false,
        context("docs/preventive-care.md"),
      ),
    ).toBe(
      `${GITHUB}/blob/main/docs/research/reports/Preventive%20care%20recommendation%20evidence.md`,
    );
  });

  test("external links, mail and same-page anchors are left alone", () => {
    for (const target of [
      "https://example.com/a.md",
      "mailto:a@example.com",
      "#writes",
      "//cdn.example/x",
    ]) {
      expect(rewriteTarget(target, false, context())).toBe(target);
    }
  });

  test("a relative link to a missing file fails loudly", () => {
    expect(() => rewriteTarget("nope.md", false, context())).toThrow(
      /docs\/self-hosting\/install\.md links to "nope\.md", which does not exist/,
    );
    expect(() => rewriteTarget("../../../outside.md", false, context())).toThrow(/does not exist/);
  });
});

describe("rewriteLinks", () => {
  test("rewrites inline links, images and reference definitions", () => {
    const markdown = [
      'See [Backups](backup.md#restoring) and [`SECURITY.md`](../../SECURITY.md "policy").',
      "![Screenshot](../img/shot.png)",
      "[deploy]: ../deployment.md",
    ].join("\n");
    expect(rewriteLinks(markdown, context())).toBe(
      [
        `See [Backups](${GITHUB}/wiki/Backups#restoring) and [\`SECURITY.md\`](${GITHUB}/blob/main/SECURITY.md "policy").`,
        `![Screenshot](${GITHUB}/raw/main/docs/img/shot.png)`,
        `[deploy]: ${GITHUB}/blob/main/docs/deployment.md`,
      ].join("\n"),
    );
  });

  test("rewrites a link whose text wraps onto the next line", () => {
    expect(rewriteLinks("protect them ([Back\nups](backup.md#x)).", context())).toBe(
      `protect them ([Back\nups](${GITHUB}/wiki/Backups#x)).`,
    );
  });

  test("leaves fenced code blocks and inline code spans untouched", () => {
    const markdown = [
      "Use `[x](missing.md)` literally.",
      "```md",
      "[x](missing.md)",
      "```",
      "~~~",
      "[y](missing.md)",
      "~~~",
      "[Install](install.md)",
    ].join("\n");
    expect(rewriteLinks(markdown, context())).toBe(
      markdown.replace("[Install](install.md)", `[Install](${GITHUB}/wiki/Install)`),
    );
  });
});

describe("validateManifest", () => {
  const page = (source: string, name: string): WikiPage => ({
    source,
    page: name,
    title: name,
    group: "Reference",
  });

  test("rejects names GitHub would mangle, reserved names and case-insensitive clashes", () => {
    expect(() => validateManifest([page("a.md", "claude.ai")])).toThrow(/must match/);
    expect(() => validateManifest([page("a.md", "Two words")])).toThrow(/must match/);
    expect(() => validateManifest([page("a.md", "home")])).toThrow(/reserved/);
    expect(() => validateManifest([page("a.md", "Install"), page("b.md", "install")])).toThrow(
      /used by both a\.md and b\.md/,
    );
    expect(() => validateManifest([page("a.md", "A"), page("a.md", "B")])).toThrow(/listed twice/);
  });

  test("accepts the real manifest", () => {
    expect(() => validateManifest(WIKI_PAGES)).not.toThrow();
  });
});

describe("the manifest", () => {
  test("publishes every self-hosting page, the AI app guides and the env reference", () => {
    const sources = new Set(WIKI_PAGES.map((page) => page.source));
    const required = [
      ...readdirSync(join(repo, "docs/self-hosting")).map((name) => `docs/self-hosting/${name}`),
      ...readdirSync(join(repo, "docs/help/ai-apps")).map((name) => `docs/help/ai-apps/${name}`),
      "docs/reference/env.md",
    ].filter((path) => path.endsWith(".md"));
    expect(required.filter((path) => !sources.has(path))).toEqual([]);
  });

  test("never publishes engineering or operator-internal docs", () => {
    const internal =
      /^docs\/(architecture|research|releases|legal|mobile)\/|^docs\/(releasing|release|migration-plan|migration-safety|goals-migration|cloud-operations|store-listings|store-review-account|public-demo|mobile-release|cutover|production-verification|billing)\.md$/;
    expect(WIKI_PAGES.filter((page) => internal.test(page.source))).toEqual([]);
  });

  test("every group has pages", () => {
    for (const group of GROUPS) expect(WIKI_PAGES.some((page) => page.group === group)).toBe(true);
  });
});

describe("buildWiki", () => {
  const files = buildWiki(repo);

  test("writes one page per doc plus Home and the sidebar", () => {
    expect([...files.keys()].sort()).toEqual(
      [...WIKI_PAGES.map((page) => `${page.page}.md`), "Home.md", "_Sidebar.md"].sort(),
    );
  });

  test("every page ends with a footer naming its source and the PR route", () => {
    for (const { source, page } of WIKI_PAGES) {
      const contents = files.get(`${page}.md`)!;
      expect(contents).toContain(
        `_This page is generated from [\`${source}\`](${GITHUB}/blob/main/${source}).`,
      );
      expect(contents).toContain("change the source file through a pull request");
    }
  });

  test("leaves no repository-relative link behind", () => {
    for (const [name, contents] of files) {
      const relative = [...contents.matchAll(/\]\(\s*<?([^)\s>]+)/g)]
        .map((match) => match[1]!)
        .filter((target) => !/^(https?:|mailto:|#)/.test(target));
      expect({ name, relative }).toEqual({ name, relative: [] });
    }
  });

  test("Home says the wiki is generated and links every page", () => {
    const homePage = files.get("Home.md")!;
    expect(homePage).toContain("This wiki is generated");
    for (const { page } of WIKI_PAGES) expect(homePage).toContain(`${GITHUB}/wiki/${page})`);
    for (const group of GROUPS) expect(files.get("_Sidebar.md")).toContain(`### ${group}`);
  });
});
