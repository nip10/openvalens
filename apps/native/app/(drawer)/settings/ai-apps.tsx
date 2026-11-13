import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  aiAppCallStatusLabel,
  aiAppCallTone,
  aiAppGrantStatusLabel,
  aiAppScopeTitle,
  splitGrants,
  type AiAppGrantLike,
} from "@openvalens/api/presenters/ai-apps";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { Bot, KeyRound, Link2, MonitorSmartphone } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Alert, RefreshControl, Text, View } from "react-native";

import {
  Details,
  EmptyState,
  ErrorState,
  ListCard,
  Page,
  PageHeader,
  Section,
  Sheet,
  StatusPill,
  ToneIcon,
} from "@/components/bloom";
import { Container } from "@/components/container";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

/**
 * Issue #439 — Settings → Connected AI apps on mobile: view and revoke only.
 * Keys are created in the web app, where the key can be copied safely and
 * the consent is given.
 */
export default function AiAppsSettingsScreen() {
  const foreground = useThemeColor("foreground");
  const queryClient = useQueryClient();
  const { t } = useLingui();
  const status = useQuery(orpc.aiApps.status.queryOptions({ input: {} }));
  const enabled = status.data?.enabled === true;
  const grants = useQuery({ ...orpc.aiApps.listGrants.queryOptions({ input: {} }), enabled });
  const revoke = useMutation(
    orpc.aiApps.revokeGrant.mutationOptions({
      onError: () => Alert.alert(t`Could not revoke. Try again.`),
      onSettled: () => void queryClient.invalidateQueries({ queryKey: orpc.aiApps.key() }),
    }),
  );

  const header = (
    <PageHeader
      eyebrow={<Trans>Settings</Trans>}
      title={<Trans>Connected AI apps</Trans>}
      description={<Trans>Apps that can read your records to answer your questions.</Trans>}
    />
  );

  if (status.isPending || (enabled && grants.isPending)) {
    return (
      <Container>
        <Page>
          {header}
          <Sheet className="h-28" />
        </Page>
      </Container>
    );
  }

  const confirmRevoke = (grant: AiAppGrantLike) =>
    Alert.alert(
      grant.kind === "oauth" ? t`Disconnect ${grant.label}?` : t`Revoke the key ${grant.label}?`,
      t`The app stops reading your records on its next request. What it already read stays with the app.`,
      [
        { text: t`Cancel`, style: "cancel" },
        {
          text: t`Revoke`,
          style: "destructive",
          onPress: () => revoke.mutate({ grantId: grant.id }),
        },
      ],
    );

  const list = grants.data?.grants ?? [];
  const connections = splitGrants(list, "oauth");
  const keys = splitGrants(list, "personal_key");

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={grants.isRefetching}
            onRefresh={() => void grants.refetch()}
            tintColor={foreground}
          />
        ),
      }}
    >
      <Page>
        {header}
        {status.isError || grants.isError ? (
          <ErrorState
            title={<Trans>Could not load connected AI apps.</Trans>}
            action={
              <Button
                variant="outline"
                size="sm"
                onPress={() => void (status.isError ? status.refetch() : grants.refetch())}
              >
                <Button.Label>
                  <Trans>Retry</Trans>
                </Button.Label>
              </Button>
            }
          />
        ) : !enabled ? (
          <EmptyState
            icon={Bot}
            tone="signal"
            title={<Trans>Connected AI apps are not available on this server</Trans>}
          />
        ) : (
          <>
            <Sheet className="flex-row items-start gap-3 p-4">
              <ToneIcon icon={MonitorSmartphone} tone="signal" size="sm" />
              <Text className="flex-1 font-sans text-sm leading-relaxed text-ink-2">
                <Trans>
                  To make a personal key or connect a new app, sign in to the web app and open
                  Settings, then Connected AI apps. You can revoke access here.
                </Trans>
              </Text>
            </Sheet>

            <Section title={<Trans>Connections</Trans>} icon={Link2} tone="signal">
              <GrantList
                active={connections.active}
                inactive={connections.inactive}
                busyId={revoke.isPending ? (revoke.variables?.grantId ?? null) : null}
                onRevoke={confirmRevoke}
                empty={
                  <EmptyState
                    icon={Bot}
                    title={<Trans>No apps connected yet</Trans>}
                    description={
                      <Trans>
                        You can let an AI assistant read your sleep, workouts, labs and other
                        records so it can answer questions about them.
                      </Trans>
                    }
                  />
                }
              />
            </Section>

            <Section title={<Trans>Personal keys</Trans>} icon={KeyRound} tone="signal">
              <GrantList
                active={keys.active}
                inactive={keys.inactive}
                busyId={revoke.isPending ? (revoke.variables?.grantId ?? null) : null}
                onRevoke={confirmRevoke}
                empty={<EmptyState icon={KeyRound} title={<Trans>No personal keys</Trans>} />}
              />
            </Section>
          </>
        )}
      </Page>
    </Container>
  );
}

