import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { previewLine, relativeTime, truncate } from "@openvalens/api/presenters/cochat";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Button, Spinner } from "heroui-native";
import { MessageCircle, Plus } from "lucide-react-native";
import { useState } from "react";
import { RefreshControl, Text, View } from "react-native";

import {
  EmptyState,
  ErrorState,
  Icon,
  ListCard,
  Page,
  PageHeader,
  Section,
} from "@/components/bloom";
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
      <Container>
        <Page>
          <ErrorState
            title={<Trans>Could not load threads.</Trans>}
            action={
              <Button variant="outline" size="sm" onPress={() => void threads.refetch()}>
                <Button.Label>
                  <Trans>Retry</Trans>
                </Button.Label>
              </Button>
            }
          />
        </Page>
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
      <Page>
        <PageHeader
          title={<Trans>Coach</Trans>}
          actions={
            <Button onPress={onNew} isDisabled={starting || start.isPending}>
              <Icon icon={Plus} size={18} color="primary-foreground" />
              <Button.Label>{start.isPending ? t`Starting…` : t`New`}</Button.Label>
            </Button>
          }
        />

        {start.isError ? (
          <ErrorState
            title={
              <Trans>Could not start a conversation. Check that AI is enabled in Settings.</Trans>
            }
          />
        ) : null}

        <Section title={<Trans>Conversations</Trans>}>
          {list.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              tone="signal"
              title={<Trans>No conversations yet</Trans>}
              description={
                <Trans>Start a new conversation to ask the AI coach for guidance.</Trans>
              }
            />
          ) : (
            <View className="gap-3">
              {list.map((thread) => (
                <ListCard
                  key={thread.conversationId}
                  icon={MessageCircle}
                  tone="signal"
                  title={truncate(previewLine(thread), 80)}
                  subtitle={
                    <Text>
                      {i18n._(relativeTime(thread.lastMessageAt))} ·{" "}
                      <Plural value={thread.messageCount} one="# message" other="# messages" />
                    </Text>
                  }
                  onPress={() => router.push(`/coach/${thread.conversationId}`)}
                />
              ))}
            </View>
          )}
        </Section>
      </Page>
    </Container>
  );
}
