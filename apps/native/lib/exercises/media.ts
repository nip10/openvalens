import { Platform } from "react-native";

/**
 * Catalog image previews (#93, #400): validated metadata from the server and
 * own-origin image URLs. Shared by the library, the exercise detail page and
 * the active workout thumbnails.
 */
export type PreviewAsset = {
  /** #400: one source per exercise; Workout Guide frames come in frame order. */
  source?: "wger" | "workout-guide";
  assetId: string;
  path: string;
  contentType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  license: string;
  licenseUrl: string;
  author: string | null;
  attribution: string | null;
  sourceUrl: string;
  transformationNotice: string;
};
const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPreviewAsset(value: unknown): value is PreviewAsset {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.assetId !== "string" ||
    !ASSET_ID.test(item.assetId) ||
    item.path !== `/api/exercise-assets/${item.assetId}`
  )
    return false;
  return (
    (item.contentType === "image/jpeg" || item.contentType === "image/png") &&
    typeof item.width === "number" &&
    Number.isSafeInteger(item.width) &&
    item.width > 0 &&
    item.width <= 10_000 &&
    typeof item.height === "number" &&
    Number.isSafeInteger(item.height) &&
    item.height > 0 &&
    item.height <= 10_000 &&
    typeof item.license === "string" &&
    item.license.trim().length > 0 &&
    typeof item.licenseUrl === "string" &&
    safeHttpUrl(item.licenseUrl) !== null &&
    (typeof item.author === "string" || item.author === null) &&
    (typeof item.attribution === "string" || item.attribution === null) &&
    typeof item.sourceUrl === "string" &&
    safeHttpUrl(item.sourceUrl) !== null &&
    typeof item.transformationNotice === "string"
  );
}

export function previewAssets(value: unknown): PreviewAsset[] {
  return Array.isArray(value) ? value.filter(isPreviewAsset).slice(0, 4) : [];
}

export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function previewUrl(
  asset: PreviewAsset,
  apiBase: string,
  browserOrigin: string | null,
): string | null {
  if (!ASSET_ID.test(asset.assetId) || asset.path !== `/api/exercise-assets/${asset.assetId}`)
    return null;
  if (Platform.OS === "web" && !browserOrigin) return null;
  try {
    const api = new URL(apiBase);
    if (
      (api.protocol !== "http:" && api.protocol !== "https:") ||
      api.username ||
      api.password ||
      api.search ||
      api.hash
    )
      return null;
    if (Platform.OS === "web" && api.origin !== browserOrigin) return null;
    return `${api.origin}/api/exercise-assets/${asset.assetId}`;
  } catch {
    return null;
  }
}
