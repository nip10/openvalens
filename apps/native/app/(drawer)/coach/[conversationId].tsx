import { Trans, useLingui } from "@lingui/react/macro";
import { relativeTime } from "@openvalens/api/presenters/cochat";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Card, Spinner } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";

import { Container } from "@/components/container";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

export default function CoachThreadScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const foreground = useThemeColor("foreground");
  const messages = useQuery(orpc.ai.listMessages.queryOptions({ input: { conversationId } }));
  const [input, setInput] = useState("");
  const { t, i18n } = useLingui();
  const listRef = useRef<View>(null);

  useEffect(() => {
    // Scroll to bottom when new messages arrive
    listRef.current?.measure(() => {});
  }, [messages.data?.length]);

  const send = useMutation(
    orpc.ai.chat.mutationOptions({
      onSuccess: async () => {
        setInput("");
        await queryClient.invalidateQueries({ queryKey: orpc.ai.listMessages.key() });
        await queryClient.invalidateQueries({ queryKey: orpc.ai.listThreads.key() });
      },
    }),
  );

  const submit = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    // The server keeps the history; send only the new message.
    send.mutate({ conversationId, message: trimmed });
  };

  if (messages.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );

  if (messages.isError || !messages.data)
    return (
      <Container className="items-center justify-center gap-3 p-6" isScrollable={false}>
        <Text className="text-base text-foreground">
          <Trans>Could not load this conversation.</Trans>
        </Text>
        <Pressable
          onPress={() => void messages.refetch()}
          className="min-h-11 justify-center px-4"
          accessibilityRole="button"
        >
          <Text className="font-medium text-foreground underline">
            <Trans>Retry</Trans>
          </Text>
        </Pressable>
      </Container>
    );

  const list = messages.data;

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={messages.isRefetching}
            onRefresh={() => void messages.refetch()}
            tintColor={foreground}
          />
        ),
      }}
    >
      <View className="gap-3 p-4">
        <View className="flex-row items-center justify-between">
          <Pressable onPress={() => router.push("/coach")} accessibilityRole="button">
            <Text className="text-sm text-foreground underline">
              <Trans>← All conversations</Trans>
            </Text>
          </Pressable>
          <Button
            variant="outline"
            onPress={() => router.push("/coach")}
            isDisabled={send.isPending}
          >
            <Trans>New conversation</Trans>
          </Button>
        </View>

        <View className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card p-3">
          {list.length === 0 ? (
            <Text className="py-8 text-center text-sm text-muted-foreground">
              <Trans>No messages yet — say hello to start.</Trans>
            </Text>
          ) : (
            list.map((message) => (
              <Card key={message.id} variant="secondary" className="p-3">
                <Text className="mb-1 text-xs text-muted-foreground">
                  {message.role === "user" ? t`You` : t`Coach`} ·{" "}
                  {i18n._(relativeTime(message.createdAt))}
                </Text>
                <Text className="text-sm text-foreground">{message.content}</Text>
              </Card>
            ))
          )}
          {send.isPending ? (
            <Card variant="secondary" className="p-3">
              <Text className="mb-1 text-xs text-muted-foreground">
                <Trans>Coach · thinking…</Trans>
              </Text>
              <Text className="text-sm text-muted-foreground">…</Text>
            </Card>
          ) : null}
          {send.isError ? (
            <Text className="text-sm text-destructive">
              <Trans>Could not send. Check AI consent in Settings.</Trans>
            </Text>
          ) : null}
        </View>

        <View className="flex-row items-end gap-2">
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={t`Ask the coach anything…`}
            editable={!send.isPending}
            multiline
            className="min-h-11 max-h-32 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-base text-foreground"
            placeholderTextColor="#9ca3af"
          />
          <Button onPress={submit} isDisabled={send.isPending || input.trim().length === 0}>
            {send.isPending ? t`Sending…` : t`Send`}
          </Button>
        </View>
      </View>
    </Container>
  );
}
