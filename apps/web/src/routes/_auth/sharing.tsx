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

function SharingPage() {
  const members = useQuery(orpc.sharing.listMembers.queryOptions({ input: {} }));
  const invitations = useQuery(orpc.sharing.listInvitations.queryOptions({ input: {} }));
  const me = useQuery(orpc.sharing.me.queryOptions({ input: {} }));
  const isOwner = me.data?.role === "owner";

  if (members.isPending || invitations.isPending || me.isPending) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Sharing</h1>
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
        <h1 className="mb-6 text-2xl font-semibold">Sharing</h1>
        <p className="text-sm text-muted-foreground">
          Could not load sharing info.{" "}
          <button
            className="underline"
            onClick={() => {
              void members.refetch();
              void invitations.refetch();
              void me.refetch();
            }}
          >
            Retry
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Sharing</h1>
        <p className="text-sm text-muted-foreground">
          Your role: <span className="font-mono">{me.data.role}</span>
        </p>
      </div>

      {!isOwner ? (
        <p className="text-sm text-muted-foreground">
          Only org owners can invite or remove members.
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
        <CardTitle>Invite a member</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
        <div className="grid gap-2">
          <Label className="text-sm font-medium">Email</Label>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
          />
        </div>
        <div className="grid gap-2">
          <Label className="text-sm font-medium">Role</Label>
          <Select value={role} onValueChange={(next) => setRole(next as "owner" | "member")}>
            <SelectTrigger>
              <SelectValue>{role}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">member</SelectItem>
              <SelectItem value="owner">owner</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button onClick={submit} disabled={!valid || invite.isPending} className="min-h-11">
            {invite.isPending ? "Inviting…" : "Send invite"}
          </Button>
        </div>
        {invite.isSuccess ? (
          <p className="text-sm text-success sm:col-span-3">Invitation saved.</p>
        ) : invite.isError ? (
          <p className="text-sm text-destructive sm:col-span-3">
            Could not send invite. Email may already be pending.
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
  const remove = useMutation(
    orpc.sharing.removeMember.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ["sharing", "listMembers"] });
      },
    }),
  );

  return (
    <Card className="mb-6 py-0">
      <CardHeader className="border-b border-border">
        <CardTitle>Members · {members.length}</CardTitle>
      </CardHeader>
      {members.length === 0 ? (
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No members yet.
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
                      <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                    ) : null}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {member.email ?? "—"} · {member.role}
                  </div>
                </div>
                {isOwner && !isMe ? (
                  <Button
                    variant="outline"
                    onClick={() => remove.mutate({ userId: member.userId })}
                    disabled={remove.isPending}
                  >
                    Remove
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
  const revoke = useMutation(
    orpc.sharing.revokeInvitation.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ["sharing", "listInvitations"] });
      },
    }),
  );

  return (
    <Card className="py-0">
      <CardHeader className="border-b border-border">
        <CardTitle>Pending invitations · {invitations.length}</CardTitle>
      </CardHeader>
      {invitations.length === 0 ? (
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No pending invitations.
        </CardContent>
      ) : (
        <ul className="divide-y divide-border">
          {invitations.map((invite) => (
            <li key={invite.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="font-medium">{invite.email}</div>
                <div className="text-sm text-muted-foreground">
                  {invite.role} · status: {invite.status}
                </div>
              </div>
              {isOwner ? (
                <Button
                  variant="outline"
                  onClick={() => revoke.mutate({ id: invite.id })}
                  disabled={revoke.isPending}
                >
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
