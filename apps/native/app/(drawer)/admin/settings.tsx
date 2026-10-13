import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { Card, Chip } from "heroui-native";
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { authClient } from "@/lib/auth-client";
import { isConfigPermissionDenied } from "@/utils/admin-settings-error";
import { adminAccessQueryOptions, adminConfigurationQueryOptions } from "@/utils/admin-settings";
import { deriveAdminSettingsState } from "@/utils/admin-settings-state";
import type { AdminConfigurationEntry } from "@/utils/admin-settings-keys";

export default function AdminSettingsScreen() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const userId = session?.user?.id;
  const hasUserId = !!userId;

  const access = useQuery({
    ...adminAccessQueryOptions(userId ?? ""),
    enabled: hasUserId,
  });

  const accessVerified =
    hasUserId &&
    !access.isPending &&
    !access.isFetching &&
    !access.isError &&
    access.data?.isInstanceAdmin === true;

  const config = useQuery({
    ...adminConfigurationQueryOptions(userId ?? ""),
    enabled: accessVerified,
  });

  // Expo Drawer keeps screens mounted; staleTime alone does not refetch on
  // focus. Re-verify access on focus, then refetch configuration only if the
  // fresh access check still grants admin rights.
  useFocusEffect(
    useCallback(() => {
      if (!hasUserId) return;
      void access.refetch().then((result) => {
        if (result.data?.isInstanceAdmin === true) {
          void config.refetch();
        }
      });
    }, [access.refetch, config.refetch, hasUserId]),
  );

  const configPermissionDenied = config.isError && isConfigPermissionDenied(config.error);

  const state = deriveAdminSettingsState(
    sessionPending,
    hasUserId,
    access,
    config,
    configPermissionDenied,
  );

  return (
    <Container className="p-4">
      <View className="gap-6">
        <View className="gap-1">
          <Text className="text-2xl font-semibold text-foreground">Instance configuration</Text>
          <Text className="text-sm text-muted-foreground">Administration</Text>
        </View>

        {state === "loading" || state === "config-loading" ? (
          <LoadingCard />
        ) : state === "access-error" ? (
          <MessageCard
            title="Could not verify access"
            message="Could not verify admin access."
            actionLabel="Retry"
            onAction={() => void access.refetch()}
          />
        ) : state === "denied" ? (
          <MessageCard
            title="Access denied"
            message="You do not have access to instance administration."
          />
        ) : state === "config-error" ? (
          <MessageCard
            title="Could not load configuration"
            message="Could not load instance configuration."
            actionLabel="Retry"
            onAction={() => void config.refetch()}
          />
        ) : state === "ready" ? (
          <ConfigurationList entries={config.data?.entries ?? []} />
        ) : null}
      </View>
    </Container>
  );
}

function ConfigurationList({ entries }: { entries: AdminConfigurationEntry[] }) {
  return (
    <CardStack title="Environment configuration">
      <Text className="text-sm text-muted-foreground">
        Startup configuration is read-only. Values are hidden for security, even for non-sensitive
        keys.
      </Text>

      {entries.length === 0 ? (
        <Text className="text-sm text-muted-foreground">No configuration keys reported.</Text>
      ) : (
        <View className="gap-2">
          {entries.map((entry) => (
            <ConfigurationRow key={entry.key} entry={entry} />
          ))}
        </View>
      )}
    </CardStack>
  );
}

function ConfigurationRow({ entry }: { entry: AdminConfigurationEntry }) {
  return (
    <View className="flex-row flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
      <Text className="flex-1 break-words text-sm font-medium text-foreground">{entry.key}</Text>
      <View className="flex-row flex-wrap gap-2">
        <Chip size="sm" variant={entry.configured ? "primary" : "secondary"}>
          <Chip.Label>{entry.configured ? "Configured" : "Not set"}</Chip.Label>
        </Chip>
        {entry.sensitive ? (
          <Chip size="sm" variant="tertiary">
            <Chip.Label>Sensitive</Chip.Label>
          </Chip>
        ) : null}
      </View>
    </View>
  );
}

function LoadingCard() {
  return (
    <CardStack title="Environment configuration">
      <Card variant="secondary" className="gap-3 p-4">
        <View className="h-4 w-full rounded-md bg-muted" />
        <View className="h-14 w-full rounded-md bg-muted" />
        <View className="h-14 w-full rounded-md bg-muted" />
        <View className="h-14 w-full rounded-md bg-muted" />
      </Card>
    </CardStack>
  );
}

function MessageCard({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <CardStack title={title}>
      <Card variant="secondary" className="gap-3 p-4">
        <Text className="text-sm text-muted-foreground">{message}</Text>
        {actionLabel && onAction ? (
          <Pressable
            onPress={onAction}
            className="self-start rounded-lg bg-primary px-4 py-2 active:opacity-70"
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
          >
            <Text className="font-medium text-primary-foreground">{actionLabel}</Text>
          </Pressable>
        ) : null}
      </Card>
    </CardStack>
  );
}
