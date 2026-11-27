#!/usr/bin/env bun
/**
 * Build the GitHub wiki from the user-facing guides in `docs/`.
 *
 * `docs/` is the single source of truth: `.github/workflows/wiki.yml` runs this
 * on every push to `main` that touches `docs/` and replaces the wiki with the
 * result, so edits made on the wiki are overwritten.
 *
 * Only the pages in `WIKI_PAGES` are published. It is an explicit list, not a
 * glob, so engineering docs (architecture, releasing, research, migrations,
 * cloud operations, store listings and the like) never reach the wiki by
 * accident. A wiki page is addressed by its file name alone, so every entry
 * names its page.
 *
 * Relative links are rewritten: a link to another published doc points at its
 * wiki page (anchors kept); a link to anything else in the repository points at
 * GitHub (`blob`, `tree` for a directory, `raw` for an image). A relative link
 * to a file that does not exist fails the build.
 *
 * Usage: `bun scripts/build-wiki.ts <empty output directory>`
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";

export const REPOSITORY = "nip10/openvalens";
const GITHUB = `https://github.com/${REPOSITORY}`;
const WIKI = `${GITHUB}/wiki`;

export const GROUPS = [
  "Self-hosting",
  "Using OpenValens",
  "Connected AI apps",
  "Reference",
] as const;
export type WikiGroup = (typeof GROUPS)[number];

export interface WikiPage {
  /** Repository-relative path of the source Markdown file. */
  source: string;
  /** Wiki page name: the file name without `.md`, also the URL segment. */
  page: string;
  /** Link text in the sidebar and on Home. */
  title: string;
  group: WikiGroup;
}

/** Source, wiki page name and link title, by sidebar group. */
const SECTIONS: Record<WikiGroup, readonly (readonly [string, string, string])[]> = {
  "Self-hosting": [
    ["docs/self-hosting/README.md", "Self-hosting", "Overview"],
    ["docs/self-hosting/install.md", "Install", "Install"],
    ["docs/self-hosting/configuration.md", "Configuration", "Configuration"],
    ["docs/self-hosting/food-catalogs.md", "Food-catalogs", "Food catalogs"],
    ["docs/self-hosting/upgrading.md", "Upgrading", "Upgrading"],
    ["docs/self-hosting/backup.md", "Backups", "Backups"],
    ["docs/self-hosting/email.md", "Email", "Email"],
    ["docs/self-hosting/oidc.md", "Single-sign-on-OIDC", "Single sign-on (OIDC)"],
    [
      "docs/self-hosting/google-apple-sign-in.md",
      "Google-and-Apple-sign-in",
      "Google and Apple sign-in",
    ],
    ["docs/self-hosting/security.md", "Security-model", "Security model and reporting"],
    ["docs/self-hosting/privacy.md", "Privacy-and-data-rights", "Privacy and data rights"],
    ["docs/self-hosting/licensing.md", "Licensing-and-trademark", "Licensing and trademark"],
    ["docs/self-hosting/mobile-app.md", "Connecting-the-mobile-app", "Connecting the mobile app"],
  ],
  "Using OpenValens": [
    ["docs/score-algorithm.md", "Scores", "Scores: readiness and goal progress"],
    ["docs/activity-load.md", "Activity-load", "Weekly activity and activity load"],
    ["docs/insight-rules.md", "Insights", "Insights"],
    ["docs/reference-comparisons.md", "Reference-comparisons", "Reference comparisons"],
    ["docs/nutrition-targets.md", "Nutrition-targets", "Nutrition targets"],
    ["docs/energy-estimate.md", "Energy-estimate", "Energy estimate"],
    ["docs/micronutrients.md", "Micronutrients", "Micronutrient summaries"],
    ["docs/food-drafts.md", "Food-drafts", "Food drafts"],
    ["docs/preventive-care.md", "Preventive-care", "Preventive care"],
    ["docs/body-map.md", "Body-map", "Body map"],
    ["docs/cycle-logging.md", "Cycle-logging", "Cycle logging"],
    ["docs/trackers.md", "Custom-trackers", "Custom trackers"],
    ["docs/data-export.md", "Data-exports", "Data exports"],
    ["docs/wearables.md", "Wearables", "Wearables"],
  ],
  "Connected AI apps": [
    ["docs/help/ai-apps/README.md", "Connect-an-AI-app", "Connect an AI app"],
    ["docs/help/ai-apps/claude-ai.md", "Connect-claude-ai", "claude.ai"],
    ["docs/help/ai-apps/claude-desktop.md", "Connect-Claude-Desktop", "Claude Desktop"],
    ["docs/help/ai-apps/claude-code.md", "Connect-Claude-Code", "Claude Code"],
    ["docs/help/ai-apps/cursor.md", "Connect-Cursor", "Cursor"],
    ["docs/help/ai-apps/chatgpt.md", "Connect-ChatGPT", "ChatGPT"],
    ["docs/help/ai-apps/local-model.md", "Connect-a-local-model", "A local model or app"],
    ["docs/ai-apps.md", "MCP-server-and-tool-API", "MCP server and REST tool API"],
  ],
  Reference: [
    ["docs/reference/env.md", "Environment-reference", "Environment reference"],
    ["docs/integrations.md", "Integrations", "Integrations"],
    ["docs/ai-providers.md", "AI-providers", "AI providers"],
    ["docs/storage.md", "Object-storage", "Object storage"],
    ["docs/analytics.md", "Product-analytics", "Optional product analytics"],
  ],
};

