import type { FoodDraftCandidateWire } from "@openvalens/api/contracts/nutrition-food-drafts";
import { FOOD_DRAFT_COPY, FOOD_DRAFT_FLAG_LABELS } from "@openvalens/api/presenters/food-draft";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Button } from "heroui-native";
import {
  ArrowLeft,
  ListChecks,
  MessageSquareText,
  Mic,
  Search,
  Sparkles,
} from "lucide-react-native";
import { useState } from "react";
import { Switch, Text, TextInput, View } from "react-native";

import { Icon, Page, PageHeader, Section, Sheet, StatusPill, ToneIcon } from "@/components/bloom";
import { Container } from "@/components/container";
import { client } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

/**
 * Describe a meal (#73). Speech comes from the keyboard's dictation; this
 * screen never records audio. The draft is never saved: each item opens the
 * meal diary's food search, where the member picks a food and confirms it.
 */

const INPUT =
  "min-h-11 rounded-xl border border-rule bg-sheet px-3 py-2 font-sans text-base text-ink";

const DRAFT_FAILED = msg`Could not make a draft. Nothing was saved.`;
const DRAFT_DISCARDED = msg`Draft discarded. Nothing was saved.`;

export default function FoodDraftScreen() {
  const router = useRouter();
  const { t, i18n } = useLingui();
  const placeholder = useThemeColor("ink-3");
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
    <Container>
      <Page>
        <PageHeader
          title={<Trans>Describe a meal</Trans>}
          info={i18n._(FOOD_DRAFT_COPY.intro)}
          actions={
            <Button variant="outline" size="sm" onPress={() => router.push("/nutrition")}>
              <Icon icon={ArrowLeft} size={16} color="food" />
              <Button.Label>{t`Back to meal diary`}</Button.Label>
            </Button>
          }
        />
        <Sheet className="gap-4">
          <View className="flex-row items-center gap-2.5">
            <ToneIcon icon={MessageSquareText} tone="food" size="sm" />
            <Text className="font-display text-lg font-medium text-ink">
              <Trans>What did you have?</Trans>
            </Text>
          </View>
          <TextInput
            value={transcript}
            onChangeText={setTranscript}
            multiline
            maxLength={2000}
            textAlignVertical="top"
            placeholder={t`Two eggs, a slice of toast and a coffee`}
            accessibilityLabel={t`What did you have?`}
            className={`${INPUT} min-h-28`}
            placeholderTextColor={placeholder}
          />
          <View className="flex-row items-start gap-1.5">
            <View className="pt-0.5">
              <Icon icon={Mic} size={16} />
            </View>
            <Text className="flex-1 font-sans text-sm text-ink-3">
              {i18n._(FOOD_DRAFT_COPY.dictation)}
            </Text>
          </View>
          {provider.data?.available ? (
            <View className="gap-3 rounded-2xl bg-paper-2 p-4">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="flex-1 font-sans text-sm text-ink-2">
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
                  <Text className="flex-1 font-sans text-sm text-ink-2">
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
            className="self-start"
            isDisabled={!transcript.trim() || (useAi && !aiAgreed) || parse.isPending}
            onPress={() => parse.mutate()}
          >
            <Icon icon={Sparkles} size={16} color="accent-foreground" />
            <Button.Label>{parse.isPending ? t`Working…` : t`Make a draft`}</Button.Label>
          </Button>
          {message ? (
            <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-2">
              {i18n._(message)}
            </Text>
          ) : null}
        </Sheet>

        {candidates ? (
          <Section
            icon={ListChecks}
            tone="food"
            title={t`Review the draft`}
            info={i18n._(FOOD_DRAFT_COPY.review)}
          >
            <View className="gap-3">
              {candidates.map((item, index) => (
                <Sheet key={item.id} className="gap-3">
                  <Text className="font-display text-base font-medium text-ink">
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
                  <Text className="font-sans text-sm text-ink-3">
                    {item.quantityText ?? t`No quantity`} · {item.unitText ?? t`no unit`}
                  </Text>
                  {item.flags.length ? (
                    <View className="flex-row flex-wrap gap-1.5">
                      {item.flags.map((flag) => (
                        <StatusPill key={flag} tone="warn">
                          {i18n._(FOOD_DRAFT_FLAG_LABELS[flag])}
                        </StatusPill>
                      ))}
                    </View>
                  ) : null}
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onPress={() =>
                        router.push({ pathname: "/nutrition", params: { food: item.foodText } })
                      }
                    >
                      <Icon icon={Search} size={16} color="ink-2" />
                      <Button.Label>
                        <Trans>Find and log this food</Trans>
                      </Button.Label>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() =>
                        setCandidates((current) =>
                          current ? current.filter((entry) => entry.id !== item.id) : current,
                        )
                      }
                    >
                      <Button.Label>
                        <Trans>Remove</Trans>
                      </Button.Label>
                    </Button>
                  </View>
                </Sheet>
              ))}
              <Button
                variant="secondary"
                className="self-start"
                onPress={() => {
                  setCandidates(null);
                  setMessage(DRAFT_DISCARDED);
                }}
              >
                <Button.Label>
                  <Trans>Discard draft</Trans>
                </Button.Label>
              </Button>
            </View>
          </Section>
        ) : null}
      </Page>
    </Container>
  );
}
