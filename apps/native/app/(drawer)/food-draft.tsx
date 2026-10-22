import type { FoodDraftCandidateWire } from "@openvalens/api/contracts/nutrition-food-drafts";
import { FOOD_DRAFT_COPY, FOOD_DRAFT_FLAG_LABELS } from "@openvalens/api/presenters/food-draft";
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

export default function FoodDraftScreen() {
  const router = useRouter();
  const [transcript, setTranscript] = useState("");
  const [useAi, setUseAi] = useState(false);
  const [aiAgreed, setAiAgreed] = useState(false);
  const [candidates, setCandidates] = useState<FoodDraftCandidateWire[] | null>(null);
  const [message, setMessage] = useState("");
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
    onError: () => setMessage("Could not make a draft. Nothing was saved."),
  });

  return (
    <Container className="p-4">
      <View className="gap-6">
        <View className="gap-2">
          <Text accessibilityRole="header" className="font-mono text-3xl text-foreground">
            Describe a meal
          </Text>
          <Text className="text-sm text-muted-foreground">{FOOD_DRAFT_COPY.intro}</Text>
        </View>
        <Card variant="secondary" className="gap-3 p-4">
          <TextInput
            value={transcript}
            onChangeText={setTranscript}
            multiline
            maxLength={2000}
            textAlignVertical="top"
            placeholder="Two eggs, a slice of toast and a coffee"
            accessibilityLabel="What did you have?"
            className={`${INPUT} min-h-28`}
            placeholderTextColor="#9ca3af"
          />
          <Text className="text-xs text-muted-foreground">{FOOD_DRAFT_COPY.dictation}</Text>
          {provider.data?.available ? (
            <View className="gap-2 rounded-lg border border-border p-3">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="flex-1 text-sm text-foreground">
                  Use the AI provider for this draft
                </Text>
                <Switch
                  value={useAi}
                  onValueChange={(value) => {
                    setUseAi(value);
                    setAiAgreed(false);
                  }}
                  accessibilityLabel="Use the AI provider for this draft"
                />
              </View>
              {useAi ? (
                <View className="flex-row items-center justify-between gap-3">
                  <Text className="flex-1 text-sm text-foreground">
                    Send this text, and nothing else, to {provider.data.provider}
                    {provider.data.host ? ` (${provider.data.host})` : ""} now.{" "}
                    {FOOD_DRAFT_COPY.aiDisclosure}
                  </Text>
                  <Switch
                    value={aiAgreed}
                    onValueChange={setAiAgreed}
                    accessibilityLabel="Agree to send this text to the AI provider now"
                  />
                </View>
              ) : null}
            </View>
          ) : null}
          <Button
            isDisabled={!transcript.trim() || (useAi && !aiAgreed) || parse.isPending}
            onPress={() => parse.mutate()}
          >
            {parse.isPending ? "Working…" : "Make a draft"}
          </Button>
          {message ? (
            <Text accessibilityLiveRegion="polite" className="text-sm text-muted-foreground">
              {message}
            </Text>
          ) : null}
        </Card>

        {candidates ? (
          <CardStack title="Review the draft">
            <Card variant="secondary" className="gap-3 p-4">
              <Text className="text-sm text-muted-foreground">{FOOD_DRAFT_COPY.review}</Text>
              {candidates.map((item, index) => (
                <View key={item.id} className="gap-2 rounded-lg border border-border p-3">
                  <Text className="text-sm font-medium text-foreground">
                    Item {index + 1} · heard “{item.sourceText}”
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
                    accessibilityLabel={`Food for item ${index + 1}`}
                    className={INPUT}
                  />
                  <Text className="text-sm text-muted-foreground">
                    {item.quantityText ?? "No quantity"} · {item.unitText ?? "no unit"}
                  </Text>
                  {item.flags.length ? (
                    <Text className="text-sm text-foreground">
                      {item.flags.map((flag) => FOOD_DRAFT_FLAG_LABELS[flag]).join(" · ")}
                    </Text>
                  ) : null}
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      size="sm"
                      onPress={() =>
                        router.push({ pathname: "/nutrition", params: { food: item.foodText } })
                      }
                    >
                      Find and log this food
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
                      Remove
                    </Button>
                  </View>
                </View>
              ))}
              <Button
                variant="secondary"
                onPress={() => {
                  setCandidates(null);
                  setMessage("Draft discarded. Nothing was saved.");
                }}
              >
                Discard draft
              </Button>
            </Card>
          </CardStack>
        ) : null}
      </View>
    </Container>
  );
}
