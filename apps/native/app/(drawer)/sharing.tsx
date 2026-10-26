import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Spinner } from "heroui-native";
import { Mail, ShieldCheck, UserPlus, UserRound, Users } from "lucide-react-native";
import { useState } from "react";
import { Alert, RefreshControl, Text, TextInput, View } from "react-native";

import {
  EmptyState,
  ErrorState,
  ListCard,
  Page,
  PageHeader,
  Section,
  Sheet,
  StatTile,
  type StatusTone,
  TileRow,
} from "@/components/bloom";
import { Container } from "@/components/container";
import { orpc } from "@/utils/orpc";
import { sharingConfirmAlert } from "@/utils/sharing-confirm";
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

/** How an invitation's state reads as a pill: pending is still waiting, the rest are settled. */
const INVITATION_STATUS_TONES: Record<string, StatusTone> = {
  pending: "warn",
  accepted: "good",
  rejected: "neutral",
  canceled: "neutral",
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
  const ink3 = useThemeColor("ink-3");
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
      <Container>
        <Page>
          <ErrorState
            title={<Trans>Could not load sharing info.</Trans>}
            action={
              <Button
                variant="outline"
                size="sm"
                onPress={() => {
                  void members.refetch();
                  void invitations.refetch();
                  void me.refetch();
                }}
              >
                <Button.Label>
                  <Trans>Retry</Trans>
                </Button.Label>
              </Button>
            }
          />
        </Page>
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
      <Page>
        <PageHeader
          title={<Trans>Sharing</Trans>}
          description={<Trans>Role · {codeLabel(ROLE_LABELS, me.data.role)}</Trans>}
        />

        <TileRow>
          <StatTile
            icon={Users}
            tone="signal"
            label={<Trans>Members</Trans>}
            value={members.data.length}
          />
          <StatTile
            icon={Mail}
            tone="signal"
            label={<Trans>Pending invitations</Trans>}
            value={invitations.data.length}
          />
        </TileRow>

        {!isOwner ? (
          <Sheet className="flex-row items-center gap-3 p-4">
            <ShieldCheck size={18} color={ink3} />
            <Text className="flex-1 font-sans text-sm text-ink-3">
              <Trans>Only org owners can invite or remove members.</Trans>
            </Text>
          </Sheet>
        ) : (
          <InviteForm />
        )}

        <MembersCard members={members.data} isOwner={isOwner} currentUserId={me.data.userId} />
        <InvitationsCard invitations={invitations.data} isOwner={isOwner} />
      </Page>
    </Container>
  );
}

