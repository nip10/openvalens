import { orpc } from "./orpc";

export type {
  AdminAccessOutput,
  AdminConfigurationEntry,
  AdminConfigurationOutput,
} from "./admin-settings-keys";

import { adminAccessQueryKey, adminConfigurationQueryKey } from "./admin-settings-keys";

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
