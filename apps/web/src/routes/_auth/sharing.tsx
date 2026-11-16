import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { Mail, ShieldCheck, UserPlus, Users } from "lucide-react";

import { InviteDialog } from "@/components/invite-dialog";
import { MyInvitationsCard } from "@/components/my-invitations-card";
import {
  SharingConfirmDialog,
  type SharingConfirmTarget,
} from "@/components/sharing-confirm-dialog";
import {
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  Section,
  StatusPill,
  type StatusTone,
} from "@/components/page";
import { SharingAvatar } from "@/components/sharing-avatar";
import { authClient } from "@/lib/auth-client";
import { displayNameOf } from "@/utils/display-name";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/sharing")({
  component: SharingPage,
});

const ROLE_LABELS: Record<string, MessageDescriptor> = {
  owner: msg`owner`,
  admin: msg`admin`,
  member: msg`member`,
};

const INVITATION_STATUS_LABELS: Record<string, MessageDescriptor> = {
  pending: msg`pending`,
  accepted: msg`accepted`,
  rejected: msg`rejected`,
  canceled: msg`canceled`,
};

/** A role or status label, or the stored value when it is not a known one. */
function useCodeLabel() {
  const { i18n } = useLingui();
  return (labels: Record<string, MessageDescriptor>, value: string) => {
    const label = labels[value];
    return label ? i18n._(label) : value;
  };
}

function SharingPage() {
  // Issue #243 — invitations addressed to the signed-in user, shown whatever
  // the state of the workspace's own sharing data.
  const session = authClient.useSession();
  const sessionEmail = session.data?.user?.email?.toLowerCase() ?? null;
  return (
    <SharingContent
      myInvitations={sessionEmail ? <MyInvitationsCard sessionEmail={sessionEmail} /> : null}
    />
  );
}

function SharingContent({ myInvitations }: { myInvitations: ReactNode }) {
  const members = useQuery(orpc.sharing.listMembers.queryOptions({ input: {} }));
  const invitations = useQuery(orpc.sharing.listInvitations.queryOptions({ input: {} }));
  const me = useQuery(orpc.sharing.me.queryOptions({ input: {} }));
  const isOwner = me.data?.role === "owner";
  const [inviting, setInviting] = useState(false);

  const header = (
    <PageHeader
      title={<Trans>Sharing</Trans>}
      description={<Trans>Share this health record with family or a coach.</Trans>}
      actions={
        isOwner ? (
          // #sharing-6 — one header button opens the invite dialog.
          <Button onClick={() => setInviting(true)}>
            <UserPlus aria-hidden="true" />
            <Trans>Invite someone</Trans>
          </Button>
        ) : undefined
      }
    />
  );

  if (members.isPending || invitations.isPending || me.isPending) {
    return (
      <Page>
        {header}
        {myInvitations}
        <div className="grid gap-4 sm:grid-cols-2" aria-hidden="true">
          {["a", "b"].map((key) => (
            <Skeleton key={key} className="h-28 w-full rounded-3xl" />
          ))}
        </div>
      </Page>
    );
  }

  if (
    members.isError ||
    invitations.isError ||
    me.isError ||
    !members.data ||
    !invitations.data ||
    !me.data
  ) {
    return (
      <Page>
        {header}
        {myInvitations}
        <ErrorState
          title={<Trans>Could not load sharing info.</Trans>}
          action={
            <Button
              variant="outline"
              onClick={() => {
                void members.refetch();
                void invitations.refetch();
                void me.refetch();
              }}
            >
              <Trans>Retry</Trans>
            </Button>
          }
        />
      </Page>
    );
  }

  return (
    <Page>
      {header}
      {myInvitations}
      <MembersCard members={members.data} isOwner={isOwner} currentUserId={me.data.userId} />
      {invitations.data.length > 0 ? (
        <InvitationsCard invitations={invitations.data} isOwner={isOwner} />
      ) : null}
      {!isOwner ? (
        <p className="flex items-center gap-3 text-sm text-ink-3">
          <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
          <Trans>Only owners can invite or remove people.</Trans>
        </p>
      ) : null}
      {isOwner ? <InviteDialog open={inviting} onOpenChange={setInviting} /> : null}
    </Page>
  );
}

type MemberRow = {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  createdAt: string;
};

