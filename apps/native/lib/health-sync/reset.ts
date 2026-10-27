import { clearCursors } from "./cursor-store";
import { forgetDeviceRegistration } from "./device";
import { clearSyncModules } from "./module-profile";
import { unregisterHealthSyncTask } from "./scheduler";
import { clearHealthSyncStatus } from "./status";

/**
 * Called on sign-out: stop background sync and drop cursors, the device
 * registration and the last-run status, so another account on this phone
 * starts clean. Health Connect data itself is untouched.
 */
export async function resetHealthSync(): Promise<void> {
  await Promise.allSettled([
    unregisterHealthSyncTask(),
    clearCursors(),
    forgetDeviceRegistration(),
    clearHealthSyncStatus(),
    clearSyncModules(),
  ]);
}
