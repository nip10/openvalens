import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Chip, Spinner } from "heroui-native";
import { useState } from "react";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

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

export default function SharingScreen() {
  const foreground = useThemeColor("foreground");
  const members = useQuery(orpc.sharing.listMembers.queryOptions({ input: {} }));
  const invitations = useQuery(orpc.sharing.listInvitations.queryOptions({ input: {} }));
  const me = useQuery(orpc.sharing.me.queryOptions({ input: {} }));

  const isOwner = me.data?.role === "owner";
  const codeLabel = useCodeLabel();

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
        <Text className="text-base text-foreground">
          <Trans>Could not load sharing info.</Trans>
        </Text>
        <Pressable
          onPress={() => {
            void members.refetch();
            void invitations.refetch();
            void me.refetch();
          }}
          className="min-h-11 justify-center px-4"
          accessibilityRole="button"
        >
          <Text className="font-medium text-foreground underline">
            <Trans>Retry</Trans>
          </Text>
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
          <Text className="text-sm text-muted-foreground">
            <Trans>Sharing</Trans>
          </Text>
          <Text className="font-mono text-3xl text-foreground">
            <Trans>Role · {codeLabel(ROLE_LABELS, me.data.role)}</Trans>
          </Text>
        </View>

        {!isOwner ? (
          <Text className="text-sm text-muted-foreground">
            <Trans>Only org owners can invite or remove members.</Trans>
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
  const { t } = useLingui();
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
    <CardStack title={t`Invite a member`}>
      <Card variant="secondary" className="gap-3 p-4">
        <View className="flex-row items-end gap-3">
          <View className="flex-1 gap-2">
            <Text className="text-sm font-medium text-foreground">
              <Trans>Email</Trans>
            </Text>
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
            {invite.isPending ? t`Sending…` : t`Send`}
          </Button>
        </View>
        {invite.isSuccess ? (
          <Text className="text-sm text-success">
            <Trans>Invitation saved.</Trans>
          </Text>
        ) : invite.isError ? (
          <Text className="text-sm text-destructive">
            <Trans>Could not send invite. Email may already be pending.</Trans>
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
  const { t } = useLingui();
  const codeLabel = useCodeLabel();
  const remove = useMutation(
    orpc.sharing.removeMember.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ["sharing", "listMembers"] });
      },
    }),
  );

  return (
    <CardStack title={t`Members · ${members.length}`}>
      <Card variant="secondary" className="p-0">
        {members.length === 0 ? (
          <Text className="py-6 text-center text-sm text-muted-foreground">
            <Trans>No members yet.</Trans>
          </Text>
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
                    {isMe ? (
                      <Text className="text-xs text-muted-foreground">
                        {" "}
                        <Trans>(you)</Trans>
                      </Text>
                    ) : null}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {member.email ?? "—"} · {codeLabel(ROLE_LABELS, member.role)}
                  </Text>
                </View>
                {isOwner && !isMe ? (
                  <Button
                    variant="outline"
                    onPress={() => remove.mutate({ userId: member.userId })}
                    isDisabled={remove.isPending}
                  >
                    <Trans>Remove</Trans>
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
  const { t } = useLingui();
  const codeLabel = useCodeLabel();
  const revoke = useMutation(
    orpc.sharing.revokeInvitation.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ["sharing", "listInvitations"] });
      },
    }),
  );

  return (
    <CardStack title={t`Pending invitations · ${invitations.length}`}>
      <Card variant="secondary" className="p-0">
        {invitations.length === 0 ? (
          <Text className="py-6 text-center text-sm text-muted-foreground">
            <Trans>No pending invitations.</Trans>
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
                    <Chip.Label>{codeLabel(ROLE_LABELS, invite.role)}</Chip.Label>
                  </Chip>
                  <Text className="text-xs text-muted-foreground">
                    {codeLabel(INVITATION_STATUS_LABELS, invite.status)}
                  </Text>
                </View>
              </View>
              {isOwner ? (
                <Button
                  variant="outline"
                  onPress={() => revoke.mutate({ id: invite.id })}
                  isDisabled={revoke.isPending}
                >
                  <Trans>Revoke</Trans>
                </Button>
              ) : null}
            </View>
          ))
        )}
      </Card>
    </CardStack>
  );
}
