import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

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
  const members = useQuery(orpc.sharing.listMembers.queryOptions({ input: {} }));
  const invitations = useQuery(orpc.sharing.listInvitations.queryOptions({ input: {} }));
  const me = useQuery(orpc.sharing.me.queryOptions({ input: {} }));
  const isOwner = me.data?.role === "owner";
  const codeLabel = useCodeLabel();

  if (members.isPending || invitations.isPending || me.isPending) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">
          <Trans>Sharing</Trans>
        </h1>
        <Skeleton className="h-32 w-full" />
      </div>
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
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">
          <Trans>Sharing</Trans>
        </h1>
        <p className="text-sm text-muted-foreground">
          <Trans>Could not load sharing info.</Trans>{" "}
          <button
            className="underline"
            onClick={() => {
              void members.refetch();
              void invitations.refetch();
              void me.refetch();
            }}
          >
            <Trans>Retry</Trans>
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">
          <Trans>Sharing</Trans>
        </h1>
        <p className="text-sm text-muted-foreground">
          <Trans>
            Your role: <span className="font-mono">{codeLabel(ROLE_LABELS, me.data.role)}</span>
          </Trans>
        </p>
      </div>

      {!isOwner ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Only org owners can invite or remove members.</Trans>
        </p>
      ) : (
        <InviteForm />
      )}

      <MembersCard members={members.data} isOwner={isOwner} currentUserId={me.data.userId} />
      <InvitationsCard invitations={invitations.data} isOwner={isOwner} />
    </div>
  );
}

function InviteForm() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "member">("member");
  const { t, i18n } = useLingui();
  const invite = useMutation(
    orpc.sharing.createInvitation.mutationOptions({
      onSuccess: () => {
        setEmail("");
        setRole("member");
      },
    }),
  );

  const valid = email.includes("@");
  const submit = () => {
    if (!valid) return;
    invite.mutate({ email, role });
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>
          <Trans>Invite a member</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
        <div className="grid gap-2">
          <Label className="text-sm font-medium">
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
          <Label className="text-sm font-medium">
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
        <div className="flex items-end">
          <Button onClick={submit} disabled={!valid || invite.isPending} className="min-h-11">
            {invite.isPending ? t`Inviting…` : t`Send invite`}
          </Button>
        </div>
        {invite.isSuccess ? (
          <p className="text-sm text-success sm:col-span-3">
            <Trans>Invitation saved.</Trans>
          </p>
        ) : invite.isError ? (
          <p className="text-sm text-destructive sm:col-span-3">
            <Trans>Could not send invite. Email may already be pending.</Trans>
          </p>
        ) : null}
      </CardContent>
    </Card>
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
    <Card className="mb-6 py-0">
      <CardHeader className="border-b border-border">
        <CardTitle>
          <Trans>Members · {members.length}</Trans>
        </CardTitle>
      </CardHeader>
      {members.length === 0 ? (
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          <Trans>No members yet.</Trans>
        </CardContent>
      ) : (
        <ul className="divide-y divide-border">
          {members.map((member) => {
            const isMe = member.userId === currentUserId;
            return (
              <li key={member.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <div className="font-medium">
                    {member.name ?? member.email ?? member.userId}
                    {isMe ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        <Trans>(you)</Trans>
                      </span>
                    ) : null}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {member.email ?? "—"} · {codeLabel(ROLE_LABELS, member.role)}
                  </div>
                </div>
                {isOwner && !isMe ? (
                  <Button
                    variant="outline"
                    onClick={() => remove.mutate({ userId: member.userId })}
                    disabled={remove.isPending}
                  >
                    <Trans>Remove</Trans>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
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
    <Card className="py-0">
      <CardHeader className="border-b border-border">
        <CardTitle>
          <Trans>Pending invitations · {invitations.length}</Trans>
        </CardTitle>
      </CardHeader>
      {invitations.length === 0 ? (
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          <Trans>No pending invitations.</Trans>
        </CardContent>
      ) : (
        <ul className="divide-y divide-border">
          {invitations.map((invite) => (
            <li key={invite.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="font-medium">{invite.email}</div>
                <div className="text-sm text-muted-foreground">
                  <Trans>
                    {codeLabel(ROLE_LABELS, invite.role)} · status:{" "}
                    {codeLabel(INVITATION_STATUS_LABELS, invite.status)}
                  </Trans>
                </div>
              </div>
              {isOwner ? (
                <Button
                  variant="outline"
                  onClick={() => revoke.mutate({ id: invite.id })}
                  disabled={revoke.isPending}
                >
                  <Trans>Revoke</Trans>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
