import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  invitationState,
  type WorkspaceInvitation,
} from "@openvalens/api/presenters/workspace-invitation";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";

import { MailOpen } from "lucide-react";

import { EmptyState, ErrorState, Section, StatusPill } from "./page";
import { SharingAvatar } from "./sharing-avatar";

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
    <Section
      icon={MailOpen}
      tone="signal"
      title={
        listState === "ready" && invitations.length > 0 ? (
          <Trans>Your invitations · {invitations.length}</Trans>
        ) : (
          <Trans>Your invitations</Trans>
        )
      }
    >
      {message ? (
        <p className="text-sm text-ink-2" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      {listState === "loading" ? (
        <Skeleton className="h-24 w-full rounded-3xl" />
      ) : listState === "error" ? (
        <ErrorState
          title={<Trans>Could not load invitations.</Trans>}
          action={
            <Button variant="outline" onClick={onRetry}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      ) : invitations.length === 0 ? (
        <EmptyState
          icon={MailOpen}
          title={<Trans>You have no pending workspace invitations.</Trans>}
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {invitations.map((invitation) => {
            const state = invitationState(invitation, { sessionEmail, now });
            const roleLabel = ROLE_LABELS[invitation.role];
            const accepting = busy?.id === invitation.id && busy.action === "accept";
            const declining = busy?.id === invitation.id && busy.action === "decline";
            return (
              <li key={invitation.id} className="sheet grid min-w-0 content-start gap-4 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <SharingAvatar name={invitation.organizationName ?? invitation.email} />
                  <div className="grid min-w-0 gap-1">
                    <span className="font-semibold text-ink wrap-break-word">
                      {invitation.organizationName ?? t`A workspace`}
                    </span>
                    <span>
                      <StatusPill tone="neutral">
                        {roleLabel ? i18n._(roleLabel) : invitation.role}
                      </StatusPill>
                    </span>
                    <span className="text-sm text-ink-3 wrap-anywhere">
                      <Trans>Invited email: {invitation.email}</Trans>
                    </span>
                  </div>
                </div>
                {state === "pending" ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      onClick={() => onAccept(invitation.id)}
                      disabled={busy !== null}
                    >
                      {accepting ? t`Accepting…` : t`Accept`}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => onDecline(invitation.id)}
                      disabled={busy !== null}
                    >
                      {declining ? t`Declining…` : t`Decline`}
                    </Button>
                  </div>
                ) : (
                  <p className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
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
    </Section>
  );
}
