import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { Button, cn } from "heroui-native";
import { Settings2, ShieldX } from "lucide-react-native";
import { useCallback } from "react";
import { Text, View } from "react-native";

import {
  Details,
  EmptyState,
  ErrorState,
  Figure,
  Page,
  PageHeader,
  Section,
  Sheet,
  StatusPill,
} from "@/components/bloom";
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
  const { t } = useLingui();

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
    <Container>
      <Page>
        <PageHeader
          eyebrow={<Trans>Administration</Trans>}
          title={<Trans>Instance configuration</Trans>}
        />

        {state === "loading" || state === "config-loading" ? (
          <LoadingCard />
        ) : state === "access-error" ? (
          <MessageCard
            title={t`Could not verify access`}
            message={t`Could not verify admin access.`}
            actionLabel={t`Retry`}
            onAction={() => void access.refetch()}
          />
        ) : state === "denied" ? (
          <EmptyState
            icon={ShieldX}
            title={t`Access denied`}
            description={t`You do not have access to instance administration.`}
          />
        ) : state === "config-error" ? (
          <MessageCard
            title={t`Could not load configuration`}
            message={t`Could not load instance configuration.`}
            actionLabel={t`Retry`}
            onAction={() => void config.refetch()}
          />
        ) : state === "ready" ? (
          <ConfigurationList entries={config.data?.entries ?? []} />
        ) : null}
      </Page>
    </Container>
  );
}

function ConfigurationList({ entries }: { entries: AdminConfigurationEntry[] }) {
  const { t } = useLingui();
  const configured = entries.filter((entry) => entry.configured).length;
  const sensitive = entries.filter((entry) => entry.sensitive).length;
  return (
    <Section
      title={t`Environment configuration`}
      icon={Settings2}
      tone="signal"
      info={
        <Trans>
          Startup configuration is read-only. Values are hidden for security, even for non-sensitive
          keys.
        </Trans>
      }
    >
      {entries.length === 0 ? (
        <EmptyState icon={Settings2} title={<Trans>No configuration keys reported.</Trans>} />
      ) : (
        <Sheet className="gap-4">
          <View className="flex-row">
            <Figure className="flex-1 pr-3" label={<Trans>Keys</Trans>} value={entries.length} />
            <Figure
              className="flex-1 border-l border-rule px-3"
              label={<Trans>Configured</Trans>}
              value={configured}
            />
            <Figure
              className="flex-1 border-l border-rule pl-3"
              label={<Trans>Sensitive</Trans>}
              value={sensitive}
            />
          </View>
          <Details summary={<Trans>All keys</Trans>}>
            <View>
              {entries.map((entry, index) => (
                <ConfigurationRow key={entry.key} entry={entry} divider={index > 0} />
              ))}
            </View>
          </Details>
        </Sheet>
      )}
    </Section>
  );
}

function ConfigurationRow({
  entry,
  divider,
}: {
  entry: AdminConfigurationEntry;
  divider: boolean;
}) {
  const { t } = useLingui();
  return (
    <View
      className={cn(
        "flex-row flex-wrap items-center justify-between gap-2 py-3",
        divider && "border-t border-rule",
      )}
    >
      <Text className="min-w-0 flex-1 font-sans text-sm font-medium text-ink" selectable>
        {entry.key}
      </Text>
      <View className="flex-row flex-wrap gap-1.5">
        <StatusPill tone={entry.configured ? "good" : "neutral"}>
          {entry.configured ? t`Configured` : t`Not set`}
        </StatusPill>
        {entry.sensitive ? (
          <StatusPill tone="warn">
            <Trans>Sensitive</Trans>
          </StatusPill>
        ) : null}
      </View>
    </View>
  );
}

function LoadingCard() {
  const { t } = useLingui();
  return (
    <Section title={t`Environment configuration`} icon={Settings2} tone="signal">
      <Sheet className="gap-3">
        <View className="h-4 w-2/3 rounded-md bg-paper-2" />
        <View className="h-8 w-full rounded-md bg-paper-2" />
        <View className="h-8 w-full rounded-md bg-paper-2" />
        <View className="h-8 w-full rounded-md bg-paper-2" />
      </Sheet>
    </Section>
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
    <ErrorState
      title={title}
      description={message}
      action={
        actionLabel && onAction ? (
          <Button
            variant="outline"
            size="sm"
            onPress={onAction}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
          >
            <Button.Label>{actionLabel}</Button.Label>
          </Button>
        ) : undefined
      }
    />
  );
}
