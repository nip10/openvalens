import { Trans, useLingui } from "@lingui/react/macro";
import { relativeTime } from "@openvalens/api/presenters/cochat";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, cn, Spinner } from "heroui-native";
import { Send, Sparkles } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";

import { ErrorState, Icon, Page, Sheet, ToneIcon } from "@/components/bloom";
import { Container } from "@/components/container";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

export default function CoachThreadScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const foreground = useThemeColor("foreground");
  const placeholderColor = useThemeColor("ink-3");
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
      <Container>
        <Page>
          <ErrorState
            title={<Trans>Could not load this conversation.</Trans>}
            action={
              <Button variant="outline" size="sm" onPress={() => void messages.refetch()}>
                <Button.Label>
                  <Trans>Retry</Trans>
                </Button.Label>
              </Button>
            }
          />
        </Page>
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
      <Page className="gap-5">
        <View className="flex-row items-center justify-between gap-2">
          <Pressable
            onPress={() => router.push("/coach")}
            accessibilityRole="button"
            className="min-h-11 justify-center rounded-full px-1 active:opacity-70"
          >
            <Text className="font-sans text-sm font-medium text-ink-2">
              <Trans>← All conversations</Trans>
            </Text>
          </Pressable>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => router.push("/coach")}
            isDisabled={send.isPending}
          >
            <Button.Label>
              <Trans>New conversation</Trans>
            </Button.Label>
          </Button>
        </View>

        <View ref={listRef} className="gap-4">
          {list.length === 0 ? (
            <Text className="py-6 font-sans text-base text-ink-3">
              <Trans>No messages yet — say hello to start.</Trans>
            </Text>
          ) : (
            list.map((message) => {
              const mine = message.role === "user";
              return (
                <View
                  key={message.id}
                  className={cn(
                    "flex-row items-end gap-2.5",
                    mine ? "justify-end" : "justify-start",
                  )}
                >
                  {mine ? null : <ToneIcon icon={Sparkles} tone="signal" size="sm" />}
                  <View
                    className={cn(
                      "max-w-[85%] gap-1 px-4 py-3",
                      mine
                        ? "rounded-3xl rounded-br-lg bg-sidebar-accent"
                        : "rounded-3xl rounded-bl-lg border border-rule bg-card",
                    )}
                  >
                    <Text className="font-sans text-sm text-ink-3">
                      <Text className="font-semibold text-ink">{mine ? t`You` : t`Coach`}</Text>
                      {" · "}
                      {i18n._(relativeTime(message.createdAt))}
                    </Text>
                    <Text className="font-sans text-base leading-relaxed text-ink-2">
                      {message.content}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
          {send.isPending ? (
            <View className="flex-row items-center gap-2.5" accessibilityRole="progressbar">
              <ToneIcon icon={Sparkles} tone="signal" size="sm" />
              <Text className="font-sans text-sm text-ink-3">
                <Trans>Coach · thinking…</Trans>
              </Text>
            </View>
          ) : null}
          {send.isError ? (
            <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
              <Trans>Could not send. Check AI consent in Settings.</Trans>
            </Text>
          ) : null}
        </View>

        <Sheet className="flex-row items-end gap-2 rounded-[28px] p-1.5 pl-4">
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={t`Ask the coach anything…`}
            accessibilityLabel={t`Ask the coach anything…`}
            editable={!send.isPending}
            multiline
            className="min-h-11 max-h-32 flex-1 py-2.5 font-sans text-base text-ink"
            placeholderTextColor={placeholderColor}
          />
          <Button onPress={submit} isDisabled={send.isPending || input.trim().length === 0}>
            <Icon icon={Send} size={16} color="primary-foreground" />
            <Button.Label>{send.isPending ? t`Sending…` : t`Send`}</Button.Label>
          </Button>
        </Sheet>
      </Page>
    </Container>
  );
}
