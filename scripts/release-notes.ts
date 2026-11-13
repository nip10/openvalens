#!/usr/bin/env bun
/**
 * Release notes (`docs/releases/vX.Y.Z.md`) as data (Issue #446).
 *
 * The notes are the only source of the public changelog (`apps/site`, built
 * into `/changelog` and `/changelog.xml`), of the in-app "What's new" card
 * (bundled into the server build) and of the GitHub Release body. This module
 * has no dependencies so the site image and the server build can both use it.
 *
 * A notes file carries its release date in a comment on its first line,
 * `<!-- released: YYYY-MM-DD -->`: the site is built without the git history
 * (`.git` is not in the Docker build context), so the date has to be in the
 * file. The release workflow warns when it differs from the tag's date.
 *
 * Usage: bun scripts/release-notes.ts --check vX.Y.Z [--tag-date YYYY-MM-DD]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const RELEASES_DIR = join(import.meta.dir, "..", "docs", "releases");
export const REPOSITORY_URL = "https://github.com/nip10/openvalens";

/** A Highlights block. Text is Markdown inline syntax (bold, code, links). */
export type HighlightBlock =
  | { kind: "list"; items: string[] }
  | { kind: "paragraph"; text: string };

export type ReleaseNotes = {
  /** `vX.Y.Z` */
  tag: string;
  /** `X.Y.Z` */
  version: string;
  /** `YYYY-MM-DD`, from the `released:` comment; empty for a translation without one. */
  date: string;
  highlights: HighlightBlock[];
};

export type ReleaseLocale = "en" | "pt-PT";

const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASED = /<!--\s*released:\s*(\S+)\s*-->/;
/**
 * The intended-purpose sentence each Highlights section ends with. The site
 * states it once per page and the app elsewhere, so it is left out here.
 */
const PURPOSE_PREFIX = "OpenValens is a personal record-keeping";

export class ReleaseNotesError extends Error {}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** The lines of the `## Highlights` section, or undefined when there is none. */
function highlightsSection(markdown: string): string[] | undefined {
  const lines = markdown.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  // A pt-PT file may translate the heading.
  const start = lines.findIndex((line) => /^##\s+(Highlights|Destaques)\s*$/.test(line));
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s/.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

/** Bulleted lists and paragraphs; continuation lines are joined with a space. */
function blocksOf(lines: string[]): HighlightBlock[] {
  const blocks: HighlightBlock[] = [];
  let paragraph: string[] = [];
  let list: string[][] | undefined;
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    if (list) blocks.push({ kind: "list", items: list.map((item) => item.join(" ")) });
    paragraph = [];
    list = undefined;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") {
      flush();
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (paragraph.length > 0) flush();
      list ??= [];
      list.push([bullet[1]!]);
    } else if (list) {
      list.at(-1)!.push(line);
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks.filter(
    (block) => block.kind !== "paragraph" || !block.text.startsWith(PURPOSE_PREFIX),
  );
}

/** Problems that keep a notes file from being released; empty when it is fine. */
export function releaseNotesProblems(
  tag: string,
  markdown: string,
  locale: ReleaseLocale = "en",
): string[] {
  const problems: string[] = [];
  if (!TAG.test(tag)) problems.push(`'${tag}' is not a release tag (vMAJOR.MINOR.PATCH)`);
  const released = RELEASED.exec(markdown)?.[1];
  if (released === undefined) {
    // A translation takes its date from the English notes.
    if (locale === "en") {
      problems.push("no release date: add `<!-- released: YYYY-MM-DD -->` as the first line");
    }
  } else if (!isIsoDate(released)) {
    problems.push(`the release date '${released}' is not a YYYY-MM-DD date`);
  }
  const section = highlightsSection(markdown);
  if (section === undefined) problems.push("no `## Highlights` section");
  else if (blocksOf(section).length === 0) problems.push("the `## Highlights` section is empty");
  return problems;
}

/** Parses one notes file; `date` is required unless `locale` is a translation. */
export function parseReleaseNotes(
  tag: string,
  markdown: string,
  locale: ReleaseLocale = "en",
): ReleaseNotes {
  const problems = releaseNotesProblems(tag, markdown, locale);
  if (problems.length > 0) throw new ReleaseNotesError(`${tag}: ${problems.join("; ")}`);
  return {
    tag,
    version: tag.slice(1),
    date: RELEASED.exec(markdown)?.[1] ?? "",
    highlights: blocksOf(highlightsSection(markdown)!),
  };
}

function compareTags(a: string, b: string): number {
  const parts = (tag: string) => tag.slice(1).split(".").map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

/** File name of a tag's notes in a locale (`vX.Y.Z.md`, `vX.Y.Z.pt-PT.md`). */
export function notesFileName(tag: string, locale: ReleaseLocale = "en"): string {
  return locale === "en" ? `${tag}.md` : `${tag}.${locale}.md`;
}

/** Every English notes file in `dir`, newest version first. */
export function readAllReleaseNotes(dir = RELEASES_DIR): ReleaseNotes[] {
  return readdirSync(dir)
    .map((name) => /^(v\d+\.\d+\.\d+)\.md$/.exec(name)?.[1])
    .filter((tag): tag is string => tag !== undefined && TAG.test(tag))
    .sort((a, b) => compareTags(b, a))
    .map((tag) => parseReleaseNotes(tag, readFileSync(join(dir, notesFileName(tag)), "utf8")));
}

/** One tag's notes in a locale, or undefined when that file does not exist. */
export function readReleaseNotes(
  tag: string,
  locale: ReleaseLocale = "en",
  dir = RELEASES_DIR,
): ReleaseNotes | undefined {
  const path = join(dir, notesFileName(tag, locale));
  if (!existsSync(path)) return undefined;
  return parseReleaseNotes(tag, readFileSync(path, "utf8"), locale);
}

/** The GitHub Release for a tag; its body carries the self-hosting notes. */
export function githubReleaseUrl(tag: string): string {
  return `${REPOSITORY_URL}/releases/tag/${tag}`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** A link target as an absolute URL; relative ones point into the tag's `docs/releases`. */
function absoluteUrl(href: string, tag: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  return new URL(href, `${REPOSITORY_URL}/blob/${tag}/docs/releases/`).toString();
}

/**
 * Formats Markdown inline syntax. Code spans are set aside first (as private-use
 * placeholders), so nothing inside backticks is formatted but bold may wrap one.
 */
function formatInline(
  markdown: string,
  format: {
    text: (text: string) => string;
    code: (code: string) => string;
    link: (text: string, href: string) => string;
    strong: (text: string) => string;
    em: (text: string) => string;
  },
): string {
  const codes: string[] = [];
  const withoutCode = markdown.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(code);
    return `${codes.length - 1}`;
  });
  return format
    .text(withoutCode)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text: string, href: string) =>
      format.link(text, href),
    )
    .replace(/\*\*([^*]+)\*\*/g, (_, text: string) => format.strong(text))
    .replace(
      /(^|[^*\w])\*([^*\s][^*]*)\*(?=[^*\w]|$)/g,
      (_, before: string, text: string) => `${before}${format.em(text)}`,
    )
    .replace(/(\d+)/g, (_, index: string) => format.code(codes[Number(index)]!));
}

