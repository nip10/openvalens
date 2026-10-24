import { Trans, useLingui } from "@lingui/react/macro";
import {
  wearableErrorLabel,
  wearableSendsLabel,
  wearableStatusLabel,
} from "@openvalens/api/presenters/wearables";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Spinner } from "heroui-native";
import { Pressable, RefreshControl, Text, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

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
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
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
      <View className="gap-4 p-4">
        <View>
          <Text className="text-sm text-muted-foreground">
            <Trans>Integrations</Trans>
          </Text>
          <Text className="font-mono text-3xl text-foreground">
            <Trans>Devices</Trans>
          </Text>
        </View>

        <Text className="text-sm text-muted-foreground">
          <Trans>
            This app already syncs Apple Health or Health Connect. To connect, disconnect or remove
            a vendor account such as Oura or WHOOP, sign in to the web app and open Settings, then
            Devices.
          </Trans>
        </Text>

        {list.isError ? (
          <Card variant="secondary" className="items-center gap-2 p-6">
            <Text className="text-base text-foreground">
              <Trans>Could not load your devices.</Trans>
            </Text>
            <Pressable onPress={() => void list.refetch()} accessibilityRole="button">
              <Text className="font-medium text-foreground underline">
                <Trans>Retry</Trans>
              </Text>
            </Pressable>
          </Card>
        ) : providers.length === 0 ? (
          <Card variant="secondary" className="p-4">
            <Text className="text-base text-foreground">
              <Trans>No cloud devices are available on this server</Trans>
            </Text>
          </Card>
        ) : (
          <CardStack>
            {providers.map((row) => {
              const error = wearableErrorLabel(row.lastErrorCode);
              const lastSynced = row.lastSyncedAt
                ? new Date(row.lastSyncedAt).toLocaleString()
                : null;
              const busy = syncNow.isPending && syncNow.variables?.provider === row.provider;
              const requested = syncNow.isSuccess && syncNow.variables?.provider === row.provider;
              return (
                <Card key={row.provider} variant="secondary" className="gap-2 p-4">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-lg font-medium text-foreground">{row.displayName}</Text>
                    <Text className="text-sm text-muted-foreground">
                      {i18n._(wearableStatusLabel(row.status))}
                    </Text>
                  </View>
                  <Text className="text-xs text-muted-foreground">
                    {i18n._(wearableSendsLabel(row.provider))}
                  </Text>
                  {row.status !== "not_connected" ? (
                    <Text className="text-sm text-muted-foreground">
                      {lastSynced ? t`Last synced ${lastSynced}` : t`Not synced yet`}
                    </Text>
                  ) : null}
                  {error && row.status !== "quarantined" ? (
                    <Text className="text-sm text-destructive">{i18n._(error)}</Text>
                  ) : null}
                  {row.status === "quarantined" ? (
                    <Text className="text-sm text-foreground">
                      <Trans>
                        Access was revoked. Choose whether to keep or delete its records in the web
                        app.
                      </Trans>
                    </Text>
                  ) : null}
                  {requested ? (
                    <Text className="text-sm text-muted-foreground">
                      <Trans>Sync requested. It runs on the next scheduled pass.</Trans>
                    </Text>
                  ) : null}
                  {syncNow.isError && syncNow.variables?.provider === row.provider ? (
                    <Text className="text-sm text-destructive">
                      <Trans>Could not request a sync.</Trans>
                    </Text>
                  ) : null}
                  {row.status === "active" ? (
                    <Button
                      variant="secondary"
                      isDisabled={busy}
                      onPress={() => syncNow.mutate({ provider: row.provider })}
                    >
                      {t`Sync now`}
                    </Button>
                  ) : null}
                </Card>
              );
            })}
          </CardStack>
        )}
      </View>
    </Container>
  );
}
