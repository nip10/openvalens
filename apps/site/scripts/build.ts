#!/usr/bin/env bun
/**
 * Builds the static landing site (Issue #66) and audits it.
 *
 * The site is plain HTML, CSS and SVG with no JavaScript and no web fonts. The
 * build copies `src/` to the output directory, writes {@link SITE_CSP} into the
 * page's CSP `<meta>` and into a `_headers` file for static hosts that read one,
 * and then fails if {@link auditSite} finds any problem — so a third-party
 * resource can never ship, even before the browser's CSP would block it.
 *
 * Usage: bun scripts/build.ts <out-dir>
 */
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";

export const SITE_SRC = join(import.meta.dir, "..", "src");

/**
 * Same-origin only; nothing executable. `frame-ancestors` is ignored in a
 * `<meta>` policy, so it is sent only in the `_headers` file.
 */
const CSP_DIRECTIVES = [
  "default-src 'none'",
  "style-src 'self'",
  "img-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
];
export const SITE_CSP = CSP_DIRECTIVES.join("; ");
export const SITE_CSP_HEADER = [...CSP_DIRECTIVES, "frame-ancestors 'none'"].join("; ");

const CSP_PLACEHOLDER = "__SITE_CSP__";

/**
 * The go-live switch for OpenValens Cloud (#309). While it is `false` the
 * pages say "Cloud · coming soon" and never link to sign-up. Set it to `true`
 * once billing leaves Stripe test mode: the build then swaps every Cloud
 * block to its live copy, with "Start free trial" linking to
 * {@link CLOUD_SIGNUP_URL}.
 *
 * In the HTML, `<!-- cloud:soon -->…<!-- /cloud:soon -->` wraps what shows
 * before launch and `<!-- cloud:live -->…<!-- /cloud:live -->` what replaces it.
 */
export const CLOUD_LIVE = false;

/** Fills `__CLOUD_SIGNUP_URL__` in the pages. */
export const CLOUD_SIGNUP_URL = "https://app.openvalens.com/signup";
const SIGNUP_PLACEHOLDER = "__CLOUD_SIGNUP_URL__";

const CLOUD_MARKER = /[ \t]*<!--\s*(\/?)cloud:(soon|live)\s*-->\n?/g;

/**
 * Keeps the Cloud blocks for one state and drops the other state's blocks,
 * markers included. Throws on a block that is nested, stray or not closed.
 */
export function selectCloudBlocks(html: string, cloudLive: boolean, file = "page"): string {
  const keep = cloudLive ? "live" : "soon";
  let out = "";
  let cursor = 0;
  let open: string | undefined;
  for (const match of html.matchAll(CLOUD_MARKER)) {
    const [text, closing, state] = match;
    if (!closing && open) throw new Error(`${file}: cloud:${state} opened inside cloud:${open}`);
    if (closing && open !== state) throw new Error(`${file}: stray /cloud:${state}`);
    // Text before an opening marker is outside any block; before a closing
    // marker it is the block's body, kept only for the chosen state.
    if (!open || open === keep) out += html.slice(cursor, match.index);
    cursor = match.index + text.length;
    open = closing ? undefined : state;
  }
  if (open) throw new Error(`${file}: cloud:${open} is not closed`);
  return out + html.slice(cursor);
}

/** `_headers` (Netlify / Cloudflare Pages format); reverse proxies can mirror it. */
export function renderHeaders(): string {
  return [
    "/*",
    `  Content-Security-Policy: ${SITE_CSP_HEADER}`,
    "  Referrer-Policy: no-referrer",
    "  X-Content-Type-Options: nosniff",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()",
    "",
  ].join("\n");
}

/**
 * Attributes whose value is a namespace, a navigation or metadata for crawlers
 * (Open Graph / Twitter `<meta>`, `<link rel=canonical>`), not something the
 * browser fetches.
 */
function isNonFetchingAttribute(tag: Tag, attribute: string): boolean {
  if (attribute === "xmlns" || attribute.startsWith("xmlns:")) return true;
  // <meta> never fetches (a refresh redirect is refused separately).
  if (tag.name === "meta") return true;
  if (tag.name === "link" && attribute === "href") {
    return tag.attributes.get("rel")?.trim().toLowerCase() === "canonical";
  }
  return tag.name === "a" && attribute === "href";
}

/** True for `https://…`, `http://…`, `//host/…` and any other `scheme:` except `data:`. */
function isExternalUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("//")) return true;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  return scheme !== undefined && scheme !== "data";
}

/** Splits a `srcset` value into its URLs. */
function srcsetUrls(value: string): string[] {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")
    .filter(Boolean);
}

export type Finding = { file: string; problem: string };

type Tag = { name: string; attributes: Map<string, string> };

function* tagsOf(markup: string): Generator<Tag> {
  const withoutComments = markup.replace(/<!--[\s\S]*?-->/g, "");
  for (const match of withoutComments.matchAll(
    /<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
  )) {
    const attributes = new Map<string, string>();
    for (const attribute of match[2]!.matchAll(
      /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g,
    )) {
      attributes.set(
        attribute[1]!.toLowerCase(),
        attribute[2] ?? attribute[3] ?? attribute[4] ?? "",
      );
    }
    yield { name: match[1]!.toLowerCase(), attributes };
  }
}

