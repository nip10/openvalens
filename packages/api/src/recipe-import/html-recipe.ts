/**
 * Pulls the parts of a fetched page a recipe draft may use (Issue #82):
 * schema.org JSON-LD blocks, and the Open Graph title and site name as
 * metadata only. Open Graph never supplies ingredients. The page is untrusted
 * text; nothing here renders or executes it, and no other page content
 * (instructions, images, stories, reviews) is kept.
 */

export type RecipePage = {
  /** The parsed JSON-LD blocks; malformed blocks are skipped. */
  jsonLd: unknown[];
  metadata: { title: string | null; siteName: string | null };
};

const MAX_BLOCKS = 20;
const MAX_META_LENGTH = 300;

const JSON_LD_SCRIPT =
  /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
const META_TAG = /<meta\b[^>]*>/gi;

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi, (entity, code: string) => {
    const lower = code.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos" || lower === "#39") return "'";
    const point = lower.startsWith("#x")
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10);
    return Number.isInteger(point) && point > 0 && point <= 0x10ffff
      ? String.fromCodePoint(point)
      : entity;
  });
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return match ? (match[2] ?? match[3] ?? null) : null;
}

function plainMeta(value: string | null): string | null {
  if (value === null) return null;
  const text = decodeEntities(value).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, MAX_META_LENGTH) : null;
}

export function extractRecipePage(html: string): RecipePage {
  const jsonLd: unknown[] = [];
  for (const match of html.matchAll(JSON_LD_SCRIPT)) {
    if (jsonLd.length >= MAX_BLOCKS) break;
    try {
      jsonLd.push(JSON.parse(match[1]!.trim()));
    } catch {
      // A broken block is ignored; others on the page may still be valid.
    }
  }
  let title: string | null = null;
  let siteName: string | null = null;
  for (const match of html.matchAll(META_TAG)) {
    const property = attribute(match[0], "property")?.toLowerCase();
    if (property === "og:title" && title === null)
      title = plainMeta(attribute(match[0], "content"));
    if (property === "og:site_name" && siteName === null)
      siteName = plainMeta(attribute(match[0], "content"));
  }
  return { jsonLd, metadata: { title, siteName } };
}
