import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openvalens/ui/components/select";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openvalens/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { MyInvitationsCard } from "@/components/my-invitations-card";
import { EmptyState, ErrorState, Page, PageHeader, Section } from "@/components/page";
import { authClient } from "@/lib/auth-client";
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
  const codeLabel = useCodeLabel();

  if (members.isPending || invitations.isPending || me.isPending) {
    return (
      <Page>
        <PageHeader title={<Trans>Sharing</Trans>} />
        {myInvitations}
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="grid gap-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-40 w-full" />
          </div>
          <Skeleton className="h-48 w-full" />
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
        <PageHeader title={<Trans>Sharing</Trans>} />
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
      <PageHeader
        title={<Trans>Sharing</Trans>}
        description={
          <Trans>
            Your role:{" "}
            <span className="font-medium text-ink">{codeLabel(ROLE_LABELS, me.data.role)}</span>
          </Trans>
        }
      />

      {myInvitations}

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="grid min-w-0 gap-10">
          <MembersCard members={members.data} isOwner={isOwner} currentUserId={me.data.userId} />
          <InvitationsCard invitations={invitations.data} isOwner={isOwner} />
        </div>
        {!isOwner ? (
          <p className="well px-5 py-4 text-sm text-ink-3">
            <Trans>Only org owners can invite or remove members.</Trans>
          </p>
        ) : (
          <InviteForm />
        )}
      </div>
    </Page>
  );
}

function InviteForm() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "member">("member");
  const { t, i18n } = useLingui();
  const queryClient = useQueryClient();
  const invite = useMutation(
    orpc.sharing.createInvitation.mutationOptions({
      onSuccess: () => {
        setEmail("");
        setRole("member");
        void queryClient.invalidateQueries({ queryKey: orpc.sharing.listInvitations.key() });
      },
    }),
  );

  const valid = email.includes("@");
  const submit = () => {
    if (!valid) return;
    invite.mutate({ email, role });
  };

  return (
    <Section title={<Trans>Invite a member</Trans>} sheet>
      <div className="grid gap-4 py-1">
        <div className="grid gap-2">
          <Label className="text-sm font-medium text-ink-3">
            <Trans>Email</Trans>
          </Label>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
          />
        </div>
        <div className="grid gap-2">
          <Label className="text-sm font-medium text-ink-3">
            <Trans>Role</Trans>
          </Label>
          <Select value={role} onValueChange={(next) => setRole(next as "owner" | "member")}>
            <SelectTrigger>
              <SelectValue>{i18n._(ROLE_LABELS[role]!)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">{i18n._(ROLE_LABELS.member!)}</SelectItem>
              <SelectItem value="owner">{i18n._(ROLE_LABELS.owner!)}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="border-t border-rule pt-4">
          <Button
            onClick={submit}
            disabled={!valid || invite.isPending}
            className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {invite.isPending ? t`Inviting…` : t`Send invite`}
          </Button>
        </div>
        {invite.isSuccess ? (
          invite.data.emailDelivery === "sent" ? (
            <p className="text-sm text-success" role="status">
              <Trans>Invitation sent by email.</Trans>
            </p>
          ) : invite.data.emailDelivery === "unavailable" ? (
            <p className="text-sm text-ink-3" role="status">
              <Trans>
                Invitation saved, but email is not configured on this server, so no email was sent.
                Ask them to open Sharing (or Invitations in the mobile app) to accept it.
              </Trans>
            </p>
          ) : (
            <p className="text-sm text-destructive" role="status">
              <Trans>
                Invitation saved, but the email could not be sent. Ask them to open Sharing (or
                Invitations in the mobile app) to accept it.
              </Trans>
            </p>
          )
        ) : invite.isError ? (
          <p className="text-sm text-destructive">
            <Trans>Could not send invite. Email may already be pending.</Trans>
          </p>
        ) : null}
      </div>
    </Section>
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
  const remove = useMutation(
    orpc.sharing.removeMember.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.sharing.listMembers.key() });
      },
    }),
  );

  return (
    <Section
      title={
        <>
          <Trans>Members</Trans> <span className="num text-ink-3">({members.length})</span>
        </>
      }
    >
      {members.length === 0 ? (
        <EmptyState title={<Trans>No members yet.</Trans>} />
      ) : (
        <div className="sheet">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">
                  <Trans>Name</Trans>
                </TableHead>
                <TableHead>
                  <Trans>Email</Trans>
                </TableHead>
                <TableHead>
                  <Trans>Role</Trans>
                </TableHead>
                <TableHead className="pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => {
                const isMe = member.userId === currentUserId;
                return (
                  <TableRow key={member.id}>
                    <TableCell className="py-3 pl-5 font-medium text-ink">
                      {member.name ?? member.email ?? member.userId}
                      {isMe ? (
                        <span className="ml-2 font-normal text-ink-3">
                          <Trans>(you)</Trans>
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="py-3 text-ink-3">{member.email ?? "—"}</TableCell>
                    <TableCell className="py-3">{codeLabel(ROLE_LABELS, member.role)}</TableCell>
                    <TableCell className="py-3 pr-5 text-right">
                      {isOwner && !isMe ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => remove.mutate({ userId: member.userId })}
                          disabled={remove.isPending}
                        >
                          <Trans>Remove</Trans>
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
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
  const revoke = useMutation(
    orpc.sharing.revokeInvitation.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.sharing.listInvitations.key() });
      },
    }),
  );

  return (
    <Section
      title={
        <>
          <Trans>Pending invitations</Trans>{" "}
          <span className="num text-ink-3">({invitations.length})</span>
        </>
      }
    >
      {invitations.length === 0 ? (
        <EmptyState title={<Trans>No pending invitations.</Trans>} />
      ) : (
        <div className="sheet">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">
                  <Trans>Email</Trans>
                </TableHead>
                <TableHead>
                  <Trans>Role</Trans>
                </TableHead>
                <TableHead>
                  <Trans>Status</Trans>
                </TableHead>
                <TableHead className="pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((invite) => (
                <TableRow key={invite.id}>
                  <TableCell className="py-3 pl-5 font-medium text-ink">{invite.email}</TableCell>
                  <TableCell className="py-3">{codeLabel(ROLE_LABELS, invite.role)}</TableCell>
                  <TableCell className="py-3">
                    {codeLabel(INVITATION_STATUS_LABELS, invite.status)}
                  </TableCell>
                  <TableCell className="py-3 pr-5 text-right">
                    {isOwner ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => revoke.mutate({ id: invite.id })}
                        disabled={revoke.isPending}
                      >
                        <Trans>Revoke</Trans>
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Section>
  );
}
