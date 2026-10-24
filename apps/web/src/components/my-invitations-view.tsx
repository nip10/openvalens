import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  invitationState,
  type WorkspaceInvitation,
} from "@openvalens/api/presenters/workspace-invitation";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Skeleton } from "@openvalens/ui/components/skeleton";

/**
 * Issue #243 — the signed-in user's own pending workspace invitations on web,
 * mirroring native `(drawer)/invitations`. Presentational: the connected card
 * (`my-invitations-card`) owns the Better Auth calls.
 */

const ROLE_LABELS: Record<string, MessageDescriptor> = {
  owner: msg`owner`,
  admin: msg`admin`,
  member: msg`member`,
};

export type MyInvitationsViewProps = {
  sessionEmail: string;
  listState: "loading" | "error" | "ready";
  invitations: readonly WorkspaceInvitation[];
  /** Recipient-facing outcome of the last accept/decline, if any. */
  message: string | null;
  /** The invitation an accept/decline is running for, if any. */
  busy: { id: string; action: "accept" | "decline" } | null;
  now: number;
  onAccept: (invitationId: string) => void;
  onDecline: (invitationId: string) => void;
  onRetry: () => void;
};

export function MyInvitationsView({
  sessionEmail,
  listState,
  invitations,
  message,
  busy,
  now,
  onAccept,
  onDecline,
  onRetry,
}: MyInvitationsViewProps) {
  const { t, i18n } = useLingui();

  return (
    <Card className="mb-6 py-0">
      <CardHeader className="border-b border-border">
        <CardTitle>
          {listState === "ready" && invitations.length > 0 ? (
            <Trans>Your invitations · {invitations.length}</Trans>
          ) : (
            <Trans>Your invitations</Trans>
          )}
        </CardTitle>
      </CardHeader>
      {message ? (
        <p className="px-4 pt-3 text-sm" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      {listState === "loading" ? (
        <CardContent className="py-4">
          <Skeleton className="h-10 w-full" />
        </CardContent>
      ) : listState === "error" ? (
        <CardContent className="py-4 text-sm text-muted-foreground">
          <Trans>Could not load invitations.</Trans>{" "}
          <button className="underline" onClick={onRetry}>
            <Trans>Retry</Trans>
          </button>
        </CardContent>
      ) : invitations.length === 0 ? (
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          <Trans>You have no pending workspace invitations.</Trans>
        </CardContent>
      ) : (
        <ul className="divide-y divide-border">
          {invitations.map((invitation) => {
            const state = invitationState(invitation, { sessionEmail, now });
            const roleLabel = ROLE_LABELS[invitation.role];
            const accepting = busy?.id === invitation.id && busy.action === "accept";
            const declining = busy?.id === invitation.id && busy.action === "decline";
            return (
              <li
                key={invitation.id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="font-medium wrap-anywhere">
                    {invitation.organizationName ?? t`A workspace`}
                  </div>
                  <div className="text-sm text-muted-foreground wrap-anywhere">
                    {roleLabel ? i18n._(roleLabel) : invitation.role} ·{" "}
                    <Trans>Invited email: {invitation.email}</Trans>
                  </div>
                </div>
                {state === "pending" ? (
                  <div className="flex gap-2">
                    <Button
                      className="min-h-11"
                      onClick={() => onAccept(invitation.id)}
                      disabled={busy !== null}
                    >
                      {accepting ? t`Accepting…` : t`Accept`}
                    </Button>
                    <Button
                      className="min-h-11"
                      variant="outline"
                      onClick={() => onDecline(invitation.id)}
                      disabled={busy !== null}
                    >
                      {declining ? t`Declining…` : t`Decline`}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {state === "expired"
                      ? t`This invitation has expired.`
                      : state === "wrong_account"
                        ? t`This invitation was sent to a different email address.`
                        : t`This invitation is no longer pending.`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
