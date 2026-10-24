/**
 * Issue #243 — query key for the signed-in user's own workspace invitations.
 * They come from the Better Auth organization SDK, not oRPC, so the key is
 * scoped here to the session email: a stale entry from one account never
 * shows for another.
 */
export function myInvitationsQueryKey(sessionEmail: string) {
  return ["workspace-invitations", "mine", sessionEmail] as const;
}
