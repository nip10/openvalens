import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Chip, Spinner } from "heroui-native";
import { useState } from "react";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

export default function SharingScreen() {
  const foreground = useThemeColor("foreground");
  const members = useQuery(orpc.sharing.listMembers.queryOptions({ input: {} }));
  const invitations = useQuery(orpc.sharing.listInvitations.queryOptions({ input: {} }));
  const me = useQuery(orpc.sharing.me.queryOptions({ input: {} }));

  const isOwner = me.data?.role === "owner";

  if (members.isPending || invitations.isPending || me.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );

  if (
    members.isError ||
    invitations.isError ||
    me.isError ||
    !members.data ||
    !invitations.data ||
    !me.data
  )
    return (
      <Container className="items-center justify-center gap-3 p-6" isScrollable={false}>
        <Text className="text-base text-foreground">Could not load sharing info.</Text>
        <Pressable
          onPress={() => {
            void members.refetch();
            void invitations.refetch();
            void me.refetch();
          }}
          className="min-h-11 justify-center px-4"
          accessibilityRole="button"
        >
          <Text className="font-medium text-foreground underline">Retry</Text>
        </Pressable>
      </Container>
    );

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={members.isRefetching || invitations.isRefetching}
            onRefresh={() => {
              void members.refetch();
              void invitations.refetch();
              void me.refetch();
            }}
            tintColor={foreground}
          />
        ),
      }}
    >
      <View className="gap-4 p-4">
        <View>
          <Text className="text-sm text-muted-foreground">Sharing</Text>
          <Text className="font-mono text-3xl text-foreground">Role · {me.data.role}</Text>
        </View>

        {!isOwner ? (
          <Text className="text-sm text-muted-foreground">
            Only org owners can invite or remove members.
          </Text>
        ) : (
          <InviteForm />
        )}

        <MembersCard members={members.data} isOwner={isOwner} currentUserId={me.data.userId} />
        <InvitationsCard invitations={invitations.data} isOwner={isOwner} />
      </View>
    </Container>
  );
}

function InviteForm() {
  const [email, setEmail] = useState("");
  const invite = useMutation(
    orpc.sharing.createInvitation.mutationOptions({
      onSuccess: () => setEmail(""),
    }),
  );

  const valid = email.includes("@");
  const submit = () => {
    if (!valid) return;
    invite.mutate({ email, role: "member" });
  };

  return (
    <CardStack title="Invite a member">
      <Card variant="secondary" className="gap-3 p-4">
        <View className="flex-row items-end gap-3">
          <View className="flex-1 gap-2">
            <Text className="text-sm font-medium text-foreground">Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="name@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              className="min-h-11 rounded-lg border border-border bg-card px-3 text-base text-foreground"
              placeholderTextColor="#9ca3af"
            />
          </View>
          <Button onPress={submit} isDisabled={!valid || invite.isPending}>
            {invite.isPending ? "Sending…" : "Send"}
          </Button>
        </View>
        {invite.isSuccess ? (
          <Text className="text-sm text-success">Invitation saved.</Text>
        ) : invite.isError ? (
          <Text className="text-sm text-destructive">
            Could not send invite. Email may already be pending.
          </Text>
        ) : null}
      </Card>
    </CardStack>
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
    <CardStack title={`Members · ${members.length}`}>
      <Card variant="secondary" className="p-0">
        {members.length === 0 ? (
          <Text className="py-6 text-center text-sm text-muted-foreground">No members yet.</Text>
        ) : (
          members.map((member, index) => {
            const isMe = member.userId === currentUserId;
            return (
              <View
                key={member.id}
                className={`flex-row items-center justify-between px-4 py-3 ${
                  index < members.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <View className="min-w-0 flex-1">
                  <Text className="text-base text-foreground">
                    {member.name ?? member.email ?? member.userId}
                    {isMe ? <Text className="text-xs text-muted-foreground"> (you)</Text> : null}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {member.email ?? "—"} · {member.role}
                  </Text>
                </View>
                {isOwner && !isMe ? (
                  <Button
                    variant="outline"
                    onPress={() => remove.mutate({ userId: member.userId })}
                    isDisabled={remove.isPending}
                  >
                    Remove
                  </Button>
                ) : null}
              </View>
            );
          })
        )}
      </Card>
    </CardStack>
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
    <CardStack title={`Pending invitations · ${invitations.length}`}>
      <Card variant="secondary" className="p-0">
        {invitations.length === 0 ? (
          <Text className="py-6 text-center text-sm text-muted-foreground">
            No pending invitations.
          </Text>
        ) : (
          invitations.map((invite, index) => (
            <View
              key={invite.id}
              className={`flex-row items-center justify-between gap-3 px-4 py-3 ${
                index < invitations.length - 1 ? "border-b border-border" : ""
              }`}
            >
              <View className="min-w-0 flex-1">
                <Text className="text-base text-foreground">{invite.email}</Text>
                <View className="mt-1 flex-row items-center gap-2">
                  <Chip size="sm" variant="secondary">
                    <Chip.Label>{invite.role}</Chip.Label>
                  </Chip>
                  <Text className="text-xs text-muted-foreground">{invite.status}</Text>
                </View>
              </View>
              {isOwner ? (
                <Button
                  variant="outline"
                  onPress={() => revoke.mutate({ id: invite.id })}
                  isDisabled={revoke.isPending}
                >
                  Revoke
                </Button>
              ) : null}
            </View>
          ))
        )}
      </Card>
    </CardStack>
  );
}
