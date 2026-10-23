import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Chip, Spinner } from "heroui-native";
import { useState } from "react";
import { Pressable, RefreshControl, Text, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { SignIn } from "@/components/sign-in";
import { authClient } from "@/lib/auth-client";
import { useThemeColor } from "@/utils/theme";
import {
  acceptWorkspaceInvitation,
  declineWorkspaceInvitation,
  invitationState,
  listMyInvitations,
  WorkspaceInvitationError,
  type WorkspaceInvitation,
  type WorkspaceInvitationClient,
} from "@/utils/workspace-invitation";

/**
 * Issue #133 — native workspace invitation acceptance.
 *
 * The signed-in recipient sees the invitations addressed to their own account
 * and can accept or decline each one. Accepting activates the joined workspace
 * (the SDK sets it on the session) and the app refreshes its queries. There is
 * no account creation and no bearer or deep link: an invitation only ever
 * targets an existing account, and the recipient comes from the live session.
 */
const invitationClient: WorkspaceInvitationClient = {
  getSession: () => authClient.getSession(),
  organization: {
    listUserInvitations: (input) => authClient.organization.listUserInvitations(input),
    acceptInvitation: (input) => authClient.organization.acceptInvitation(input),
    rejectInvitation: (input) => authClient.organization.rejectInvitation(input),
  },
};

const ROLE_LABELS: Record<string, MessageDescriptor> = {
  owner: msg`owner`,
  admin: msg`admin`,
  member: msg`member`,
};

const ACTION_FAILED = msg`Could not complete that action. Please try again.`;

export default function InvitationsScreen() {
  const queryClient = useQueryClient();
  const foreground = useThemeColor("foreground");
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const email = session?.user?.email?.toLowerCase() ?? null;
  const [message, setMessage] = useState<string | null>(null);
  const { t, i18n } = useLingui();
  const errorMessage = (error: unknown): string =>
    error instanceof WorkspaceInvitationError ? i18n._(error.userMessage) : i18n._(ACTION_FAILED);

  const invitations = useQuery({
    queryKey: ["invitations", "mine", email],
    enabled: !!email,
    queryFn: () => listMyInvitations(invitationClient),
  });

  const refresh = () => {
    setMessage(null);
    void invitations.refetch();
  };

  const accept = useMutation({
    mutationFn: (invitationId: string) => acceptWorkspaceInvitation(invitationClient, invitationId),
    onSuccess: () => {
      setMessage(t`Invitation accepted. The workspace is now active.`);
      void queryClient.invalidateQueries();
    },
    onError: (error) => setMessage(errorMessage(error)),
  });

  const decline = useMutation({
    mutationFn: (invitationId: string) =>
      declineWorkspaceInvitation(invitationClient, invitationId),
    onSuccess: () => {
      setMessage(t`Invitation declined.`);
      void queryClient.invalidateQueries();
    },
    onError: (error) => setMessage(errorMessage(error)),
  });

  if (sessionPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );

  if (!email) {
    return (
      <Container className="gap-4 p-4">
        <Text className="text-sm text-muted-foreground">
          <Trans>Sign in to see and accept workspace invitations.</Trans>
        </Text>
        <SignIn />
      </Container>
    );
  }

  const busy = accept.isPending || decline.isPending;

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={invitations.isRefetching}
            onRefresh={refresh}
            tintColor={foreground}
          />
        ),
      }}
    >
      <View className="gap-4 p-4">
        <View>
          <Text className="text-sm text-muted-foreground">
            <Trans>Workspace</Trans>
          </Text>
          <Text className="font-mono text-3xl text-foreground">
            <Trans>Invitations</Trans>
          </Text>
        </View>

        {message ? (
          <Text className="text-sm text-foreground" accessibilityLiveRegion="polite">
            {message}
          </Text>
        ) : null}

        {invitations.isPending ? (
          <Spinner />
        ) : invitations.isError ? (
          <Card variant="secondary" className="gap-3 p-4">
            <Text className="text-base text-foreground">
              <Trans>Could not load invitations.</Trans>
            </Text>
            <Pressable
              onPress={refresh}
              className="min-h-11 justify-center active:opacity-70"
              accessibilityRole="button"
            >
              <Text className="font-medium text-foreground underline">
                <Trans>Retry</Trans>
              </Text>
            </Pressable>
          </Card>
        ) : invitations.data.length === 0 ? (
          <CardStack title={t`Pending invitations`}>
            <Card variant="secondary" className="p-4">
              <Text className="text-sm text-muted-foreground">
                <Trans>You have no pending workspace invitations.</Trans>
              </Text>
            </Card>
          </CardStack>
        ) : (
          <CardStack title={t`Pending invitations · ${invitations.data.length}`}>
            {invitations.data.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                sessionEmail={email}
                busy={busy}
                accepting={accept.isPending && accept.variables === invitation.id}
                declining={decline.isPending && decline.variables === invitation.id}
                onAccept={() => {
                  setMessage(null);
                  accept.mutate(invitation.id);
                }}
                onDecline={() => {
                  setMessage(null);
                  decline.mutate(invitation.id);
                }}
              />
            ))}
          </CardStack>
        )}
      </View>
    </Container>
  );
}

function InvitationRow({
  invitation,
  sessionEmail,
  busy,
  accepting,
  declining,
  onAccept,
  onDecline,
}: {
  invitation: WorkspaceInvitation;
  sessionEmail: string;
  busy: boolean;
  accepting: boolean;
  declining: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const state = invitationState(invitation, { sessionEmail, now: Date.now() });
  const { t, i18n } = useLingui();
  const roleLabel = ROLE_LABELS[invitation.role];

  return (
    <Card variant="secondary" className="gap-3 p-4">
      <View className="gap-1">
        <Text className="text-base text-foreground">
          {invitation.organizationName ?? t`A workspace`}
        </Text>
        <View className="flex-row items-center gap-2">
          <Chip size="sm" variant="secondary">
            <Chip.Label>{roleLabel ? i18n._(roleLabel) : invitation.role}</Chip.Label>
          </Chip>
          <Text className="text-xs text-muted-foreground break-words">
            <Trans>Invited email: {invitation.email}</Trans>
          </Text>
        </View>
      </View>

      {state === "pending" ? (
        <View className="flex-row gap-2">
          <Button className="flex-1" onPress={onAccept} isDisabled={busy}>
            {accepting ? t`Accepting…` : t`Accept`}
          </Button>
          <Button className="flex-1" variant="outline" onPress={onDecline} isDisabled={busy}>
            {declining ? t`Declining…` : t`Decline`}
          </Button>
        </View>
      ) : (
        <Text className="text-sm text-muted-foreground">
          {state === "expired"
            ? t`This invitation has expired.`
            : state === "wrong_account"
              ? t`This invitation was sent to a different email address.`
              : t`This invitation is no longer pending.`}
        </Text>
      )}
    </Card>
  );
}
