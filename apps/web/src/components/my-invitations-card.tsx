import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
  acceptWorkspaceInvitation,
  declineWorkspaceInvitation,
  listMyInvitations,
  WorkspaceInvitationError,
  type WorkspaceInvitationClient,
} from "@openvalens/api/presenters/workspace-invitation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { myInvitationsQueryKey } from "@/utils/my-invitations-keys";

import { MyInvitationsView } from "./my-invitations-view";

/**
 * Issue #243 — connected "Your invitations" card for the signed-in user, the
 * web counterpart of native `(drawer)/invitations`. The list and actions go
 * through the protected Better Auth organization SDK; the recipient is the
 * live session, never client input. Accepting makes the joined workspace the
 * session's active one (the SDK sets it), and the app reloads on the
 * dashboard so every view reads the new workspace — as `/accept-invitation`
 * does.
 */
const invitationClient: WorkspaceInvitationClient = {
  getSession: () => authClient.getSession(),
  organization: {
    listUserInvitations: (input) => authClient.organization.listUserInvitations(input),
    acceptInvitation: (input) => authClient.organization.acceptInvitation(input),
    rejectInvitation: (input) => authClient.organization.rejectInvitation(input),
  },
};

const ACTION_FAILED = msg`Could not complete that action. Please try again.`;

export function MyInvitationsCard({ sessionEmail }: { sessionEmail: string }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const { t, i18n } = useLingui();
  const errorMessage = (error: unknown): string =>
    error instanceof WorkspaceInvitationError ? i18n._(error.userMessage) : i18n._(ACTION_FAILED);
  const queryKey = myInvitationsQueryKey(sessionEmail);

  const invitations = useQuery({
    queryKey,
    queryFn: () => listMyInvitations(invitationClient),
  });

  const accept = useMutation({
    mutationFn: (invitationId: string) => acceptWorkspaceInvitation(invitationClient, invitationId),
    onSuccess: () => {
      setMessage(t`Invitation accepted. The workspace is now active.`);
      window.location.assign("/dashboard");
    },
    onError: (error) => setMessage(errorMessage(error)),
  });

  const decline = useMutation({
    mutationFn: (invitationId: string) =>
      declineWorkspaceInvitation(invitationClient, invitationId),
    onSuccess: () => {
      setMessage(t`Invitation declined.`);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => setMessage(errorMessage(error)),
  });

  const busy = accept.isPending
    ? { id: accept.variables, action: "accept" as const }
    : decline.isPending
      ? { id: decline.variables, action: "decline" as const }
      : null;

  return (
    <MyInvitationsView
      sessionEmail={sessionEmail}
      listState={invitations.isPending ? "loading" : invitations.isError ? "error" : "ready"}
      invitations={invitations.data ?? []}
      message={message}
      busy={busy}
      now={Date.now()}
      onAccept={(id) => {
        setMessage(null);
        accept.mutate(id);
      }}
      onDecline={(id) => {
        setMessage(null);
        decline.mutate(id);
      }}
      onRetry={() => {
        setMessage(null);
        void invitations.refetch();
      }}
    />
  );
}
