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
  signOut: () => Promise<unknown>;
  /** Every cached read and queued write on this phone, in all lanes. */
  clearLocalData: () => unknown;
  /** The secure-storage session cookie and session cache. */
  clearSession: () => Promise<unknown>;
  cancelPendingMagicLink: () => Promise<unknown>;
  clearQueries: () => void;
  /** Saves the next server, or forgets the current one so the app asks again. */
  setServer: (url: string | null) => Promise<unknown>;
};

export function createSwitchServer(
  steps: SwitchServerSteps,
): (next: string | null) => Promise<void> {
  return async (next) => {
    // Best effort: the old server may be unreachable, which must not keep
    // its data on this phone.
    await steps.signOut().catch(() => undefined);
    await steps.cancelPendingMagicLink().catch(() => undefined);
    // Not best effort: health data or a session that could not be cleared
    // must not carry over to the next server, so a failure stops the switch.
    await steps.clearLocalData();
    await steps.clearSession();
    steps.clearQueries();
    await steps.setServer(next);
  };
}
