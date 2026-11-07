import { authClient } from "@/lib/auth-client";
import { resetHealthSync } from "@/lib/health-sync";
import { prepareOfflineSignOut } from "@/lib/offline/sync";
import { disablePushOnThisPhone } from "@/lib/push-notifications";
import { createSignOut } from "@/lib/sign-out-steps";
import { queryClient } from "@/utils/orpc";
import { beginDirectDeviceAuthorityTransition } from "@/lib/direct-devices/authority";
import { getDirectDeviceStore } from "@/lib/direct-devices/persistence/sqlite";

/** The one sign-out used by every screen: push, health sync, offline data, session, cache. */
export const signOutOfThisPhone = createSignOut({
  invalidateDirectDevices: beginDirectDeviceAuthorityTransition,
  purgeDirectDevices: () => getDirectDeviceStore().purgeAll(),
  disablePush: disablePushOnThisPhone,
  resetHealthSync,
  prepareOffline: prepareOfflineSignOut,
  signOut: () => authClient.signOut(),
  clearQueries: () => queryClient.clear(),
});