function GrantList(props: {
  active: AiAppGrantLike[];
  inactive: AiAppGrantLike[];
  busyId: string | null;
  onRevoke: (grant: AiAppGrantLike) => void;
  empty: ReactNode;
}) {
  return (
    <View className="gap-3">
      {props.active.length === 0
        ? props.empty
        : props.active.map((grant) => <GrantCard key={grant.id} grant={grant} {...props} />)}
      {props.inactive.length > 0 ? (
        <Details summary={<Trans>Revoked and expired</Trans>}>
          {props.inactive.map((grant) => (
            <GrantCard key={grant.id} grant={grant} {...props} />
          ))}
        </Details>
      ) : null}
    </View>
  );
}

function GrantCard(props: {
  grant: AiAppGrantLike;
  busyId: string | null;
  onRevoke: (grant: AiAppGrantLike) => void;
}) {
  const { t, i18n } = useLingui();
  const { grant } = props;
  const [showActivity, setShowActivity] = useState(false);
  const active = grant.status === "active";
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : t`Never`);
  const scopes = grant.scopes
    .map((scope) => {
      const title = aiAppScopeTitle(scope);
      return title ? i18n._(title) : scope;
    })
    .join(", ");
  const identity =
    grant.kind === "oauth"
      ? `${t`Unverified app`} · ${grant.clientIdHost ?? t`Registered automatically, no verified identity`}`
      : `${grant.displayPrefix ?? ""}…`;

  return (
    <ListCard
      icon={grant.kind === "oauth" ? Bot : KeyRound}
      tone="neutral"
      title={grant.label}
      status={{
        label: i18n._(aiAppGrantStatusLabel(grant.status)),
        tone: active ? "good" : "neutral",
      }}
      subtitle={identity}
    >
      <Text className="font-sans text-sm text-ink-2">{t`Can read: ${scopes}`}</Text>
      <Text className="font-sans text-sm text-ink-3">
        {t`Consent ${grant.consentVersion} · created ${day(grant.createdAt)} · last used ${day(grant.lastUsedAt)}`}
      </Text>
      {grant.kind === "personal_key" ? (
        <Text className="font-sans text-sm text-ink-3">{t`Expires: ${day(grant.expiresAt)}`}</Text>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onPress={() => setShowActivity((value) => !value)}
        accessibilityState={{ expanded: showActivity }}
      >
        <Button.Label>{t`Recent activity`}</Button.Label>
      </Button>
      {showActivity ? <GrantActivity grantId={grant.id} /> : null}
      {active ? (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          isDisabled={props.busyId === grant.id}
          accessibilityLabel={t`Revoke ${grant.label}`}
          onPress={() => props.onRevoke(grant)}
        >
          <Button.Label>{props.busyId === grant.id ? t`Revoking…` : t`Revoke`}</Button.Label>
        </Button>
      ) : null}
    </ListCard>
  );
}

function GrantActivity({ grantId }: { grantId: string }) {
  const { i18n } = useLingui();
  const calls = useQuery(
    orpc.aiApps.recentActivity.queryOptions({ input: { grantId, limit: 20 } }),
  );
  if (calls.isPending) return <Sheet className="h-12" />;
  if (calls.isError) {
    return (
      <Text className="font-sans text-sm text-destructive">
        <Trans>Could not load the recent activity.</Trans>
      </Text>
    );
  }
  const rows = calls.data?.calls ?? [];
  if (rows.length === 0) {
    return (
      <Text className="font-sans text-sm text-ink-3">
        <Trans>No requests in the last 90 days.</Trans>
      </Text>
    );
  }
  return (
    <View className="gap-2">
      {rows.map((call, index) => (
        <View
          key={`${call.createdAt}-${index}`}
          className="flex-row flex-wrap items-center gap-2"
          accessible
        >
          <Text className="font-sans text-sm font-medium text-ink">{call.tool}</Text>
          <Text className="font-sans text-sm text-ink-3">
            {new Date(call.createdAt).toLocaleString()}
          </Text>
          <StatusPill tone={aiAppCallTone(call.status)}>
            {i18n._(aiAppCallStatusLabel(call.status))}
          </StatusPill>
          {call.rowCount !== null ? (
            <Text className="font-sans text-sm text-ink-3">
              <Plural value={call.rowCount} one="# row" other="# rows" />
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
