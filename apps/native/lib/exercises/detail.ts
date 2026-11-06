import type { PreviewAsset } from "./media";

/**
 * Issue #404 — which image source an exercise shows and how it is credited.
 * The server sends one source per exercise (#400); a mixed list is treated
 * as Workout Guide only, so sources are never mixed on screen.
 */
export function mediaSource(assets: readonly PreviewAsset[]): "workout-guide" | "wger" | null {
  if (assets.length === 0) return null;
  return assets.some((asset) => asset.source === "workout-guide") ? "workout-guide" : "wger";
}

export function displayAssets(assets: readonly PreviewAsset[]): PreviewAsset[] {
  const source = mediaSource(assets);
  if (source === "workout-guide") return assets.filter((a) => a.source === "workout-guide");
  return assets.slice(0, 1);
}

const LICENSE_NAMES: Record<string, string> = {
  "CC-BY-SA-4.0": "CC BY-SA 4.0",
  "CC-BY-SA-3.0": "CC BY-SA 3.0",
  "CC0-1.0": "CC0 1.0",
};

export type ImageCredit = {
  kind: "workout-guide" | "wger";
  license: string;
  licenseUrl: string;
  author: string | null;
  attribution: string | null;
  sourceUrl: string;
};

/** The per-item image credit: licence, author, upstream attribution and source. */
export function imageCredit(assets: readonly PreviewAsset[]): ImageCredit | null {
  const shown = displayAssets(assets);
  const first = shown[0];
  const kind = mediaSource(shown);
  if (!first || !kind) return null;
  return {
    kind,
    license: LICENSE_NAMES[first.license] ?? first.license,
    licenseUrl: first.licenseUrl,
    author: first.author,
    attribution: first.attribution,
    sourceUrl: first.sourceUrl,
  };
}

/** Short chips under a library row: up to two primary muscles, then one piece of equipment. */
export function rowChips(item: {
  muscles: Array<{ name: string; role?: string | null }>;
  equipment: Array<{ name: string }>;
}): string[] {
  const primary = item.muscles.filter((m) => m.role === "primary").map((m) => m.name);
  const muscles = (primary.length ? primary : item.muscles.map((m) => m.name)).slice(0, 2);
  const equipment = item.equipment.map((e) => e.name).filter((n) => !/^none\b/i.test(n));
  return [...new Set([...muscles, ...equipment.slice(0, 1)])];
}