export const WIKI_PAGES: readonly WikiPage[] = GROUPS.flatMap((group) =>
  SECTIONS[group].map(([source, page, title]) => ({ source, page, title, group })),
);

/** Characters GitHub keeps verbatim in a wiki file name and URL. */
const PAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const RESERVED_PAGES = new Set(["home", "_sidebar", "_footer"]);
const IMAGE = /\.(png|jpe?g|gif|svg|webp|avif)$/i;

export const wikiUrl = (page: string) => `${WIKI}/${page}`;

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** Throw if page names are malformed, reserved or collide (GitHub wikis ignore case). */
export function validateManifest(pages: readonly WikiPage[]): void {
  const seenPages = new Map<string, string>();
  const seenSources = new Set<string>();
  for (const { source, page } of pages) {
    if (!PAGE_NAME.test(page))
      throw new Error(`wiki: page name "${page}" (${source}) must match ${PAGE_NAME}`);
    const key = page.toLowerCase();
    if (RESERVED_PAGES.has(key))
      throw new Error(`wiki: page name "${page}" (${source}) is reserved`);
    const other = seenPages.get(key);
    if (other) throw new Error(`wiki: page name "${page}" is used by both ${other} and ${source}`);
    seenPages.set(key, source);
    if (seenSources.has(source)) throw new Error(`wiki: ${source} is listed twice`);
    seenSources.add(source);
  }
}

export interface RewriteContext {
  /** Repository-relative source path of the page being rewritten. */
  source: string;
  /** Repository-relative source path → wiki page name. */
  pages: ReadonlyMap<string, string>;
  /** Whether a repository-relative path exists, and whether it is a directory. */
  stat: (path: string) => "file" | "directory" | undefined;
}

/** Rewrite one link target, or return it unchanged when it is not repository-relative. */
export function rewriteTarget(target: string, isImage: boolean, context: RewriteContext): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//") || target.startsWith("#")) {
    return target;
  }
  const hashAt = target.indexOf("#");
  const rawPath = hashAt === -1 ? target : target.slice(0, hashAt);
  const anchor = hashAt === -1 ? "" : target.slice(hashAt);
  const decoded = decodeURIComponent(rawPath);
  const path = decoded.startsWith("/")
    ? posix.normalize(decoded.slice(1))
    : posix.join(posix.dirname(context.source), decoded);
  const kind = path.startsWith("..") ? undefined : context.stat(path.replace(/\/$/, "") || ".");
  if (!kind) {
    throw new Error(`wiki: ${context.source} links to "${target}", which does not exist (${path})`);
  }
  const clean = path.replace(/\/$/, "");
  const page = context.pages.get(clean);
  if (page) return `${wikiUrl(page)}${anchor}`;
  if (kind === "directory") return `${GITHUB}/tree/main/${encodePath(clean)}${anchor}`;
  if (isImage || IMAGE.test(clean)) return `${GITHUB}/raw/main/${encodePath(clean)}`;
  return `${GITHUB}/blob/main/${encodePath(clean)}${anchor}`;
}

// Link text may wrap onto the next line, so prose is rewritten a block at a time.
const INLINE_LINK =
  /(!?)\[((?:[^\][]|\[[^\]]*\])*)\]\(\s*(<[^>\n]*>|[^)\s]+)((?:\s+"[^"\n]*")?\s*)\)/g;
const REFERENCE_DEFINITION = /^( {0,3}\[[^\]\n]+\]:[ \t]*)(<[^>\n]*>|\S+)/gm;
const CODE_SPAN = /(`+)[^`]*?\1/g;
const MASKED = /\uE000(\d+)\uE000/g;

