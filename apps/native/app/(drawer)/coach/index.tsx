import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { previewLine, relativeTime, truncate } from "@openvalens/api/presenters/cochat";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Spinner } from "heroui-native";
import { useState } from "react";
import { Pressable, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

export default function CoachListScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const foreground = useThemeColor("foreground");
  const threads = useQuery(orpc.ai.listThreads.queryOptions({ input: { limit: 50 } }));
  const [starting, setStarting] = useState(false);
  const { t, i18n } = useLingui();

  const start = useMutation(
    orpc.ai.chat.mutationOptions({
      onSuccess: async (result) => {
        await queryClient.invalidateQueries({ queryKey: orpc.ai.listThreads.key() });
        router.push(`/coach/${result.conversationId}`);
      },
    }),
  );

  const onNew = () => {
    setStarting(true);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    start.mutate({
      conversationId: id,
      message: t({
        message:
          "Hi coach — give me a one-line summary of where I am today and one concrete suggestion.",
        comment:
          "First message sent to the AI coach for a new conversation; shown as the person's own message",
      }),
    });
  };

  if (threads.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );

  if (threads.isError || !threads.data)
    return (
      <Container className="items-center justify-center gap-3 p-6" isScrollable={false}>
        <Text className="text-base text-foreground">
          <Trans>Could not load threads.</Trans>
        </Text>
        <Pressable
          onPress={() => void threads.refetch()}
          className="min-h-11 justify-center px-4"
          accessibilityRole="button"
        >
          <Text className="font-medium text-foreground underline">
            <Trans>Retry</Trans>
          </Text>
        </Pressable>
      </Container>
    );

  const list = threads.data;

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={threads.isRefetching}
            onRefresh={() => void threads.refetch()}
            tintColor={foreground}
          />
        ),
      }}
    >
      <View className="gap-4 p-4">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-sm text-muted-foreground">
              <Trans>Coach</Trans>
            </Text>
            <Text className="font-mono text-3xl text-foreground">
              <Trans>Conversations</Trans>
            </Text>
          </View>
          <Button onPress={onNew} isDisabled={starting || start.isPending}>
            {start.isPending ? t`Starting…` : t`New`}
          </Button>
        </View>

        {start.isError ? (
          <Text className="text-sm text-destructive">
            <Trans>Could not start a conversation. Check that AI is enabled in Settings.</Trans>
          </Text>
        ) : null}

        {list.length === 0 ? (
          <CardStack>
            <Card variant="secondary" className="items-center gap-1 p-8">
              <Text className="font-medium text-foreground">
                <Trans>No conversations yet</Trans>
              </Text>
              <Text className="text-center text-sm text-muted-foreground">
                <Trans>Start a new conversation to ask the AI coach for guidance.</Trans>
              </Text>
            </Card>
          </CardStack>
        ) : (
          <CardStack>
            <Card variant="secondary" className="p-0">
              {list.map((thread, index) => (
                <Pressable
                  key={thread.conversationId}
                  onPress={() => router.push(`/coach/${thread.conversationId}`)}
                  accessibilityRole="button"
                  className={`flex-row items-center justify-between gap-3 px-4 py-3 active:opacity-70 ${
                    index < list.length - 1 ? "border-b border-border" : ""
                  }`}
                >
                  <View className="min-w-0 flex-1">
                    <Text className="text-xs text-muted-foreground">
                      {i18n._(relativeTime(thread.lastMessageAt))} ·{" "}
                      <Plural value={thread.messageCount} one="# message" other="# messages" />
                    </Text>
                    <Text className="text-sm font-medium text-foreground" numberOfLines={2}>
                      {truncate(previewLine(thread), 80)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </Card>
          </CardStack>
        )}
      </View>
    </Container>
  );
}
