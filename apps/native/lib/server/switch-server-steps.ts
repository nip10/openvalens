import { isServerLeaveBlockedError, type ServerLeaveOptions } from "./server-leave-policy";

/**
 * Issue #295 — the order of a server switch, kept free of app imports so it
 * can be tested. The wiring lives in `switch-server.ts`.
 *
 * Nothing from the old server may survive the switch: its session, cached
 * responses, queued writes, background sync state or a half-finished
 * magic-link request. The old session is cleared before the new address is
 * saved, so it can never be sent to the next server.
 */
export type SwitchServerSteps = {
  /** The usual sign-out (push, health sync, offline data, session, cache). */
  signOut: (options?: ServerLeaveOptions) => Promise<unknown>;
  /** Every cached read and queued write on this phone, in all lanes. */
  clearLocalData: (options?: ServerLeaveOptions) => unknown;
  /** The secure-storage session cookie and session cache. */
  clearSession: () => Promise<unknown>;
  cancelPendingMagicLink: () => Promise<unknown>;
  clearQueries: () => void;
  /** Saves the next server, or forgets the current one so the app asks again. */
  setServer: (url: string | null) => Promise<unknown>;
  /** A final, non-destructive read after session cleanup in preserve mode. */
  assertCanLeave: (options: ServerLeaveOptions) => void;
};

export function createSwitchServer(
  steps: SwitchServerSteps,
): (next: string | null, options?: ServerLeaveOptions) => Promise<void> {
  return async (next, options) => {
    const preserveOptions = options?.pendingDataPolicy === "preserve" ? options : undefined;
    const preserve = preserveOptions !== undefined;
    // Best effort: the old server may be unreachable, which must not keep
    // its data on this phone.
    try {
      await steps.signOut(preserveOptions);
    } catch (error) {
      if (preserve && isServerLeaveBlockedError(error)) throw error;
      // Preserve the established best-effort behavior for other sign-out errors.
    }
    await steps.cancelPendingMagicLink().catch(() => undefined);
    // Not best effort: health data or a session that could not be cleared
    // must not carry over to the next server, so a failure stops the switch.
    await steps.clearLocalData(preserveOptions);
    await steps.clearSession();
    if (preserveOptions) steps.assertCanLeave(preserveOptions);
    steps.clearQueries();
    await steps.setServer(next);
  };
}
