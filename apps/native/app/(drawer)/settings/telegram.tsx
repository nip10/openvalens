import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Spinner } from "heroui-native";
import { Linking, Pressable, RefreshControl, Text, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

export default function TelegramSettingsScreen() {
  const foreground = useThemeColor("foreground");
  const queryClient = useQueryClient();
  const { t } = useLingui();
  const connect = useMutation(
    orpc.telegram.issueConnectToken.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.telegram.status.key() });
      },
    }),
  );
  const disconnect = useMutation(
    orpc.telegram.disconnect.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.telegram.status.key() });
      },
    }),
  );
  // While a connect link is open, poll so the screen flips to Connected once
  // the member presses Start in Telegram.
  const waiting = connect.isSuccess;
  const status = useQuery({
    ...orpc.telegram.status.queryOptions({ input: {} }),
    refetchInterval: (query) => (waiting && !query.state.data?.connected ? 3000 : false),
  });

  if (status.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );

  const connected = status.data?.connected;
  const token = connected ? null : connect.data?.token;
  const link = connect.data?.link ?? null;
  const expiresAt = connect.data ? new Date(connect.data.expiresAt) : null;

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={status.isRefetching}
            onRefresh={() => void status.refetch()}
            tintColor={foreground}
          />
        ),
      }}
    >
      <View className="gap-4 p-4">
        <View>
          <Text className="text-sm text-muted-foreground">Telegram</Text>
          <Text className="font-mono text-3xl text-foreground">
            <Trans>Daily reminders</Trans>
          </Text>
        </View>

        {status.isError ? (
          <Card variant="secondary" className="items-center gap-2 p-6">
            <Text className="text-base text-foreground">
              <Trans>Could not load Telegram status.</Trans>
            </Text>
            <Pressable onPress={() => void status.refetch()} accessibilityRole="button">
              <Text className="font-medium text-foreground underline">
                <Trans>Retry</Trans>
              </Text>
            </Pressable>
          </Card>
        ) : (
          <CardStack>
            <Card variant="secondary" className="gap-3 p-4">
              <View className="flex-row items-center justify-between">
                <View className="min-w-0 flex-1">
                  <Text className="text-lg font-medium text-foreground">
                    {connected ? t`Connected` : t`Not connected`}
                  </Text>
                  <Text className="text-sm text-muted-foreground">
                    {connected
                      ? t`Daily reminders are sent to your Telegram chat.`
                      : t`Connect a Telegram chat to receive daily reminders.`}
                  </Text>
                </View>
                {connected ? (
                  <Button
                    variant="secondary"
                    onPress={() => {
                      connect.reset();
                      disconnect.mutate({});
                    }}
                    isDisabled={disconnect.isPending}
                  >
                    {disconnect.isPending ? t`Disconnecting…` : t`Disconnect`}
                  </Button>
                ) : (
                  <Button onPress={() => connect.mutate({})} isDisabled={connect.isPending}>
                    {connect.isPending ? t`Generating…` : t`Connect`}
                  </Button>
                )}
              </View>

              {connect.isError ? (
                <Text className="text-sm text-destructive">
                  <Trans>Could not generate a connect link.</Trans>
                </Text>
              ) : null}

              {token ? (
                <View className="gap-2 rounded-lg border border-border bg-muted/40 p-3">
                  {link ? (
                    <>
                      <Text className="text-xs text-muted-foreground">
                        <Trans>
                          Open the link in Telegram and press Start. This page updates once the chat
                          is connected.
                        </Trans>
                      </Text>
                      <Button onPress={() => void Linking.openURL(link)}>
                        <Button.Label>
                          <Trans>Open in Telegram</Trans>
                        </Button.Label>
                      </Button>
                    </>
                  ) : (
                    <>
                      <Text className="text-xs text-muted-foreground">
                        <Trans>Send this message to this server's Telegram bot:</Trans>
                      </Text>
                      <Text className="font-mono text-sm text-foreground" selectable>
                        /start {token}
                      </Text>
                    </>
                  )}
                  {expiresAt ? (
                    <Text className="text-xs text-muted-foreground">
                      <Trans>Expires {expiresAt.toLocaleString()}.</Trans>
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </Card>
          </CardStack>
        )}
      </View>
    </Container>
  );
}
