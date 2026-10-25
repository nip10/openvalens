import { orpc } from "./orpc";

export type {
  AdminAccessOutput,
  AdminBackupStatusOutput,
  AdminConfigurationEntry,
  AdminConfigurationOutput,
} from "./admin-settings-keys";

import {
  adminAccessQueryKey,
  adminBackupStatusQueryKey,
  adminConfigurationQueryKey,
} from "./admin-settings-keys";

export function adminAccessQueryOptions(userId: string) {
  return {
    ...orpc.adminSettings.access.queryOptions({ input: {} }),
    queryKey: [...adminAccessQueryKey(userId)],
    staleTime: 0,
    retry: 1,
  };
}

export function adminConfigurationQueryOptions(userId: string) {
  return {
    ...orpc.adminSettings.configuration.queryOptions({ input: {} }),
    queryKey: [...adminConfigurationQueryKey(userId)],
    staleTime: 0,
    retry: 1,
  };
}

/** Issue #64 — backup status for the admin panel; refreshed every minute. */
export function adminBackupStatusQueryOptions(userId: string) {
  return {
    ...orpc.adminSettings.backupStatus.queryOptions({ input: {} }),
    queryKey: [...adminBackupStatusQueryKey(userId)],
    staleTime: 0,
    refetchInterval: 60_000,
    retry: 1,
  };
}
