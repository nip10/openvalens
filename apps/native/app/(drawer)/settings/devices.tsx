import { Trans, useLingui } from "@lingui/react/macro";
import {
  wearableErrorLabel,
  wearableSendsLabel,
  wearableStatusLabel,
} from "@openvalens/api/presenters/wearables";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { MonitorSmartphone, Watch } from "lucide-react-native";
import { RefreshControl, Text, View } from "react-native";

import {
  EmptyState,
  ErrorState,
  ListCard,
  Page,
  PageHeader,
  Sheet,
  type StatusTone,
  ToneIcon,
} from "@/components/bloom";
import { Container } from "@/components/container";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

const STATUS_TONE: Record<string, StatusTone> = {
  active: "good",
  not_connected: "neutral",
  reconnect_needed: "warn",
  quarantined: "bad",
};

/**
 * Cloud wearable connections (Issue #60), read-mostly. Connecting is done in
 * the web app: the server's OAuth callback binds the vendor grant to the
 * session cookie of the browser that arrives there, and then redirects to the
 * web app's /settings/devices. This app keeps its session cookie in secure
 * storage, which the system browser cannot see, so a connect started here
 * would come back "unauthenticated". This screen shows status and can request
 * a sync, and points to the web app for the rest.
 */
export default function DevicesSettingsScreen() {
  const foreground = useThemeColor("foreground");
  const queryClient = useQueryClient();
  const { t, i18n } = useLingui();
  const list = useQuery(orpc.wearables.list.queryOptions({ input: {} }));
  const syncNow = useMutation(
    orpc.wearables.syncNow.mutationOptions({
      onSettled: () => void queryClient.invalidateQueries({ queryKey: orpc.wearables.key() }),
    }),
  );

  if (list.isPending)
    return (
      <Container>
        <Page>
          <PageHeader eyebrow={<Trans>Integrations</Trans>} title={<Trans>Devices</Trans>} />
          <Sheet className="h-28" />
        </Page>
      </Container>
    );

  const providers = list.data?.providers ?? [];

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={list.isRefetching}
            onRefresh={() => void list.refetch()}
            tintColor={foreground}
          />
        ),
      }}
    >
      <Page>
        <PageHeader eyebrow={<Trans>Integrations</Trans>} title={<Trans>Devices</Trans>} />

        <Sheet className="flex-row items-start gap-3 p-4">
          <ToneIcon icon={MonitorSmartphone} tone="signal" size="sm" />
          <Text className="flex-1 font-sans text-sm leading-relaxed text-ink-2">
            <Trans>
              This app already syncs Apple Health or Health Connect. To connect, disconnect or
              remove a vendor account such as Oura or WHOOP, sign in to the web app and open
              Settings, then Devices.
            </Trans>
          </Text>
        </Sheet>

        {list.isError ? (
          <ErrorState
            title={<Trans>Could not load your devices.</Trans>}
            action={
              <Button variant="outline" size="sm" onPress={() => void list.refetch()}>
                <Button.Label>
                  <Trans>Retry</Trans>
                </Button.Label>
              </Button>
            }
          />
        ) : providers.length === 0 ? (
          <EmptyState
            icon={Watch}
            tone="signal"
            title={<Trans>No cloud devices are available on this server</Trans>}
          />
        ) : (
          <View className="gap-3">
            {providers.map((row) => {
              const error = wearableErrorLabel(row.lastErrorCode);
              const lastSynced = row.lastSyncedAt
                ? new Date(row.lastSyncedAt).toLocaleString()
                : null;
              const busy = syncNow.isPending && syncNow.variables?.provider === row.provider;
              const requested = syncNow.isSuccess && syncNow.variables?.provider === row.provider;
              return (
                <ListCard
                  key={row.provider}
                  icon={Watch}
                  tone="signal"
                  title={row.displayName}
                  status={{
                    label: i18n._(wearableStatusLabel(row.status)),
                    tone: STATUS_TONE[row.status] ?? "neutral",
                  }}
                  subtitle={i18n._(wearableSendsLabel(row.provider))}
                >
                  {row.status !== "not_connected" ? (
                    <Text className="font-sans text-sm text-ink-3">
                      {lastSynced ? t`Last synced ${lastSynced}` : t`Not synced yet`}
                    </Text>
                  ) : null}
                  {error && row.status !== "quarantined" ? (
                    <Text className="font-sans text-sm text-destructive">{i18n._(error)}</Text>
                  ) : null}
                  {row.status === "quarantined" ? (
                    <Text className="font-sans text-sm text-ink-2">
                      <Trans>
                        Access was revoked. Choose whether to keep or delete its records in the web
                        app.
                      </Trans>
                    </Text>
                  ) : null}
                  {requested ? (
                    <Text className="font-sans text-sm text-ink-3">
                      <Trans>Sync requested. It runs on the next scheduled pass.</Trans>
                    </Text>
                  ) : null}
                  {syncNow.isError && syncNow.variables?.provider === row.provider ? (
                    <Text className="font-sans text-sm text-destructive">
                      <Trans>Could not request a sync.</Trans>
                    </Text>
                  ) : null}
                  {row.status === "active" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="self-start"
                      isDisabled={busy}
                      onPress={() => syncNow.mutate({ provider: row.provider })}
                    >
                      <Button.Label>{t`Sync now`}</Button.Label>
                    </Button>
                  ) : null}
                </ListCard>
              );
            })}
          </View>
        )}
      </Page>
    </Container>
  );
}
