/**
 * Issue #507 — what an OAuth client may call itself, and the host it is shown
 * with. Pure TypeScript with no imports: the app bundles use it through
 * `@openvalens/api/presenters/ai-apps`.
 *
 * A client's name is self-declared. Anyone can register one called
 * "OpenValens", so a name that reads as ours is never shown or stored as the
 * app's name: the server keeps the app's host as its label instead, and the
 * apps show the host next to every other name ("Claude (claude.ai)").
 */

/**
 * Letters that look like a Latin letter, mapped to it. Lowercase only: the
 * name is lowercased first. `i`, `l`, `1` and `|` share one shape (capital `I`
 * and small `l` look the same in most fonts), and so do `o` and `0`.
 */
const LOOK_ALIKES: Record<string, string> = {
  // Cyrillic
  а: "a",
  в: "b",
  е: "e",
  з: "e",
  і: "i",
  ј: "j",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  п: "n",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  ѕ: "s",
  ӏ: "l",
  ԁ: "d",
  // Greek
  α: "a",
  β: "b",
  ε: "e",
  η: "n",
  ι: "i",
  κ: "k",
  ν: "v",
  ο: "o",
  ρ: "p",
  ς: "s",
  τ: "t",
  υ: "u",
  χ: "x",
  // Latin letters Unicode does not decompose
  ı: "i",
  ł: "l",
  ŀ: "l",
  ø: "o",
  đ: "d",
  // Digits and symbols used as letters
  "0": "o",
  "1": "l",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "|": "l",
  $: "s",
};

/** One shape per group of letters that read the same. */
const SAME_SHAPE: Record<string, string> = { i: "l", u: "v" };

/**
 * The name reduced to its look: compatibility forms (full-width, bold, ligatures)
 * folded, accents dropped, lowercased, look-alike letters mapped to Latin ones,
 * and everything but letters removed.
 */
export function aiAppNameSkeleton(name: string): string {
  let out = "";
  for (const char of name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()) {
    const latin = LOOK_ALIKES[char] ?? char;
    if (latin >= "a" && latin <= "z") out += SAME_SHAPE[latin] ?? latin;
  }
  return out;
}

/** Names no client may use for itself: ours. */
const RESERVED_SKELETONS = new Set(["openvalens"].map(aiAppNameSkeleton));

/**
 * Whether a client's self-declared name reads as "OpenValens" once case,
 * spaces, punctuation, accents and look-alike letters are set aside
 * ("Open Valens", "OPEN-VALENS", "0penVaIens", Cyrillic "ОpenValens"). Names
 * that only contain it, like "Claude Code (openvalens)", are allowed: the
 * host shown next to them tells the member who it is.
 */
export function isReservedAiAppName(name: string): boolean {
  const skeleton = aiAppNameSkeleton(name);
  return skeleton.length > 0 && RESERVED_SKELETONS.has(skeleton);
}

/** Longest host kept; a DNS name is at most 253 characters. */
const MAX_HOST_LENGTH = 253;

/**
 * The host an app is shown with: the host name of its client id (a metadata
 * document URL) or of the redirect URL it returns to, without the port, which
 * changes on every local run. A custom-scheme URL with no host gives its
 * scheme (`com.example.app`). `null` when the value is not a URL.
 */
export function aiAppHostOf(uri: string | null | undefined): string | null {
  if (!uri) return null;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  const host = url.hostname || url.protocol.replace(/:$/, "");
  return host ? host.toLowerCase().slice(0, MAX_HOST_LENGTH) : null;
}
