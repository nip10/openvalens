import type { ServerLeaveOptions } from "./server/server-leave-policy";

/**
 * The order of a sign-out on this phone, kept free of app imports so it can
 * be tested. The wiring lives in `sign-out.ts`.
 */
export type SignOutSteps = {
  /** Issue #92 — stop insight pushes to this phone (needs the session). */
  disablePush: () => Promise<unknown>;
  resetHealthSync: () => Promise<unknown>;
  prepareOffline: (options?: ServerLeaveOptions) => Promise<unknown>;
  signOut: () => Promise<unknown>;
  clearQueries: () => void;
};

export function createSignOut(
  steps: SignOutSteps,
): (options?: ServerLeaveOptions) => Promise<void> {
  return async (options) => {
    // Best effort: an unreachable server must not keep the member signed in.
    await steps.disablePush().catch(() => undefined);
    await steps.resetHealthSync();
    await steps.prepareOffline(options);
    await steps.signOut();
    // Drop every cached response so the next account sees none of this one's data.
    steps.clearQueries();
  };
}
