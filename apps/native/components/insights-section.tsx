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
import { Button } from "heroui-native";
import { Sparkles, X } from "lucide-react-native";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  Details,
  Icon,
  InfoTip,
  Prose,
  Ring,
  Section,
  Sheet,
  StatusPill,
  ToneIcon,
} from "@/components/bloom";
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
        <Text className="font-sans text-sm text-ink-3">{t`Loading insights…`}</Text>
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
      return i18n._(describePushRegistration(registration));
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
  const model = insights.data ? insightsSectionModel(i18n, insights.data) : null;

  const readyNote = ready?.withheldExplanation ?? ready?.coverageText ?? null;
  const progressNote = progress?.withheldExplanation ?? progress?.coverageText ?? null;

  return (
    <View className="gap-7">
      <Section
        title={i18n._(INSIGHT_COPY.summariesTitle)}
        actions={
          <Pressable
            onPress={() => router.push("/scores")}
            accessibilityRole="link"
            className="min-h-11 justify-center"
          >
            <Text className="font-display text-sm font-medium text-ink underline">
              {i18n._(INSIGHT_COPY.summariesLink)}
            </Text>
          </Pressable>
        }
      >
        {[
          {
            key: "readiness",
            tone: "sleep" as const,
            title: ready?.title ?? t`Readiness index`,
            badge: ready?.badge,
            score: ready?.scoreText ?? "—",
            label: ready?.accessibilityLabel ?? t`Readiness index not loaded.`,
            note: readyNote,
            flagged: null,
          },
          {
            key: "goals",
            tone: "weight" as const,
            title: progress?.title ?? t`Goal progress`,
            badge: undefined,
            score: progress?.scoreText ?? "—",
            label: progress?.accessibilityLabel ?? t`Goal progress not loaded.`,
            note: progressNote,
            flagged: progress?.flaggedText ?? null,
          },
        ].map((summary) => (
          <Sheet key={summary.key} className="gap-2 p-4">
            <View className="flex-row items-center gap-4">
              <Ring value={(Number.parseFloat(summary.score) || 0) / 100} tone={summary.tone} />
              <View className="min-w-0 flex-1 gap-1">
                <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
                  <Text className="shrink font-sans text-[15px] font-semibold text-ink-2">
                    {summary.title}
                  </Text>
                  {summary.badge ? <StatusPill tone="neutral">{summary.badge}</StatusPill> : null}
                  {summary.note ? (
                    <InfoTip title={summary.title}>
                      <Prose>{summary.note}</Prose>
                    </InfoTip>
                  ) : null}
                </View>
                <View accessible accessibilityLabel={summary.label}>
                  <Text
                    className="font-display text-[32px] font-medium leading-[38px] text-ink"
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    {summary.score}
                  </Text>
                </View>
              </View>
            </View>
            {summary.flagged ? (
              <Text className="font-sans text-sm text-ink-2">{summary.flagged}</Text>
            ) : null}
          </Sheet>
        ))}
      </Section>

      <Section
        title={i18n._(INSIGHT_COPY.sectionTitle)}
        info={
          <>
            <Prose>{i18n._(INSIGHT_COPY.sectionIntro)}</Prose>
            <Prose>{model?.method ?? i18n._(INSIGHT_COPY.methodText)}</Prose>
            <Prose>{model?.limits ?? i18n._(INSIGHT_COPY.limits)}</Prose>
            {model?.footnotes.map((note) => (
              <Prose key={note}>{note}</Prose>
            ))}
            {model ? <Prose className="text-sm text-ink-3">{model.versionText}</Prose> : null}
          </>
        }
      >
        <Sheet className="gap-2.5 p-3">
          {insights.isPending ? (
            <Text className="px-2 py-1 font-sans text-sm text-ink-3">{t`Loading…`}</Text>
          ) : insights.isError || !model ? (
            <Pressable
              onPress={() => void insights.refetch()}
              accessibilityRole="button"
              className="min-h-11 justify-center px-2"
            >
              <Text className="font-sans text-sm text-ink underline">
                {t`Could not load insights. Retry`}
              </Text>
            </Pressable>
          ) : (
            <>
              {model.notices.map((note) => (
                <Text key={note} className="px-2 py-1 font-sans text-base text-ink-2">
                  {note}
                </Text>
              ))}
              {model.rows.map((row) => (
                <View key={row.key} className="flex-row gap-3 rounded-2xl bg-paper-2/60 p-4">
                  <ToneIcon icon={Sparkles} tone="signal" size="sm" />
                  <View className="min-w-0 flex-1 gap-1">
                    <View className="flex-row items-start gap-1">
                      <View
                        accessible
                        accessibilityLabel={row.accessibilityLabel}
                        className="min-w-0 flex-1 gap-1"
                      >
                        <Text
                          className="pt-0.5 font-display text-base font-semibold leading-snug text-ink"
                          accessibilityRole="header"
                        >
                          {row.title}
                        </Text>
                        <Text className="font-sans text-[15px] leading-relaxed text-ink-2">
                          {row.body}
                        </Text>
                      </View>
                      <InfoTip title={row.title}>
                        {row.details.map((line) => (
                          <Prose key={line}>{line}</Prose>
                        ))}
                        <Prose className="text-sm text-ink-3">{row.kindLabel}</Prose>
                        <Prose className="text-sm text-ink-3">{row.ruleText}</Prose>
                      </InfoTip>
                    </View>
                    <View className="-ml-3 flex-row flex-wrap items-center">
                      <Button
                        size="sm"
                        variant="ghost"
                        isDisabled={pendingId === row.key}
                        accessibilityLabel={i18n._(INSIGHT_COPY.dismissLabel(row.title))}
                        onPress={() => {
                          setPendingId(row.key);
                          feedback.mutate({ insightId: row.key, action: "dismiss" });
                        }}
                      >
                        <Icon icon={X} size={15} color="ink-2" />
                        <Button.Label className="text-ink-2">
                          {i18n._(INSIGHT_COPY.dismiss)}
                        </Button.Label>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        isDisabled={pendingId === row.key}
                        accessibilityLabel={i18n._(INSIGHT_COPY.notUsefulLabel(row.title))}
                        onPress={() => {
                          setPendingId(row.key);
                          feedback.mutate({ insightId: row.key, action: "not_useful" });
                        }}
                      >
                        <Button.Label className="text-ink-2">
                          {i18n._(INSIGHT_COPY.notUseful)}
                        </Button.Label>
                      </Button>
                      {consent.data?.granted ? (
                        <Button size="sm" variant="ghost" onPress={() => router.push("/coach")}>
                          <Button.Label className="text-ink">
                            {i18n._(INSIGHT_COPY.askCoach)}
                          </Button.Label>
                        </Button>
                      ) : null}
                    </View>
                  </View>
                </View>
              ))}
              {model.notReady.length > 0 ? (
                <View className="border-t border-rule px-2 pt-1">
                  <Details summary={model.notReadyTitle}>
                    {model.notReady.map((row) => (
                      <Text key={row.key} className="font-sans text-sm text-ink-2">
                        {row.text}
                      </Text>
                    ))}
                  </Details>
                </View>
              ) : null}
            </>
          )}
        </Sheet>
      </Section>

      <Section
        title={t`Nutrition observations`}
        info={
          <Prose>
            {t({
              message:
                "Optional descriptions of how your recorded meals line up in time with recorded sleep and workouts. This reads across those logs only when you turn it on. It does not establish a cause or provide health advice. You can turn it off here without changing either log.",
              comment: "safety",
            })}
          </Prose>
        }
      >
        <Sheet className="gap-3 p-4">
          {observationPrefs.isPending ? (
            <Text accessibilityRole="alert" className="font-sans text-sm text-ink-3">
              {t`Loading observation setting…`}
            </Text>
          ) : observationPrefs.isError || !observationPrefs.data ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t`Retry loading observation setting`}
              onPress={() => void observationPrefs.refetch()}
            >
              <Text className="font-sans text-sm text-ink underline">{t`Could not load setting. Retry`}</Text>
            </Pressable>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
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
            <Text accessibilityRole="alert" className="font-sans text-sm text-ink">
              {t`Could not save this choice. Your saved setting is unchanged.`}
            </Text>
          ) : null}
          {observation.isError && typeof observation.variables === "boolean" ? (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onPress={() => observation.mutate(observation.variables!)}
            >
              <Button.Label>{t`Retry saving choice`}</Button.Label>
            </Button>
          ) : null}
          {showObservations && insights.data?.observations.length === 0 ? (
            <Text className="font-sans text-sm text-ink-3">
              {t`No observations to show for this period. Some records may be missing or incomplete.`}
            </Text>
          ) : null}
          {showObservations
            ? insights.data?.observations.map((item) => {
                const view = nutritionObservationView(i18n, item);
                return (
                  <View
                    key={`${item.ruleId}:${item.window.from}`}
                    accessible
                    accessibilityLabel={view.accessibilityLabel}
                    className="gap-1 border-t border-rule pt-3"
                  >
                    <Text
                      accessibilityRole="header"
                      className="font-display text-base font-semibold text-ink"
                    >
                      {view.title}
                    </Text>
                    <Text className="font-sans text-sm text-ink">{view.body}</Text>
                    <Text className="font-sans text-sm text-ink-3">{view.completeness}</Text>
                    <Text className="font-sans text-sm text-ink-3">{view.period}</Text>
                  </View>
                );
              })
            : null}
          {showObservations ? (
            <Text className="font-sans text-sm text-ink-3">
              {t({
                message: "Observations describe recorded timing only. They are not medical advice.",
                comment: "safety",
              })}
            </Text>
          ) : (
            <Text className="font-sans text-sm text-ink-3">
              {t`Off by default. No nutrition observations are shown.`}
            </Text>
          )}
        </Sheet>
      </Section>

      {insights.data?.offerPush ? (
        <Section title={i18n._(INSIGHT_DELIVERY_COPY.pushOfferTitle)}>
          <Sheet className="gap-3 p-4">
            <Text className="font-sans text-sm text-ink-2">
              {i18n._(INSIGHT_DELIVERY_COPY.pushOfferBody)}
            </Text>
            <View className="flex-row flex-wrap gap-3">
              <Button isDisabled={offer.isPending} onPress={() => offer.mutate("accepted")}>
                <Button.Label>{i18n._(INSIGHT_DELIVERY_COPY.pushOfferAccept)}</Button.Label>
              </Button>
              <Button
                variant="ghost"
                isDisabled={offer.isPending}
                onPress={() => offer.mutate("declined")}
              >
                <Button.Label className="text-ink-2">
                  {i18n._(INSIGHT_DELIVERY_COPY.pushOfferDecline)}
                </Button.Label>
              </Button>
            </View>
          </Sheet>
        </Section>
      ) : null}
      {message ? (
        <Text className="font-sans text-sm text-ink" accessibilityRole="alert">
          {message}
        </Text>
      ) : null}
    </View>
  );
}