function InviteForm() {
  const [email, setEmail] = useState("");
  const { t } = useLingui();
  const placeholderColor = useThemeColor("ink-3");
  const queryClient = useQueryClient();
  const invite = useMutation(
    orpc.sharing.createInvitation.mutationOptions({
      onSuccess: () => {
        setEmail("");
        void queryClient.invalidateQueries({ queryKey: orpc.sharing.listInvitations.key() });
      },
    }),
  );

  const valid = email.includes("@");
  const submit = () => {
    if (!valid) return;
    invite.mutate({ email, role: "member" });
  };

  return (
    <Section icon={UserPlus} tone="signal" title={t`Invite a member`}>
      <Sheet className="gap-3">
        <View className="gap-2">
          <Text className="font-sans text-sm font-medium text-ink-2">
            <Trans>Email</Trans>
          </Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="name@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            className="min-h-11 rounded-xl border border-rule-2 bg-card px-3 font-sans text-base text-ink"
            placeholderTextColor={placeholderColor}
          />
        </View>
        <Button onPress={submit} isDisabled={!valid || invite.isPending}>
          <Button.Label>{invite.isPending ? t`Sending…` : t`Send`}</Button.Label>
        </Button>
        {invite.isSuccess ? (
          invite.data.emailDelivery === "sent" ? (
            <Text className="font-sans text-sm text-success" accessibilityLiveRegion="polite">
              <Trans>Invitation sent by email.</Trans>
            </Text>
          ) : invite.data.emailDelivery === "unavailable" ? (
            <Text className="font-sans text-sm text-ink-3" accessibilityLiveRegion="polite">
              <Trans>
                Invitation saved, but email is not configured on this server, so no email was sent.
                Ask them to open Sharing (or Invitations in the mobile app) to accept it.
              </Trans>
            </Text>
          ) : (
            <Text className="font-sans text-sm text-destructive" accessibilityLiveRegion="polite">
              <Trans>
                Invitation saved, but the email could not be sent. Ask them to open Sharing (or
                Invitations in the mobile app) to accept it.
              </Trans>
            </Text>
          )
        ) : invite.isError ? (
          <Text className="font-sans text-sm text-destructive">
            <Trans>Could not send invite. Email may already be pending.</Trans>
          </Text>
        ) : null}
      </Sheet>
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
  const { t, i18n } = useLingui();
  const codeLabel = useCodeLabel();
  const remove = useMutation(
    orpc.sharing.removeMember.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.sharing.listMembers.key() });
      },
    }),
  );

  return (
    <Section icon={Users} tone="signal" title={t`Members · ${members.length}`}>
      {members.length === 0 ? (
        <EmptyState icon={Users} tone="signal" title={<Trans>No members yet.</Trans>} />
      ) : (
        <View className="gap-3">
          {members.map((member) => {
            const isMe = member.userId === currentUserId;
            const display = member.name ?? member.email ?? member.userId;
            return (
              <ListCard
                key={member.id}
                icon={UserRound}
                tone="signal"
                title={
                  <Text>
                    {display}
                    {isMe ? (
                      <Text className="font-sans text-sm font-normal text-ink-3">
                        {" "}
                        <Trans>(you)</Trans>
                      </Text>
                    ) : null}
                  </Text>
                }
                subtitle={member.email ?? "—"}
                chip={codeLabel(ROLE_LABELS, member.role)}
              >
                {isOwner && !isMe ? (
                  <Button
                    variant="danger-soft"
                    size="sm"
                    className="self-start"
                    onPress={() =>
                      Alert.alert(
                        ...sharingConfirmAlert(
                          i18n,
                          { kind: "member", userId: member.userId, name: display },
                          () => remove.mutate({ userId: member.userId }),
                        ),
                      )
                    }
                    isDisabled={remove.isPending}
                  >
                    <Button.Label>
                      <Trans>Remove</Trans>
                    </Button.Label>
                  </Button>
                ) : null}
              </ListCard>
            );
          })}
        </View>
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
  const { t, i18n } = useLingui();
  const codeLabel = useCodeLabel();
  const revoke = useMutation(
    orpc.sharing.revokeInvitation.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.sharing.listInvitations.key() });
      },
    }),
  );

  return (
    <Section icon={Mail} tone="signal" title={t`Pending invitations · ${invitations.length}`}>
      {invitations.length === 0 ? (
        <EmptyState icon={Mail} tone="signal" title={<Trans>No pending invitations.</Trans>} />
      ) : (
        <View className="gap-3">
          {invitations.map((invite) => (
            <ListCard
              key={invite.id}
              icon={Mail}
              tone="signal"
              title={invite.email}
              chip={codeLabel(ROLE_LABELS, invite.role)}
              status={{
                label: codeLabel(INVITATION_STATUS_LABELS, invite.status),
                tone: INVITATION_STATUS_TONES[invite.status] ?? "neutral",
              }}
            >
              {isOwner ? (
                <Button
                  variant="danger-soft"
                  size="sm"
                  className="self-start"
                  onPress={() =>
                    Alert.alert(
                      ...sharingConfirmAlert(
                        i18n,
                        { kind: "invitation", id: invite.id, email: invite.email },
                        () => revoke.mutate({ id: invite.id }),
                      ),
                    )
                  }
                  isDisabled={revoke.isPending}
                >
                  <Button.Label>
                    <Trans>Revoke</Trans>
                  </Button.Label>
                </Button>
              ) : null}
            </ListCard>
          ))}
        </View>
      )}
    </Section>
  );
}
