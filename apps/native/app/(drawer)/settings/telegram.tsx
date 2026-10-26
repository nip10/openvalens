import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { Send, Timer } from "lucide-react-native";
import { Linking, RefreshControl, Text, View } from "react-native";

import { ErrorState, Icon, Page, PageHeader, Sheet, StatusPill } from "@/components/bloom";
import { Container } from "@/components/container";
import { SettingsGroup, SettingsRow } from "@/components/language-section";
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
      <Container>
        <Page>
          <PageHeader eyebrow="Telegram" title={<Trans>Daily reminders</Trans>} />
          <Sheet className="h-28" />
        </Page>
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
      <Page>
        <PageHeader eyebrow="Telegram" title={<Trans>Daily reminders</Trans>} />

        {status.isError ? (
          <ErrorState
            title={<Trans>Could not load Telegram status.</Trans>}
            action={
              <Button variant="outline" size="sm" onPress={() => void status.refetch()}>
                <Button.Label>
                  <Trans>Retry</Trans>
                </Button.Label>
              </Button>
            }
          />
        ) : (
          <SettingsGroup>
            <SettingsRow
              icon={Send}
              label={
                <StatusPill tone={connected ? "good" : "neutral"}>
                  {connected ? t`Connected` : t`Not connected`}
                </StatusPill>
              }
              description={
                connected
                  ? t`Daily reminders are sent to your Telegram chat.`
                  : t`Connect a Telegram chat to receive daily reminders.`
              }
            >
              <View className="flex-row pl-12">
                {connected ? (
                  <Button
                    variant="outline"
                    onPress={() => {
                      connect.reset();
                      disconnect.mutate({});
                    }}
                    isDisabled={disconnect.isPending}
                  >
                    <Button.Label>
                      {disconnect.isPending ? t`Disconnecting…` : t`Disconnect`}
                    </Button.Label>
                  </Button>
                ) : (
                  <Button onPress={() => connect.mutate({})} isDisabled={connect.isPending}>
                    <Button.Label>{connect.isPending ? t`Generating…` : t`Connect`}</Button.Label>
                  </Button>
                )}
              </View>
            </SettingsRow>

            {connect.isError ? (
              <Text className="border-t border-rule py-4 font-sans text-sm text-destructive">
                <Trans>Could not generate a connect link.</Trans>
              </Text>
            ) : null}

            {token ? (
              <View className="gap-3 border-t border-rule py-4">
                {link ? (
                  <>
                    <Text className="font-sans text-sm leading-relaxed text-ink-2">
                      <Trans>
                        Open the link in Telegram and press Start. This page updates once the chat
                        is connected.
                      </Trans>
                    </Text>
                    <Button
                      variant="outline"
                      className="self-start"
                      onPress={() => void Linking.openURL(link)}
                    >
                      <Button.Label>
                        <Trans>Open in Telegram</Trans>
                      </Button.Label>
                    </Button>
                  </>
                ) : (
                  <>
                    <Text className="font-sans text-sm text-ink-2">
                      <Trans>Send this message to this server's Telegram bot:</Trans>
                    </Text>
                    <Text
                      className="rounded-xl bg-paper-2 px-3 py-2 font-sans text-sm font-semibold text-ink"
                      selectable
                    >
                      /start {token}
                    </Text>
                  </>
                )}
                {expiresAt ? (
                  <View className="flex-row items-center gap-1.5">
                    <Icon icon={Timer} size={16} />
                    <Text className="font-sans text-sm text-ink-3">
                      <Trans>Expires {expiresAt.toLocaleString()}.</Trans>
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </SettingsGroup>
        )}
      </Page>
    </Container>
  );
}
