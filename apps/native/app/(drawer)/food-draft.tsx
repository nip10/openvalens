import type { FoodDraftCandidateWire } from "@openvalens/api/contracts/nutrition-food-drafts";
import { FOOD_DRAFT_COPY, FOOD_DRAFT_FLAG_LABELS } from "@openvalens/api/presenters/food-draft";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Button, Card } from "heroui-native";
import { useState } from "react";
import { Switch, Text, TextInput, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { client } from "@/utils/orpc";

/**
 * Describe a meal (#73). Speech comes from the keyboard's dictation; this
 * screen never records audio. The draft is never saved: each item opens the
 * meal diary's food search, where the member picks a food and confirms it.
 */

const INPUT =
  "min-h-11 rounded-lg border border-border bg-card px-3 py-2 text-base text-foreground";

const DRAFT_FAILED = msg`Could not make a draft. Nothing was saved.`;
const DRAFT_DISCARDED = msg`Draft discarded. Nothing was saved.`;

export default function FoodDraftScreen() {
  const router = useRouter();
  const { t, i18n } = useLingui();
  const [transcript, setTranscript] = useState("");
  const [useAi, setUseAi] = useState(false);
  const [aiAgreed, setAiAgreed] = useState(false);
  const [candidates, setCandidates] = useState<FoodDraftCandidateWire[] | null>(null);
  const [message, setMessage] = useState<MessageDescriptor | null>(null);
  const provider = useQuery({
    queryKey: ["nutritionFoodDrafts", "provider"],
    queryFn: () => client.nutritionFoodDrafts.provider({}),
  });
  const parse = useMutation({
    mutationFn: () =>
      client.nutritionFoodDrafts.parse({
        transcript,
        mode: useAi ? "ai" : "local",
        ...(useAi && provider.data?.provider
          ? { sendToProvider: { provider: provider.data.provider, host: provider.data.host } }
          : {}),
      }),
    onSuccess: (result) => {
      setAiAgreed(false);
      setCandidates(result.status === "ready" ? result.candidates : null);
      setMessage(FOOD_DRAFT_COPY.status[result.status]);
    },
    onError: () => setMessage(DRAFT_FAILED),
  });
  const providerName = provider.data?.host
    ? `${provider.data.provider} (${provider.data.host})`
    : (provider.data?.provider ?? "");

  return (
    <Container className="p-4">
      <View className="gap-6">
        <View className="gap-2">
          <Text accessibilityRole="header" className="font-mono text-3xl text-foreground">
            <Trans>Describe a meal</Trans>
          </Text>
          <Text className="text-sm text-muted-foreground">{i18n._(FOOD_DRAFT_COPY.intro)}</Text>
        </View>
        <Card variant="secondary" className="gap-3 p-4">
          <TextInput
            value={transcript}
            onChangeText={setTranscript}
            multiline
            maxLength={2000}
            textAlignVertical="top"
            placeholder={t`Two eggs, a slice of toast and a coffee`}
            accessibilityLabel={t`What did you have?`}
            className={`${INPUT} min-h-28`}
            placeholderTextColor="#9ca3af"
          />
          <Text className="text-xs text-muted-foreground">{i18n._(FOOD_DRAFT_COPY.dictation)}</Text>
          {provider.data?.available ? (
            <View className="gap-2 rounded-lg border border-border p-3">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="flex-1 text-sm text-foreground">
                  <Trans>Use the AI provider for this draft</Trans>
                </Text>
                <Switch
                  value={useAi}
                  onValueChange={(value) => {
                    setUseAi(value);
                    setAiAgreed(false);
                  }}
                  accessibilityLabel={t`Use the AI provider for this draft`}
                />
              </View>
              {useAi ? (
                <View className="flex-row items-center justify-between gap-3">
                  <Text className="flex-1 text-sm text-foreground">
                    <Trans comment="safety">
                      Send this text, and nothing else, to {providerName} now.
                    </Trans>{" "}
                    {i18n._(FOOD_DRAFT_COPY.aiDisclosure)}
                  </Text>
                  <Switch
                    value={aiAgreed}
                    onValueChange={setAiAgreed}
                    accessibilityLabel={t({
                      message: "Agree to send this text to the AI provider now",
                      comment: "safety",
                    })}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
          <Button
            isDisabled={!transcript.trim() || (useAi && !aiAgreed) || parse.isPending}
            onPress={() => parse.mutate()}
          >
            {parse.isPending ? t`Working…` : t`Make a draft`}
          </Button>
          {message ? (
            <Text accessibilityLiveRegion="polite" className="text-sm text-muted-foreground">
              {i18n._(message)}
            </Text>
          ) : null}
        </Card>

        {candidates ? (
          <CardStack title={t`Review the draft`}>
            <Card variant="secondary" className="gap-3 p-4">
              <Text className="text-sm text-muted-foreground">
                {i18n._(FOOD_DRAFT_COPY.review)}
              </Text>
              {candidates.map((item, index) => (
                <View key={item.id} className="gap-2 rounded-lg border border-border p-3">
                  <Text className="text-sm font-medium text-foreground">
                    {t`Item ${index + 1} · heard “${item.sourceText}”`}
                  </Text>
                  <TextInput
                    value={item.foodText}
                    maxLength={200}
                    onChangeText={(foodText) =>
                      setCandidates((current) =>
                        current
                          ? current.map((entry) =>
                              entry.id === item.id ? { ...entry, foodText } : entry,
                            )
                          : current,
                      )
                    }
                    accessibilityLabel={t`Food for item ${index + 1}`}
                    className={INPUT}
                  />
                  <Text className="text-sm text-muted-foreground">
                    {item.quantityText ?? t`No quantity`} · {item.unitText ?? t`no unit`}
                  </Text>
                  {item.flags.length ? (
                    <Text className="text-sm text-foreground">
                      {item.flags.map((flag) => i18n._(FOOD_DRAFT_FLAG_LABELS[flag])).join(" · ")}
                    </Text>
                  ) : null}
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      size="sm"
                      onPress={() =>
                        router.push({ pathname: "/nutrition", params: { food: item.foodText } })
                      }
                    >
                      <Trans>Find and log this food</Trans>
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() =>
                        setCandidates((current) =>
                          current ? current.filter((entry) => entry.id !== item.id) : current,
                        )
                      }
                    >
                      <Trans>Remove</Trans>
                    </Button>
                  </View>
                </View>
              ))}
              <Button
                variant="secondary"
                onPress={() => {
                  setCandidates(null);
                  setMessage(DRAFT_DISCARDED);
                }}
              >
                <Trans>Discard draft</Trans>
              </Button>
            </Card>
          </CardStack>
        ) : null}
      </View>
    </Container>
  );
}
