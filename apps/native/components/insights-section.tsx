import { useLingui } from "@lingui/react/macro";
import type { InsightFeedbackAction } from "@openvalens/api/insight-contract";
import {
  INSIGHT_COPY,
  INSIGHT_DELIVERY_COPY,
  nutritionObservationView,
  observationPreferencePatch,
  privateInsightsQueryKey,
  privateInsightsSubject,
  shouldShowObservations,
} from "@openvalens/api/presenters/insights";
import { goalProgressView, readinessView } from "@openvalens/api/presenters/score";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card } from "heroui-native";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { describePushRegistration, enablePushOnThisPhone } from "@/lib/push-notifications";
import { insightsSectionModel } from "@/utils/insight-screen";
import { client, orpc } from "@/utils/orpc";
import { authClient } from "@/lib/auth-client";

/**
 * Issue #92 — cockpit parity with the web dashboard: the two #95 summaries,
 * then the deterministic insights with dismiss / "Not useful", the
 * not-enough-data rows and the in-context push offer. Same view models as web
 * (`utils/insight-screen.ts`). Every state is text; controls are buttons with
 * accessible labels.
 */
export function InsightsSection() {
  const { data: session, isPending } = authClient.useSession();
  const { t } = useLingui();
  const scope = privateInsightsSubject(
    isPending,
    session?.user?.id,
    session?.session?.activeOrganizationId ?? null,
  );
  if (!scope)
    return (
      <View>
        <Text>{t`Loading insights…`}</Text>
      </View>
    );
  return (
    <SubjectInsightsSection
      key={`${scope.userId}:${scope.organizationId ?? "personal"}`}
      userId={scope.userId}
      organizationId={scope.organizationId}
    />
  );
}

