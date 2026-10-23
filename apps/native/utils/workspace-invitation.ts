/**
 * Issue #133 — native workspace invitation acceptance.
 *
 * A signed-in recipient lists the invitations addressed to their own session
 * email and then accepts or declines one through the protected Better Auth
 * organization SDK. This module is dependency-free (no RPC client, no Varlock,
 * no React Native) so it is unit-tested directly with a fake client. Copy shown
 * to the recipient is a Lingui descriptor (#67); the screen renders it with
 * `_()`.
 *
 * Invariants (see CONTRIBUTING.md "Accounts and instance admission"):
 * - An invitation only ever targets an existing account; nothing here creates
 *   an account, admits a new user or mints a bearer.
 * - The recipient is derived from the live session, never from client input,
 *   so an invitation for another email cannot be accepted.
 * - Accepting activates the joined workspace on the session; the caller
 *   refreshes the active organization from the SDK afterwards.
 */

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

export type WorkspaceInvitation = {
  id: string;
  email: string;
  role: string;
  organizationId: string;
  organizationName?: string | null;
  status: string;
  // The SDK types these as `Date` on the client; over HTTP they arrive as ISO
  // strings, so accept both.
  expiresAt: string | Date;
  createdAt: string | Date;
};

export type WorkspaceInvitationErrorShape = {
  code?: string | null;
  status?: number | null;
  message?: string | null;
};

export type InvitationFetchResult<T> = {
  data: T | null;
  error: WorkspaceInvitationErrorShape | null;
};

/**
 * The minimal slice of the better-auth client this flow uses. The screen binds
 * the real `authClient` to it; tests inject a fake.
 */
export type WorkspaceInvitationClient = {
  getSession(): Promise<{
    data: {
      session?: { activeOrganizationId?: string | null } | null;
      user?: { email?: string | null } | null;
    } | null;
  }>;
  organization: {
    listUserInvitations(input: {
      query?: { email?: string };
    }): Promise<InvitationFetchResult<WorkspaceInvitation[]>>;
    acceptInvitation(input: { invitationId: string }): Promise<InvitationFetchResult<unknown>>;
    rejectInvitation(input: { invitationId: string }): Promise<InvitationFetchResult<unknown>>;
  };
};

export type InvitationFailureReason = "wrong_account" | "expired" | "denied" | "unavailable";

export type InvitationDisplayState = "pending" | "expired" | "wrong_account" | "unavailable";

/**
 * An invitation failure. `userMessage` is the recipient-facing copy, rendered
 * with `_()`; `message` keeps the English source text for logs.
 */
export class WorkspaceInvitationError extends Error {
  constructor(
    readonly userMessage: MessageDescriptor,
    readonly reason: InvitationFailureReason,
  ) {
    super(userMessage.message ?? userMessage.id);
    this.name = "WorkspaceInvitationError";
  }
}

const SIGN_IN_AGAIN = msg`Sign in again to continue.`;

const FAILURE_MESSAGES: Record<InvitationFailureReason, MessageDescriptor> = {
  wrong_account: msg`This invitation was sent to a different email address. Sign in with the invited account to use it.`,
  expired: msg`This invitation is no longer available. It may have expired or already been used.`,
  denied: msg`You cannot use this invitation. Ask the workspace owner for a new one.`,
  unavailable: msg`Could not complete that action. Please try again.`,
};

/** Better Auth organization error `code` values mapped to a recipient-facing reason. */
const ERROR_CODE_REASONS: Record<string, InvitationFailureReason> = {
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION: "wrong_account",
  INVITATION_NOT_FOUND: "expired",
  EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION: "denied",
  EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION: "denied",
  ORGANIZATION_MEMBERSHIP_LIMIT_REACHED: "denied",
  ORGANIZATION_NOT_FOUND: "unavailable",
  INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION: "unavailable",
};

/**
 * Classify a client-side invitation response error into a recipient-facing
 * reason. Keyed on the Better Auth error `code` first (the endpoint sets one),
 * then the HTTP status, so a wrong account, an expired/used invitation and a
 * denial stay distinguishable.
 */
export function classifyInvitationError(error: WorkspaceInvitationErrorShape): {
  reason: InvitationFailureReason;
  message: MessageDescriptor;
} {
  const codeReason = error.code ? ERROR_CODE_REASONS[error.code] : undefined;
  if (codeReason) {
    return { reason: codeReason, message: FAILURE_MESSAGES[codeReason] };
  }
  if (error.status === 401) {
    return { reason: "unavailable", message: SIGN_IN_AGAIN };
  }
  return { reason: "unavailable", message: FAILURE_MESSAGES.unavailable };
}

/**
 * Presentation state for one invitation, from the recipient's own view. An
 * invitation is only actionable while it is pending and unexpired, and only
 * for the email the session is signed in as.
 */
export function invitationState(
  invitation: WorkspaceInvitation,
  options: { sessionEmail: string | null; now: number },
): InvitationDisplayState {
  if (invitation.status !== "pending") return "unavailable";
  const expiresAt =
    invitation.expiresAt instanceof Date
      ? invitation.expiresAt.getTime()
      : Date.parse(invitation.expiresAt);
  if (Number.isFinite(expiresAt) && expiresAt <= options.now) return "expired";
  const sessionEmail = options.sessionEmail?.trim().toLowerCase();
  if (sessionEmail && invitation.email.trim().toLowerCase() !== sessionEmail) {
    return "wrong_account";
  }
  return "pending";
}

/** Pending invitations addressed to the signed-in account. */
export async function listMyInvitations(
  client: WorkspaceInvitationClient,
): Promise<WorkspaceInvitation[]> {
  const session = await client.getSession();
  const email = session.data?.user?.email?.trim().toLowerCase();
  if (!email) {
    throw new WorkspaceInvitationError(SIGN_IN_AGAIN, "unavailable");
  }
  const result = await client.organization.listUserInvitations({ query: {} });
  if (result.error) {
    const { reason, message } = classifyInvitationError(result.error);
    throw new WorkspaceInvitationError(message, reason);
  }
  return result.data ?? [];
}

/**
 * Accept one invitation. On success the SDK has already activated the joined
 * workspace on the session; the session is re-read so the caller can refresh
 * the active organization rather than trust a stale value.
 */
export async function acceptWorkspaceInvitation(
  client: WorkspaceInvitationClient,
  invitationId: string,
): Promise<{ activeOrganizationId: string | null }> {
  const result = await client.organization.acceptInvitation({ invitationId });
  if (result.error) {
    const { reason, message } = classifyInvitationError(result.error);
    throw new WorkspaceInvitationError(message, reason);
  }
  const session = await client.getSession();
  return { activeOrganizationId: session.data?.session?.activeOrganizationId ?? null };
}

/** Decline one invitation. The invitation is marked rejected by the SDK. */
export async function declineWorkspaceInvitation(
  client: WorkspaceInvitationClient,
  invitationId: string,
): Promise<void> {
  const result = await client.organization.rejectInvitation({ invitationId });
  if (result.error) {
    const { reason, message } = classifyInvitationError(result.error);
    throw new WorkspaceInvitationError(message, reason);
  }
}
