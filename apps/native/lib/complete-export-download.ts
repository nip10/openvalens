import { Directory, File, Paths } from "expo-file-system";

import { completeExportCacheNamespace } from "./complete-export-utils";
import {
  isCompleteExportCacheFile,
  isExpiredCompleteExportCacheFile,
  streamCompleteExport,
} from "./complete-export-transfer";

const CACHE_DIRECTORY = "openvalens-complete-exports";

function cacheDirectory(serverUrl: string): Directory {
  return new Directory(Paths.cache, CACHE_DIRECTORY, completeExportCacheNamespace(serverUrl));
}

/** Remove stale archives and partials from this server's private cache namespace. */
export function sweepCompleteExportCache(now = Date.now()): void {
  const root = new Directory(Paths.cache, CACHE_DIRECTORY);
  if (!root.exists) return;
  for (const namespace of root.list()) {
    if (!(namespace instanceof Directory)) continue;
    for (const entry of namespace.list()) {
      if (!(entry instanceof File) || !isCompleteExportCacheFile(entry.name)) continue;
      const modified = entry.info().modificationTime;
      if (isExpiredCompleteExportCacheFile(entry.name, modified, now)) entry.delete();
    }
  }
}

/**
 * Download streams directly to the app-private cache; cookies are never placed in the URL.
 * Expo FileSystem 57 exposes cancellation and headers, but no redirect callback/policy. The fixed
 * server endpoint must therefore keep its contract not to redirect this authenticated download.
 */
export async function downloadCompleteExport(input: {
  serverUrl: string;
  jobId: string;
  cookie: string;
  signal: AbortSignal;
}): Promise<File> {
  const directory = cacheDirectory(input.serverUrl);
  directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, `openvalens-export-${input.jobId}.zip`);
  return streamCompleteExport({
    ...input,
    file,
    download: (url, destination, options) => File.downloadFileAsync(url, destination, options),
  });
}

export function deleteCompleteExportFile(file: File | null): void {
  if (file?.exists) file.delete();
}
