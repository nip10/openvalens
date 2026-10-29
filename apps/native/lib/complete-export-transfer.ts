import { completeExportDownloadUrl } from "./complete-export-utils";

const FILE_PREFIX = "openvalens-export-";
const RETAIN_MS = 24 * 60 * 60 * 1000;

export interface CompleteExportCacheFile {
  exists: boolean;
  delete(): void;
}

function isUnauthorizedResponse(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /\bHTTP\s+401\b|\bstatus:?[\s]+401\b/i.test(message);
}

export function isCompleteExportCacheFile(name: string): boolean {
  return name.startsWith(FILE_PREFIX) && name.endsWith(".zip");
}

export function isExpiredCompleteExportCacheFile(
  name: string,
  modifiedAt: number | undefined,
  now = Date.now(),
): boolean {
  return (
    isCompleteExportCacheFile(name) && (modifiedAt === undefined || now - modifiedAt > RETAIN_MS)
  );
}

export async function streamCompleteExport<T extends CompleteExportCacheFile>(input: {
  serverUrl: string;
  jobId: string;
  cookie: string;
  signal: AbortSignal;
  file: T;
  download: (
    url: string,
    file: T,
    options: { headers: { Cookie: string }; idempotent: true; signal: AbortSignal },
  ) => Promise<T>;
}): Promise<T> {
  const url = completeExportDownloadUrl(input.serverUrl, input.jobId);
  if (!input.cookie) throw new Error("EXPORT_AUTH_REQUIRED");
  try {
    return await input.download(url, input.file, {
      headers: { Cookie: input.cookie },
      idempotent: true,
      signal: input.signal,
    });
  } catch (error) {
    if (input.file.exists) input.file.delete();
    throw new Error(
      input.signal.aborted
        ? "EXPORT_CANCELLED"
        : isUnauthorizedResponse(error)
          ? "EXPORT_UNAUTHORIZED"
          : "EXPORT_DOWNLOAD_FAILED",
    );
  }
}

export async function shareCompleteExportFile<T>(
  file: T,
  adapters: {
    isAvailable: () => Promise<boolean>;
    isCurrent: () => boolean;
    share: (file: T) => Promise<void>;
  },
): Promise<boolean> {
  if (!(await adapters.isAvailable())) throw new Error("EXPORT_SHARING_UNAVAILABLE");
  if (!adapters.isCurrent()) return false;
  await adapters.share(file);
  return true;
}
