import { WORKOUT_GUIDE_RAW_BASE } from "./workout-guide";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_MS = 30_000;

/** Fixed HTTPS wger image paths (JPEG or PNG; other formats are not published). */
export function isAllowedWgerImageUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.hostname === "wger.de" &&
    !url.port &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/media\/exercise-images\/\d+\/[A-Za-z0-9._-]+\.(?:jpe?g|png)$/i.test(url.pathname)
  );
}

/** Files of the pinned Workout Guide revision only: the manifest and PNG frames. */
export function isAllowedWorkoutGuideUrl(url: URL): boolean {
  if (url.search || url.hash || url.username || url.password || url.port) return false;
  if (!url.href.startsWith(WORKOUT_GUIDE_RAW_BASE)) return false;
  const rest = url.href.slice(WORKOUT_GUIDE_RAW_BASE.length);
  return (
    rest === "manifest.json" || /^assets\/[a-z0-9]+(?:-[a-z0-9]+)*\/frame-[123]\.png$/.test(rest)
  );
}

/**
 * Downloads one allowlisted public file: no redirects, bounded size and time,
 * no credentials or user data sent. Returns the raw bytes; images still go
 * through the sanitising asset service before anyone can see them.
 */
export async function downloadAllowed(
  url: URL,
  allowed: (url: URL) => boolean,
  fetchImpl: typeof fetch = fetch,
  maxBytes = MAX_BYTES,
): Promise<Uint8Array> {
  if (!allowed(url)) throw new Error("download_url_untrusted");
  const response = await fetchImpl(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(MAX_MS),
  });
  if (response.status >= 300 && response.status < 400) throw new Error("download_redirect");
  if (!response.ok || !response.body) throw new Error(`download_failed_${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("download_size_limit");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("download_size_limit");
    }
    parts.push(next.value);
  }
  if (declared && !response.headers.has("content-encoding") && size !== declared)
    throw new Error("download_truncated");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}