function SubjectInsightsSection({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string | null;
}) {
  const queryClient = useQueryClient();
  const { t, i18n } = useLingui();
  const readinessOptions = orpc.score.readiness.queryOptions({ input: {} });
  const goalsOptions = orpc.score.goalProgress.queryOptions({ input: {} });
  const insightsOptions = orpc.insights.list.queryOptions({ input: {} });
  const observationPrefsOptions = orpc.insights.preferences.get.queryOptions({ input: {} });
  const consentOptions = orpc.ai.consent.get.queryOptions({ input: {} });
  const readiness = useQuery({
    ...readinessOptions,
    queryKey: privateInsightsQueryKey(readinessOptions.queryKey, userId, organizationId),
  });
  const goals = useQuery({
    ...goalsOptions,
    queryKey: privateInsightsQueryKey(goalsOptions.queryKey, userId, organizationId),
  });
  const insights = useQuery({
    ...insightsOptions,
    queryKey: privateInsightsQueryKey(insightsOptions.queryKey, userId, organizationId),
  });
  const observationPrefs = useQuery({
    ...observationPrefsOptions,
    queryKey: privateInsightsQueryKey(observationPrefsOptions.queryKey, userId, organizationId),
  });
  const consent = useQuery({
    ...consentOptions,
    queryKey: privateInsightsQueryKey(consentOptions.queryKey, userId, organizationId),
    retry: false,
  });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showMethod, setShowMethod] = useState(false);
  const [hideObservations, setHideObservations] = useState(false);
  useEffect(() => {
    if (observationPrefs.data?.channels.observation.in_app === false) setHideObservations(false);
  }, [observationPrefs.data?.channels.observation.in_app]);
  const insightsKey = privateInsightsQueryKey(insightsOptions.queryKey, userId, organizationId);
  const preferencesKey = privateInsightsQueryKey(
    observationPrefsOptions.queryKey,
    userId,
    organizationId,
  );
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: insightsKey });

  const feedback = useMutation({
    mutationFn: (input: { insightId: string; action: InsightFeedbackAction }) =>
      client.insights.feedback(input),
    onSettled: () => {
      setPendingId(null);
      invalidate();
    },
    onError: () => setMessage(t`Could not save your feedback.`),
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
    onError: () => setMessage(t`Could not save your choice.`),
  });
  const observation = useMutation({
    mutationFn: (enabled: boolean) =>
      client.insights.preferences.update(observationPreferencePatch(enabled)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: insightsKey });
      void queryClient.invalidateQueries({ queryKey: preferencesKey });
    },
    onError: () => setMessage(t`Could not update observation settings.`),
  });
  const showObservations = shouldShowObservations(
    observationPrefs.data?.channels.observation.in_app,
    hideObservations,
    observationPrefs.isSuccess &&
      !observationPrefs.isFetching &&
      insights.isSuccess &&
      !insights.isFetching,
    observation.isError,
  );

  const ready = readiness.data ? readinessView(readiness.data, i18n) : null;
  const progress = goals.data ? goalProgressView(goals.data, i18n) : null;
  const model = insights.data ? insightsSectionModel(insights.data) : null;

  return (
    <View className="gap-6">
      <CardStack title={INSIGHT_COPY.summariesTitle}>
        <Card variant="secondary" className="gap-3 p-4">
          {[
            {
              key: "readiness",
              title: ready?.title ?? t`Readiness index`,
              badge: ready?.badge,
              score: ready?.scoreText ?? "—",
              label: ready?.accessibilityLabel ?? t`Readiness index not loaded.`,
              note: ready?.withheldExplanation ?? ready?.coverageText ?? null,
            },
            {
              key: "goals",
              title: progress?.title ?? t`Goal progress`,
              badge: undefined,
              score: progress?.scoreText ?? "—",
              label: progress?.accessibilityLabel ?? t`Goal progress not loaded.`,
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
            <Text className="text-sm text-muted-foreground">{t`Loading…`}</Text>
          ) : insights.isError || !model ? (
            <Pressable
              onPress={() => void insights.refetch()}
              accessibilityRole="button"
              className="min-h-11 justify-center"
            >
              <Text className="text-sm text-foreground underline">
                {t`Could not load insights. Retry`}
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

      <CardStack title={t`Nutrition observations`}>
        <Card variant="secondary" className="gap-3 p-4">
          <Text className="text-sm text-muted-foreground">
            {t({
              message:
                "Optional descriptions of how your recorded meals line up in time with recorded sleep and workouts. This reads across those logs only when you turn it on. It does not establish a cause or provide health advice. You can turn it off here without changing either log.",
              comment: "safety",
            })}
          </Text>
          {observationPrefs.isPending ? (
            <Text accessibilityRole="alert" className="text-sm text-muted-foreground">
              {t`Loading observation setting…`}
            </Text>
          ) : observationPrefs.isError || !observationPrefs.data ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t`Retry loading observation setting`}
              onPress={() => void observationPrefs.refetch()}
            >
              <Text className="underline">{t`Could not load setting. Retry`}</Text>
            </Pressable>
          ) : (
            <Button
              isDisabled={observation.isPending}
              accessibilityLabel={
                observationPrefs.data.channels.observation.in_app
                  ? t`Turn off nutrition observations`
                  : t`Turn on nutrition observations`
              }
              onPress={() => {
                const enabled = !observationPrefs.data!.channels.observation.in_app;
                if (!enabled) setHideObservations(true);
                observation.mutate(enabled);
              }}
            >
              <Button.Label>
                {observationPrefs.data.channels.observation.in_app
                  ? t`Turn observations off`
                  : t`Turn observations on`}
              </Button.Label>
            </Button>
          )}
          {observation.isError ? (
            <Text accessibilityRole="alert" className="text-sm text-foreground">
              {t`Could not save this choice. Your saved setting is unchanged.`}
            </Text>
          ) : null}
          {observation.isError && typeof observation.variables === "boolean" ? (
            <Button variant="secondary" onPress={() => observation.mutate(observation.variables!)}>
              <Button.Label>{t`Retry saving choice`}</Button.Label>
            </Button>
          ) : null}
          {showObservations && insights.data?.observations.length === 0 ? (
            <Text className="text-sm text-muted-foreground">
              {t`No observations to show for this period. Some records may be missing or incomplete.`}
            </Text>
          ) : null}
          {showObservations
            ? insights.data?.observations.map((item) => {
                const view = nutritionObservationView(item);
                return (
                  <View
                    key={`${item.ruleId}:${item.window.from}`}
                    accessible
                    accessibilityLabel={view.accessibilityLabel}
                    className="gap-1 border-t border-border pt-3"
                  >
                    <Text accessibilityRole="header" className="font-medium text-foreground">
                      {view.title}
                    </Text>
                    <Text className="text-sm text-foreground">{view.body}</Text>
                    <Text className="text-sm text-muted-foreground">{view.completeness}</Text>
                    <Text className="text-xs text-muted-foreground">{view.period}</Text>
                  </View>
                );
              })
            : null}
          {showObservations ? (
            <Text className="text-xs text-muted-foreground">
              {t({
                message: "Observations describe recorded timing only. They are not medical advice.",
                comment: "safety",
              })}
            </Text>
          ) : (
            <Text className="text-sm text-muted-foreground">
              {t`Off by default. No nutrition observations are shown.`}
            </Text>
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
