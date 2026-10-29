export type CompleteExportState =
  | "queued"
  | "running"
  | "ready"
  | "failed"
  | "cancelled"
  | "expired";

export type CompleteExportFailure =
  | "LIMIT_EXCEEDED"
  | "ATTACHMENT_UNAVAILABLE"
  | "STORAGE_UNAVAILABLE"
  | "INTERRUPTED"
  | "INTERNAL"
  | null;

export interface CompleteExportStatus {
  id: string;
  state: CompleteExportState;
  createdAt: string;
  expiresAt: string | null;
  bytes: number | null;
  failure: CompleteExportFailure;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function completeExportDownloadUrl(serverUrl: string, jobId: string): string {
  if (!UUID.test(jobId)) throw new Error("Invalid export id");
  const server = new URL(serverUrl);
  if (
    !["http:", "https:"].includes(server.protocol) ||
    server.username ||
    server.password ||
    server.pathname !== "/" ||
    server.search ||
    server.hash
  ) {
    throw new Error("Invalid server address");
  }
  return new URL(`/api/data-rights/exports/${jobId}/download`, server.origin).toString();
}

export function shouldPollCompleteExport(status: CompleteExportStatus | null | undefined): boolean {
  return status?.state === "queued" || status?.state === "running";
}

export function completeExportPollInterval(status: CompleteExportStatus | null | undefined) {
  return shouldPollCompleteExport(status) ? 2_000 : false;
}

/** Stable, non-secret cache namespace per server; the source URL never enters a filename. */
export function completeExportCacheNamespace(serverUrl: string): string {
  const origin = new URL(serverUrl).origin;
  let hash = 0x811c9dc5;
  for (let index = 0; index < origin.length; index++) {
    hash = Math.imul(hash ^ origin.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
