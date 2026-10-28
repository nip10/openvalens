import { clearStoredAuthSession } from "@/lib/auth-client";
import { cancelPendingMagicLink } from "@/lib/magic-link";
import { clearAllServerData, countQueuedWrites } from "@/lib/offline/cache";
import { signOutOfThisPhone } from "@/lib/sign-out";
import { queryClient } from "@/utils/orpc";

import { forgetServerUrl, saveServerUrl } from "./server-url";
import { createSwitchServer } from "./switch-server-steps";

/**
 * Issue #295 — leave the current server: sign out, wipe its data from this
 * phone, then save `next` or (with `null`) ask again on the server choice.
 * The server choice saves through this too, so a newly chosen server always
 * starts from a clean phone even if an earlier address could not be read.
 */
export const switchServer = createSwitchServer({
  signOut: signOutOfThisPhone,
  clearLocalData: clearAllServerData,
  clearSession: clearStoredAuthSession,
  cancelPendingMagicLink,
  clearQueries: () => queryClient.clear(),
  setServer: (url) => (url ? saveServerUrl(url) : forgetServerUrl()),
});

/**
 * Writes this phone has not sent yet; switching server deletes them. `null`
 * when the count could not be read, which the caller treats as "maybe some".
 */
export function unsyncedWriteCount(): number | null {
  try {
    return countQueuedWrites();
  } catch {
    return null;
  }
}
