import { clearStoredAuthSession } from "@/lib/auth-client";
import { cancelPendingMagicLink } from "@/lib/magic-link";
import { clearAllServerData, countQueuedWrites } from "@/lib/offline/cache";
import { isMetricOutboxBusy } from "@/lib/offline/sync";
import { signOutOfThisPhone } from "@/lib/sign-out";
import { queryClient } from "@/utils/orpc";
import { beginDirectDeviceAuthorityTransition } from "@/lib/direct-devices/authority";
import { getDirectDeviceStore } from "@/lib/direct-devices/persistence/sqlite";

import { forgetServerUrl, saveServerUrl } from "./server-url";
import {
  requireSafeServerLeave,
  type PreserveServerLeaveOptions,
  type ServerLeaveOptions,
} from "./server-leave-policy";
import { readServerLeaveSafety } from "./server-leave-safety";
import { createSwitchServer } from "./switch-server-steps";

function preservingOptions(options?: ServerLeaveOptions): PreserveServerLeaveOptions {
  return {
    pendingDataPolicy: "preserve",
    hasInFlightWrites: () =>
      isMetricOutboxBusy() ||
      queryClient.isMutating() > 0 ||
      options?.hasInFlightWrites?.() === true,
  };
}

/**
 * Issue #295 — leave the current server: sign out, wipe its data from this
 * phone, then save `next` or (with `null`) ask again on the server choice.
 * The server choice saves through this too, so a newly chosen server always
 * starts from a clean phone even if an earlier address could not be read.
 */
export const switchServer = createSwitchServer({
  invalidateDirectDevices: beginDirectDeviceAuthorityTransition,
  signOut: (options) =>
    signOutOfThisPhone(
      options?.pendingDataPolicy === "preserve" ? preservingOptions(options) : undefined,
    ),
  clearLocalData: (options) => {
    if (options?.pendingDataPolicy === "preserve") {
      clearAllServerData(preservingOptions(options));
    } else {
      clearAllServerData();
    }
    // Direct devices are registered against the old server, so their store
    // must not survive the switch even when pending data is preserved.
    getDirectDeviceStore().purgeAll();
  },
  clearSession: clearStoredAuthSession,
  cancelPendingMagicLink,
  clearQueries: () => queryClient.clear(),
  setServer: (url) => (url ? saveServerUrl(url) : forgetServerUrl()),
  assertCanLeave: (options) =>
    requireSafeServerLeave(readServerLeaveSafety(preservingOptions(options))),
});

/**
 * Writes this phone has not sent yet; switching server deletes them. `null`
 * when the count could not be read, which the caller treats as "maybe some".
 */
export function unsyncedWriteCount(): number | null {
  try {
    return countQueuedWrites() + getDirectDeviceStore().countUnaccepted();
  } catch {
    return null;
  }
}
