export type AdminSettingsState =
  | "loading"
  | "access-error"
  | "denied"
  | "config-loading"
  | "config-error"
  | "ready";

export type AccessQueryLike = {
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  data?: { isInstanceAdmin: boolean } | null;
};

export type ConfigQueryLike = {
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  data?: { entries?: { key: string; configured: boolean; sensitive: boolean }[] } | null;
};

export function deriveAdminSettingsState(
  sessionPending: boolean,
  hasUserId: boolean,
  access: AccessQueryLike,
  config: ConfigQueryLike,
  configPermissionDenied?: boolean,
): AdminSettingsState {
  if (sessionPending) return "loading";
  if (!hasUserId) return "denied";
  if (access.isPending || access.isFetching) return "loading";
  if (access.isError) return "access-error";
  if (!access.data?.isInstanceAdmin) return "denied";
  if (config.isPending || config.isFetching) return "config-loading";
  if (config.isError) return configPermissionDenied ? "denied" : "config-error";
  if (config.data) return "ready";
  return "loading";
}
