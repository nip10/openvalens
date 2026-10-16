import type { InsightFeedbackAction } from "@openvalens/api/insight-contract";
import { INSIGHT_COPY, INSIGHT_DELIVERY_COPY } from "@openvalens/api/presenters/insights";
import { goalProgressView, readinessView } from "@openvalens/api/presenters/score";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card } from "heroui-native";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { describePushRegistration, enablePushOnThisPhone } from "@/lib/push-notifications";
import { insightsSectionModel } from "@/utils/insight-screen";
import { client, orpc } from "@/utils/orpc";

/**
 * Issue #92 — cockpit parity with the web dashboard: the two #95 summaries,
 * then the deterministic insights with dismiss / "Not useful", the
 * not-enough-data rows and the in-context push offer. Same view models as web
 * (`utils/insight-screen.ts`). Every state is text; controls are buttons with
 * accessible labels.
 */
export function InsightsSection() {
  const queryClient = useQueryClient();
  const readiness = useQuery(orpc.score.readiness.queryOptions({ input: {} }));
  const goals = useQuery(orpc.score.goalProgress.queryOptions({ input: {} }));
  const insights = useQuery(orpc.insights.list.queryOptions({ input: {} }));
  const consent = useQuery({ ...orpc.ai.consent.get.queryOptions({ input: {} }), retry: false });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showMethod, setShowMethod] = useState(false);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: orpc.insights.key() });

  const feedback = useMutation({
    mutationFn: (input: { insightId: string; action: InsightFeedbackAction }) =>
      client.insights.feedback(input),
    onSettled: () => {
      setPendingId(null);
      invalidate();
    },
    onError: () => setMessage("Could not save your feedback."),
  });
  const offer = useMutation({
    mutationFn: async (answer: "accepted" | "declined") => {
      if (answer === "declined") {
        await client.insights.preferences.update({ pushOffer: "declined" });
        return null;
      }
      const registration = await enablePushOnThisPhone();
      await client.insights.preferences.update({ pushOffer: "accepted" });
      return describePushRegistration(registration);
    },
    onSuccess: (text) => {
      setMessage(text);
      invalidate();
    },
    onError: () => setMessage("Could not save your choice."),
  });

  const ready = readiness.data ? readinessView(readiness.data) : null;
  const progress = goals.data ? goalProgressView(goals.data) : null;
  const model = insights.data ? insightsSectionModel(insights.data) : null;

  return (
    <View className="gap-6">
      <CardStack title={INSIGHT_COPY.summariesTitle}>
        <Card variant="secondary" className="gap-3 p-4">
          {[
            {
              key: "readiness",
              title: ready?.title ?? "Readiness index",
              badge: ready?.badge,
              score: ready?.scoreText ?? "—",
              label: ready?.accessibilityLabel ?? "Readiness index not loaded.",
              note: ready?.withheldExplanation ?? ready?.coverageText ?? null,
            },
            {
              key: "goals",
              title: progress?.title ?? "Goal progress",
              badge: undefined,
              score: progress?.scoreText ?? "—",
              label: progress?.accessibilityLabel ?? "Goal progress not loaded.",
              note: progress?.withheldExplanation ?? progress?.coverageText ?? null,
            },
          ].map((summary) => (
            <View key={summary.key} className="gap-1" accessible accessibilityLabel={summary.label}>
              <Text className="text-xs text-muted-foreground">
                {summary.title}
                {summary.badge ? ` · ${summary.badge}` : ""}
              </Text>
              <Text className="font-mono text-2xl text-foreground">{summary.score}</Text>
              {summary.note ? (
                <Text className="text-xs text-muted-foreground">{summary.note}</Text>
              ) : null}
            </View>
          ))}
          <Pressable
            onPress={() => router.push("/scores")}
            accessibilityRole="link"
            className="min-h-11 justify-center"
          >
            <Text className="font-medium text-foreground underline">
              {INSIGHT_COPY.summariesLink}
            </Text>
          </Pressable>
        </Card>
      </CardStack>

      <CardStack title={INSIGHT_COPY.sectionTitle}>
        <Card variant="secondary" className="gap-3 p-4">
          <Text className="text-sm text-muted-foreground">{INSIGHT_COPY.sectionIntro}</Text>
          {insights.isPending ? (
            <Text className="text-sm text-muted-foreground">Loading…</Text>
          ) : insights.isError || !model ? (
            <Pressable
              onPress={() => void insights.refetch()}
              accessibilityRole="button"
              className="min-h-11 justify-center"
            >
              <Text className="text-sm text-foreground underline">
                Could not load insights. Retry
              </Text>
            </Pressable>
          ) : (
            <>
              {model.rows.map((row) => (
                <View key={row.key} className="gap-1 border-t border-border pt-3">
                  <View accessible accessibilityLabel={row.accessibilityLabel} className="gap-1">
                    <Text className="text-xs text-muted-foreground">{row.kindLabel}</Text>
                    <Text
                      className="text-base font-medium text-foreground"
                      accessibilityRole="header"
                    >
                      {row.title}
                    </Text>
                    {row.lines.map((line) => (
                      <Text key={line} className="text-sm text-foreground">
                        {line}
                      </Text>
                    ))}
                    <Text className="text-xs text-muted-foreground">{row.ruleText}</Text>
                  </View>
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      isDisabled={pendingId === row.key}
                      accessibilityLabel={`${INSIGHT_COPY.dismiss}: ${row.title}`}
                      onPress={() => {
                        setPendingId(row.key);
                        feedback.mutate({ insightId: row.key, action: "dismiss" });
                      }}
                    >
                      <Button.Label>{INSIGHT_COPY.dismiss}</Button.Label>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      isDisabled={pendingId === row.key}
                      accessibilityLabel={`${INSIGHT_COPY.notUseful}: ${row.title}. ${INSIGHT_COPY.notUsefulHint}`}
                      onPress={() => {
                        setPendingId(row.key);
                        feedback.mutate({ insightId: row.key, action: "not_useful" });
                      }}
                    >
                      <Button.Label>{INSIGHT_COPY.notUseful}</Button.Label>
                    </Button>
                    {consent.data?.granted ? (
                      <Button size="sm" variant="ghost" onPress={() => router.push("/coach")}>
                        <Button.Label>{INSIGHT_COPY.askCoach}</Button.Label>
                      </Button>
                    ) : null}
                  </View>
                </View>
              ))}
              {model.notes.map((note) => (
                <Text key={note} className="text-sm text-muted-foreground">
                  {note}
                </Text>
              ))}
              {model.notReady.length > 0 ? (
                <View className="gap-1">
                  <Text className="text-sm font-medium text-foreground">{model.notReadyTitle}</Text>
                  {model.notReady.map((row) => (
                    <Text key={row.key} className="text-sm text-muted-foreground">
                      {row.text}
                    </Text>
                  ))}
                </View>
              ) : null}
              <Pressable
                onPress={() => setShowMethod((open) => !open)}
                accessibilityRole="button"
                accessibilityState={{ expanded: showMethod }}
                className="min-h-11 justify-center"
              >
                <Text className="font-medium text-foreground underline">{INSIGHT_COPY.method}</Text>
              </Pressable>
              {showMethod ? (
                <Text className="text-sm text-muted-foreground">{model.method}</Text>
              ) : null}
              <Text className="text-sm text-muted-foreground">{model.limits}</Text>
              <Text className="text-xs text-muted-foreground">{model.versionText}</Text>
            </>
          )}
        </Card>
      </CardStack>

      {insights.data?.offerPush ? (
        <CardStack title={INSIGHT_DELIVERY_COPY.pushOfferTitle}>
          <Card variant="secondary" className="gap-3 p-4">
            <Text className="text-sm text-foreground">{INSIGHT_DELIVERY_COPY.pushOfferBody}</Text>
            <View className="flex-row flex-wrap gap-3">
              <Button isDisabled={offer.isPending} onPress={() => offer.mutate("accepted")}>
                <Button.Label>{INSIGHT_DELIVERY_COPY.pushOfferAccept}</Button.Label>
              </Button>
              <Button
                variant="secondary"
                isDisabled={offer.isPending}
                onPress={() => offer.mutate("declined")}
              >
                <Button.Label>{INSIGHT_DELIVERY_COPY.pushOfferDecline}</Button.Label>
              </Button>
            </View>
          </Card>
        </CardStack>
      ) : null}
      {message ? (
        <Text className="text-sm text-foreground" accessibilityRole="alert">
          {message}
        </Text>
      ) : null}
    </View>
  );
}
