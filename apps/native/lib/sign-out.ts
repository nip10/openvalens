import { authClient } from "@/lib/auth-client";
import { resetHealthSync } from "@/lib/health-sync";
import { isMetricOutboxBusy, prepareOfflineSignOut } from "@/lib/offline/sync";
import { disablePushOnThisPhone } from "@/lib/push-notifications";
import { createSignOut } from "@/lib/sign-out-steps";
import { queryClient } from "@/utils/orpc";
import { beginDirectDeviceAuthorityTransition } from "@/lib/direct-devices/authority";
import { getDirectDeviceStore } from "@/lib/direct-devices/persistence/sqlite";

import type { PreserveServerLeaveOptions, ServerLeaveOptions } from "./server/server-leave-policy";

function preserveOptions(options?: ServerLeaveOptions): PreserveServerLeaveOptions | undefined {
  if (options?.pendingDataPolicy !== "preserve") return undefined;
  return {
    pendingDataPolicy: "preserve",
    hasInFlightWrites: () =>
      isMetricOutboxBusy() ||
      queryClient.isMutating() > 0 ||
      options.hasInFlightWrites?.() === true,
  };
}

/** The one sign-out used by every screen: push, health sync, offline data, session, cache. */
export const signOutOfThisPhone = createSignOut({
  invalidateDirectDevices: beginDirectDeviceAuthorityTransition,
  purgeDirectDevices: () => getDirectDeviceStore().purgeAll(),
  disablePush: disablePushOnThisPhone,
  resetHealthSync,
  prepareOffline: (options) => prepareOfflineSignOut(preserveOptions(options)),
  signOut: () => authClient.signOut(),
  clearQueries: () => queryClient.clear(),
});