/** Rewrite the links in a run of prose lines, leaving inline code spans alone. */
function rewriteProse(prose: string, context: RewriteContext): string {
  // Mask inline code spans so a link inside one stays as written, while a link
  // whose text is a code span (`[\`file\`](path)`) is still rewritten.
  const spans: string[] = [];
  const masked = prose.replace(CODE_SPAN, (span) => `\uE000${spans.push(span) - 1}\uE000`);
  const unbracket = (target: string) => target.replace(/^<|>$/g, "");
  return masked
    .replace(
      REFERENCE_DEFINITION,
      (_match, lead: string, target: string) =>
        `${lead}${rewriteTarget(unbracket(target), false, context)}`,
    )
    .replace(
      INLINE_LINK,
      (_match, bang: string, text: string, target: string, title: string) =>
        `${bang}[${text}](${rewriteTarget(unbracket(target), bang === "!", context)}${title})`,
    )
    .replace(MASKED, (_match, index: string) => spans[Number(index)]!);
}

/** Rewrite every relative link in `markdown`, skipping fenced code blocks. */
export function rewriteLinks(markdown: string, context: RewriteContext): string {
  const out: string[] = [];
  let prose: string[] = [];
  let fence: string | undefined;
  const flush = () => {
    if (prose.length > 0) out.push(rewriteProse(prose.join("\n"), context));
    prose = [];
  };
  for (const line of markdown.split("\n")) {
    const opener = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      out.push(line);
      if (opener && opener[0] === fence[0] && opener.length >= fence.length) fence = undefined;
    } else if (opener) {
      flush();
      out.push(line);
      fence = opener;
    } else {
      prose.push(line);
    }
  }
  flush();
  return out.join("\n");
}

const sourceUrl = (source: string) => `${GITHUB}/blob/main/${encodePath(source)}`;

export function footer(source: string): string {
  return [
    "",
    "---",
    "",
    `_This page is generated from [\`${source}\`](${sourceUrl(source)}). ` +
      "Edits made on the wiki are overwritten: change the source file through a pull request._",
    "",
  ].join("\n");
}

function groupedLinks(pages: readonly WikiPage[], heading: string): string {
  return GROUPS.map((group) => {
    const links = pages
      .filter((page) => page.group === group)
      .map(({ page, title }) => `- [${title}](${wikiUrl(page)})`);
    return [`${heading} ${group}`, "", ...links].join("\n");
  }).join("\n\n");
}

export function sidebar(pages: readonly WikiPage[]): string {
  return `[Home](${wikiUrl("Home")})\n\n${groupedLinks(pages, "###")}\n`;
}

export function home(pages: readonly WikiPage[]): string {
  return [
    "# OpenValens documentation",
    "",
    "Guides for running your own OpenValens server, using the app and connecting AI apps to your records.",
    "",
    `> **This wiki is generated.** Every page is built from the Markdown files in [\`docs/\`](${GITHUB}/tree/main/docs) ` +
      "on each push to `main`, and edits made here are overwritten. To change a page, open a pull request " +
      "against the source file linked at the bottom of the page.",
    "",
    groupedLinks(pages, "##"),
    "",
  ].join("\n");
}

/** Build the wiki: file name → contents. Throws on a broken relative link. */
export function buildWiki(
  repo: string,
  pages: readonly WikiPage[] = WIKI_PAGES,
): Map<string, string> {
  validateManifest(pages);
  const pageBySource = new Map(pages.map(({ source, page }) => [source, page]));
  const stat = (path: string) => {
    const absolute = join(repo, path);
    if (!existsSync(absolute)) return undefined;
    return statSync(absolute).isDirectory() ? ("directory" as const) : ("file" as const);
  };
  const files = new Map<string, string>();
  for (const { source, page } of pages) {
    if (stat(source) !== "file") throw new Error(`wiki: manifest source ${source} does not exist`);
    const markdown = readFileSync(join(repo, source), "utf8").replace(/\s+$/, "");
    const body = rewriteLinks(markdown, { source, pages: pageBySource, stat });
    files.set(`${page}.md`, `${body}\n${footer(source)}`);
  }
  files.set("Home.md", home(pages));
  files.set("_Sidebar.md", sidebar(pages));
  return files;
}

if (import.meta.main) {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: bun scripts/build-wiki.ts <empty output directory>");
    process.exit(2);
  }
  const target = resolve(out);
  if (existsSync(target) && readdirSync(target).length > 0) {
    console.error(`wiki: ${target} is not empty`);
    process.exit(2);
  }
  const files = buildWiki(join(import.meta.dir, ".."));
  mkdirSync(target, { recursive: true });
  for (const [name, contents] of files) writeFileSync(join(target, name), contents);
  console.log(`wiki: wrote ${files.size} pages to ${target}`);
}