/** Markdown inline syntax (bold, emphasis, code, links) as HTML. */
export function inlineToHtml(markdown: string, tag: string): string {
  return formatInline(markdown, {
    text: escapeHtml,
    code: (code) => `<code>${escapeHtml(code)}</code>`,
    link: (text, href) => `<a href="${absoluteUrl(href, tag)}">${text}</a>`,
    strong: (text) => `<strong>${text}</strong>`,
    em: (text) => `<em>${text}</em>`,
  });
}

/** Markdown inline syntax as plain text: markers dropped, links reduced to their text. */
export function inlineToText(markdown: string): string {
  return formatInline(markdown, {
    text: (text) => text,
    code: (code) => code,
    link: (text) => text,
    strong: (text) => text,
    em: (text) => text,
  })
    .replace(/\s+/g, " ")
    .trim();
}

/** The Highlights blocks as HTML. */
export function highlightsToHtml(notes: ReleaseNotes): string {
  return notes.highlights
    .map((block) =>
      block.kind === "paragraph"
        ? `<p>${inlineToHtml(block.text, notes.tag)}</p>`
        : `<ul>\n${block.items.map((item) => `  <li>${inlineToHtml(item, notes.tag)}</li>`).join("\n")}\n</ul>`,
    )
    .join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const tag = args[args.indexOf("--check") + 1];
  const tagDateIndex = args.indexOf("--tag-date");
  const tagDate = tagDateIndex === -1 ? undefined : args[tagDateIndex + 1];
  if (!args.includes("--check") || !tag) {
    console.error("usage: bun scripts/release-notes.ts --check vX.Y.Z [--tag-date YYYY-MM-DD]");
    process.exit(2);
  }
  const path = join(RELEASES_DIR, notesFileName(tag));
  const file = `docs/releases/${notesFileName(tag)}`;
  if (!existsSync(path)) {
    console.error(
      `::error::${file} is missing. Write the release notes before tagging (docs/releasing.md).`,
    );
    process.exit(1);
  }
  const markdown = readFileSync(path, "utf8");
  const problems = releaseNotesProblems(tag, markdown);
  for (const locale of ["pt-PT"] as const) {
    const translated = join(RELEASES_DIR, notesFileName(tag, locale));
    if (!existsSync(translated)) continue;
    for (const problem of releaseNotesProblems(tag, readFileSync(translated, "utf8"), locale)) {
      problems.push(`${notesFileName(tag, locale)}: ${problem}`);
    }
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error::${file}: ${problem}`);
    process.exit(1);
  }
  const { date } = parseReleaseNotes(tag, markdown);
  if (tagDate && tagDate !== date) {
    console.log(
      `::warning::${file} says it was released on ${date}, but ${tag} was tagged on ${tagDate}. The changelog shows ${date}; correct the date on main if it is wrong.`,
    );
  }
  console.log(`${file}: release notes for ${tag} (${date}) are complete.`);
}