/** `url(...)` and `@import` targets in a stylesheet. */
function cssUrls(css: string): string[] {
  const urls: string[] = [];
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of withoutComments.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)) {
    urls.push((match[1] ?? match[2] ?? match[3] ?? "").trim());
  }
  for (const match of withoutComments.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) {
    urls.push(match[1] ?? match[2] ?? "");
  }
  return urls;
}

/**
 * Audits one markup file (HTML or SVG). Every attribute that can make the
 * browser fetch something must be same-origin; only `<a href>` may point
 * elsewhere. Inline scripts, inline styles and event handlers are refused so
 * the CSP needs no `'unsafe-inline'`. Returns the local URLs it references.
 */
export function auditMarkup(file: string, markup: string, findings: Finding[]): string[] {
  const local: string[] = [];
  for (const tag of tagsOf(markup)) {
    if (tag.name === "script") findings.push({ file, problem: "<script> is not allowed" });
    if (tag.name === "style") findings.push({ file, problem: "inline <style> is not allowed" });
    if (["iframe", "frame", "embed", "object", "portal"].includes(tag.name)) {
      findings.push({ file, problem: `<${tag.name}> is not allowed` });
    }
    if (tag.name === "meta" && tag.attributes.get("http-equiv")?.toLowerCase() === "refresh") {
      findings.push({ file, problem: "<meta http-equiv=refresh> is not allowed" });
    }
    for (const [attribute, value] of tag.attributes) {
      if (attribute.startsWith("on")) {
        findings.push({ file, problem: `inline event handler ${attribute} on <${tag.name}>` });
        continue;
      }
      if (attribute === "style") {
        findings.push({ file, problem: `inline style attribute on <${tag.name}>` });
        continue;
      }
      if (isNonFetchingAttribute(tag, attribute)) continue;
      const urls = attribute.endsWith("srcset") ? srcsetUrls(value) : [value];
      for (const url of urls) {
        if (isExternalUrl(url)) {
          findings.push({
            file,
            problem: `third-party resource in <${tag.name} ${attribute}>: ${url}`,
          });
        } else if (
          ["src", "href", "poster", "data", "srcset", "action", "formaction"].includes(attribute) ||
          attribute.endsWith("srcset") ||
          attribute === "xlink:href"
        ) {
          if (url && !url.startsWith("#") && !url.startsWith("data:")) local.push(url);
        }
      }
    }
  }
  return local;
}

/** Audits one stylesheet; returns the local URLs it references. */
export function auditCss(file: string, css: string, findings: Finding[]): string[] {
  const local: string[] = [];
  for (const url of cssUrls(css)) {
    if (isExternalUrl(url)) findings.push({ file, problem: `third-party resource in CSS: ${url}` });
    else if (url && !url.startsWith("#") && !url.startsWith("data:")) local.push(url);
  }
  return local;
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

/**
 * Audits a built site directory: no third-party resource anywhere, every local
 * reference resolves inside the directory, and every page carries the CSP.
 */
export async function auditSite(dir: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const files = await filesUnder(dir);
  for (const file of files) {
    const extension = extname(file).toLowerCase();
    if (![".html", ".svg", ".css"].includes(extension)) continue;
    const text = await readFile(join(dir, file), "utf8");
    const references =
      extension === ".css" ? auditCss(file, text, findings) : auditMarkup(file, text, findings);
    if (extension === ".html" && !text.includes(`content="${SITE_CSP}"`)) {
      findings.push({ file, problem: "missing the site Content-Security-Policy <meta>" });
    }
    for (const reference of references) {
      const path = decodeURIComponent(reference.split(/[?#]/)[0]!);
      const target = path.startsWith("/") ? join(dir, path) : resolve(dir, dirname(file), path);
      const inside = relative(dir, target);
      if (inside.startsWith("..") || !files.includes(normalize(inside))) {
        findings.push({ file, problem: `local reference does not resolve: ${reference}` });
      }
    }
  }
  return findings;
}

/**
 * Copies `src/` to `outDir`, keeps the Cloud blocks for `cloudLive`, fills in
 * the CSP and writes `_headers`.
 */
export async function buildSite(
  outDir: string,
  srcDir = SITE_SRC,
  { cloudLive = CLOUD_LIVE }: { cloudLive?: boolean } = {},
): Promise<void> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await cp(srcDir, outDir, { recursive: true });
  for (const file of await filesUnder(outDir)) {
    if (!file.endsWith(".html")) continue;
    const path = join(outDir, file);
    const html = await readFile(path, "utf8");
    if (!html.includes(CSP_PLACEHOLDER)) throw new Error(`${file}: missing ${CSP_PLACEHOLDER}`);
    const page = selectCloudBlocks(html, cloudLive, file);
    await writeFile(
      path,
      page.replaceAll(CSP_PLACEHOLDER, SITE_CSP).replaceAll(SIGNUP_PLACEHOLDER, CLOUD_SIGNUP_URL),
    );
  }
  await writeFile(join(outDir, "_headers"), renderHeaders());
}

if (import.meta.main) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error("usage: bun scripts/build.ts <out-dir>");
    process.exit(2);
  }
  await buildSite(resolve(outDir));
  const findings = await auditSite(resolve(outDir));
  if (findings.length > 0) {
    for (const { file, problem } of findings) console.error(`${file}: ${problem}`);
    process.exit(1);
  }
  console.log(`Built the landing site into ${outDir} (no third-party requests)`);
}