function MembersCard({
  members,
  isOwner,
  currentUserId,
}: {
  members: MemberRow[];
  isOwner: boolean;
  currentUserId: string;
}) {
  const queryClient = useQueryClient();
  const codeLabel = useCodeLabel();
  const { t } = useLingui();
  const remove = useMutation(
    orpc.sharing.removeMember.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.sharing.listMembers.key() });
      },
    }),
  );
  const [confirming, setConfirming] = useState<SharingConfirmTarget | null>(null);

  return (
    <Section
      icon={Users}
      tone="signal"
      title={
        <>
          <Trans>People</Trans> <span className="num text-ink-3">({members.length})</span>
        </>
      }
    >
      {members.length === 0 ? (
        <EmptyState icon={Users} title={<Trans>No members yet.</Trans>} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {members.map((member) => {
            const isMe = member.userId === currentUserId;
            // #sharing-3 — the name as the title and the email once under it;
            // without a name, the email once.
            const name = displayNameOf(member.name, member.email);
            const display = name ?? member.email ?? member.userId;
            return (
              <li key={member.id} className="sheet flex min-w-0 items-start gap-3 p-4">
                <SharingAvatar name={display} />
                <div className="grid min-w-0 flex-1 gap-1">
                  <span className="font-semibold wrap-anywhere text-ink">
                    {display}
                    {isMe ? (
                      <span className="block text-sm font-normal text-ink-3">
                        <Trans>(you)</Trans>
                      </span>
                    ) : null}
                  </span>
                  {name && member.email ? (
                    <span className="text-sm break-all text-ink-3">
                      <span className="sr-only">{t`Email`}: </span>
                      {member.email}
                    </span>
                  ) : null}
                  <span className="flex flex-wrap items-center gap-2 pt-0.5">
                    <StatusPill tone={member.role === "owner" ? "good" : "neutral"}>
                      <span className="sr-only">{t`Role`}: </span>
                      {codeLabel(ROLE_LABELS, member.role)}
                    </StatusPill>
                    {isOwner && !isMe ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() =>
                          setConfirming({ kind: "member", userId: member.userId, name: display })
                        }
                        disabled={remove.isPending}
                      >
                        <Trans>Remove</Trans>
                      </Button>
                    ) : null}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <SharingConfirmDialog
        target={confirming}
        onCancel={() => setConfirming(null)}
        onConfirm={(target) => {
          if (target.kind === "member") remove.mutate({ userId: target.userId });
          setConfirming(null);
        }}
      />
    </Section>
  );
}

type InvitationRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  inviterId: string | null;
  createdAt: string;
};

function InvitationsCard({
  invitations,
  isOwner,
}: {
  invitations: InvitationRow[];
  isOwner: boolean;
}) {
  const queryClient = useQueryClient();
  const codeLabel = useCodeLabel();
  const { t } = useLingui();
  const revoke = useMutation(
    orpc.sharing.revokeInvitation.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.sharing.listInvitations.key() });
      },
    }),
  );
  const [confirming, setConfirming] = useState<SharingConfirmTarget | null>(null);

  return (
    <Section
      icon={Mail}
      tone="signal"
      title={
        <>
          <Trans>Invitations you've sent</Trans>{" "}
          <span className="num text-ink-3">({invitations.length})</span>
        </>
      }
    >
      {invitations.length === 0 ? (
        <EmptyState icon={Mail} title={<Trans>No pending invitations.</Trans>} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {invitations.map((invite) => (
            <li key={invite.id} className="sheet flex min-w-0 items-start gap-3 p-4">
              <SharingAvatar name={invite.email} />
              <div className="grid min-w-0 flex-1 gap-1">
                <span className="font-semibold break-all text-ink">{invite.email}</span>
                <span className="flex flex-wrap items-center gap-2 pt-0.5">
                  <StatusPill tone="neutral">
                    <span className="sr-only">{t`Role`}: </span>
                    {codeLabel(ROLE_LABELS, invite.role)}
                  </StatusPill>
                  <StatusPill tone={statusTone(invite.status)}>
                    <span className="sr-only">{t`Status`}: </span>
                    {codeLabel(INVITATION_STATUS_LABELS, invite.status)}
                  </StatusPill>
                  {isOwner ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        setConfirming({ kind: "invitation", id: invite.id, email: invite.email })
                      }
                      disabled={revoke.isPending}
                    >
                      <Trans>Revoke</Trans>
                    </Button>
                  ) : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <SharingConfirmDialog
        target={confirming}
        onCancel={() => setConfirming(null)}
        onConfirm={(target) => {
          if (target.kind === "invitation") revoke.mutate({ id: target.id });
          setConfirming(null);
        }}
      />
    </Section>
  );
}

function statusTone(status: string): StatusTone {
  if (status === "accepted") return "good";
  if (status === "pending") return "warn";
  return "neutral";
}
