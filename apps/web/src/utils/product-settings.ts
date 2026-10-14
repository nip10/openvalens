import { useQuery } from "@tanstack/react-query";

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

import { productSettingsQueryKey } from "./product-settings-keys";

export type { ProductSettingsSnapshot } from "@openvalens/api/product-settings-contract";

export function productSettingsQueryOptions(userId: string) {
  return {
    ...orpc.adminSettings.productSettings.queryOptions({ input: {} }),
    queryKey: [...productSettingsQueryKey(userId)],
    staleTime: 0,
    retry: 1,
  };
}

/**
 * Read the effective product display settings for the current session.
 *
 * Callers render their main content immediately and use the result as an
 * optional display-preferences object. When no preference has been loaded yet,
 * the shared presenters fall back to metric / en-US. A cached preference is
 * preserved while the query refetches in the background, and callers should
 * surface honest status with `<ProductSettingsStatus />` rather than silently
 * claiming an unverified imperial default.
 */
export function useProductSettings() {
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;

  return useQuery({
    ...productSettingsQueryOptions(userId ?? ""),
    enabled: !!userId,
  });
}

export function isProductSettingsConflictError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "CONFLICT"
  );
}
