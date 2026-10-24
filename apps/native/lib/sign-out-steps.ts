/**
 * The order of a sign-out on this phone, kept free of app imports so it can
 * be tested. The wiring lives in `sign-out.ts`.
 */
export type SignOutSteps = {
  /** Issue #92 — stop insight pushes to this phone (needs the session). */
  disablePush: () => Promise<unknown>;
  resetHealthSync: () => Promise<unknown>;
  prepareOffline: () => Promise<unknown>;
  signOut: () => Promise<unknown>;
  clearQueries: () => void;
};

export function createSignOut(steps: SignOutSteps): () => Promise<void> {
  return async () => {
    // Best effort: an unreachable server must not keep the member signed in.
    await steps.disablePush().catch(() => undefined);
    await steps.resetHealthSync();
    await steps.prepareOffline();
    await steps.signOut();
    // Drop every cached response so the next account sees none of this one's data.
    steps.clearQueries();
  };
}
