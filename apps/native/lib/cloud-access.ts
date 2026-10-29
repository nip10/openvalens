import { useQuery } from "@tanstack/react-query";

import { client, orpc } from "@/utils/orpc";

/**
 * Issue #298 — whether the OpenValens Cloud workspace in use takes new
 * records. When its access has ended the server refuses writes
 * (`ACCESS_READ_ONLY`) while reading and export keep working, so the app
 * shows a neutral notice and pauses phone sync instead of sending (or
 * queuing) writes that would fail. A self-hosted server always answers full
 * access. Nothing here offers anything to buy (App Store Review Guideline
 * 3.1.3(f)).
 */

export type CloudAccess = Awaited<ReturnType<typeof client.access.status>>;

export const CLOUD_ACCESS_STALE_MS = 5 * 60_000;

/** True when the server is Cloud and the workspace is read-only. */
export function writesPaused(access: CloudAccess | null | undefined): boolean {
  return access?.mode === "cloud" && access.level === "read_only";
}

/** A refused write: the workspace's Cloud access has ended. */
export function isAccessEndedError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "ACCESS_READ_ONLY";
}

/** One read of the access state; `null` when it could not be read. */
export async function readCloudAccess(): Promise<CloudAccess | null> {
  try {
    return await client.access.status({});
  } catch {
    return null;
  }
}

export function useCloudAccess() {
  return useQuery({
    ...orpc.access.status.queryOptions({ input: {} }),
    staleTime: CLOUD_ACCESS_STALE_MS,
    retry: 1,
  });
}
