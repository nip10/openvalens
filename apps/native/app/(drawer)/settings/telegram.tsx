import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Spinner } from "heroui-native";
import { Pressable, RefreshControl, Text, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

export default function TelegramSettingsScreen() {
  const foreground = useThemeColor("foreground");
  const queryClient = useQueryClient();
  const { t } = useLingui();
  const status = useQuery(orpc.telegram.status.queryOptions({ input: {} }));
  const connect = useMutation(
    orpc.telegram.issueConnectToken.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ["telegram", "status"] });
      },
    }),
  );

  if (status.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );

  const connected = status.data?.connected;
  const token = connect.data?.token;
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
                <Button onPress={() => connect.mutate({})} isDisabled={connect.isPending}>
                  {connect.isPending ? t`Generating…` : connected ? t`Re-link` : t`Connect`}
                </Button>
              </View>

              {connect.isError ? (
                <Text className="text-sm text-destructive">
                  <Trans>Could not generate a connect link.</Trans>
                </Text>
              ) : null}

              {token ? (
                <View className="gap-2 rounded-lg border border-border bg-muted/40 p-3">
                  <Text className="text-xs text-muted-foreground">
                    <Trans>Open Telegram and send this token to the bot:</Trans>
                  </Text>
                  <Text
                    className="font-mono text-sm text-foreground"
                    numberOfLines={3}
                    ellipsizeMode="middle"
                  >
                    {token}
                  </Text>
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
