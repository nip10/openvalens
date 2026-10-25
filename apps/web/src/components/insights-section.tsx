import { Trans, useLingui } from "@lingui/react/macro";
import type { InsightFeedbackAction } from "@openvalens/api/insight-contract";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import {
  INSIGHT_COPY,
  nutritionObservationView,
  observationPreferencePatch,
  privateInsightsQueryKey,
  privateInsightsSubject,
  shouldShowObservations,
} from "@openvalens/api/presenters/insights";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ErrorState, InfoTip } from "@/components/page";
import { orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";
import { authClient } from "@/lib/auth-client";

import { InsightsCard, PushOfferCard, SummaryCards } from "./insights-panel";
import { Button } from "@openvalens/ui/components/button";

/**
 * Issue #92 — connected dashboard section: the two summaries first, then the
 * insights. Each part loads on its own; none waits for AI, nutrition or
 * messaging. The coach hand-off shows only when the person has AI consent.
 */
export function InsightsSection() {
  const { data: session, isPending } = authClient.useSession();
  const scope = privateInsightsSubject(
    isPending,
    session?.user?.id,
    session?.session?.activeOrganizationId ?? null,
  );
  if (!scope)
    return (
      <p role="status" className="text-sm text-ink-3">
        <Trans>Loading insights…</Trans>
      </p>
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
  const readiness = useQuery({
    ...orpc.score.readiness.queryOptions({ input: {} }),
    queryKey: privateInsightsQueryKey(
      orpc.score.readiness.queryOptions({ input: {} }).queryKey,
      userId,
      organizationId,
    ),
    staleTime: 60_000,
  });
  const goals = useQuery({
    ...orpc.score.goalProgress.queryOptions({ input: {} }),
    queryKey: privateInsightsQueryKey(
      orpc.score.goalProgress.queryOptions({ input: {} }).queryKey,
      userId,
      organizationId,
    ),
    staleTime: 60_000,
  });
  const insights = useQuery({
    ...orpc.insights.list.queryOptions({ input: {} }),
    queryKey: privateInsightsQueryKey(
      orpc.insights.list.queryOptions({ input: {} }).queryKey,
      userId,
      organizationId,
    ),
    staleTime: 60_000,
  });
  const observationPrefsOptions = orpc.insights.preferences.get.queryOptions({ input: {} });
  const observationPrefs = useQuery({
    ...observationPrefsOptions,
    queryKey: privateInsightsQueryKey(observationPrefsOptions.queryKey, userId, organizationId),
  });
  const consentOptions = orpc.ai.consent.get.queryOptions({ input: {} });
  const consent = useQuery({
    ...consentOptions,
    queryKey: privateInsightsQueryKey(consentOptions.queryKey, userId, organizationId),
    retry: false,
  });
  const settings = useProductSettings().data;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [hideObservations, setHideObservations] = useState(false);
  useEffect(() => {
    if (observationPrefs.data?.channels.observation.in_app === false) setHideObservations(false);
  }, [observationPrefs.data?.channels.observation.in_app]);
  const insightsKey = privateInsightsQueryKey(
    orpc.insights.list.queryOptions({ input: {} }).queryKey,
    userId,
    organizationId,
  );
  const preferencesKey = privateInsightsQueryKey(
    observationPrefsOptions.queryKey,
    userId,
    organizationId,
  );
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: insightsKey });

  const feedback = useMutation(
    orpc.insights.feedback.mutationOptions({
      onSettled: () => {
        setPendingId(null);
        invalidate();
      },
      onError: () => toast.error(t`Could not save your feedback.`),
    }),
  );
  const offer = useMutation(
    orpc.insights.preferences.update.mutationOptions({
      onSuccess: (_data, variables) => {
        invalidate();
        if (variables.pushOffer === "accepted") toast.success(t`Insight notifications turned on`);
      },
      onError: () => toast.error(t`Could not save your choice.`),
    }),
  );
  const observation = useMutation(
    orpc.insights.preferences.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: insightsKey });
        void queryClient.invalidateQueries({ queryKey: preferencesKey });
      },
      onError: () =>
        toast.error(
          t`Could not update observation settings. Your saved choice is unchanged; retry when connected.`,
        ),
    }),
  );
  const showObservations = shouldShowObservations(
    observationPrefs.data?.channels.observation.in_app,
    hideObservations,
    observationPrefs.isSuccess &&
      !observationPrefs.isFetching &&
      insights.isSuccess &&
      !insights.isFetching,
    observation.isError,
  );

  const onFeedback = (insightId: string, action: InsightFeedbackAction) => {
    setPendingId(insightId);
    feedback.mutate({ insightId, action });
  };

  return (
    <div className="grid gap-8">
      {readiness.isPending || goals.isPending ? (
        <div className="grid gap-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <SummaryCards
          readiness={readiness.data ?? null}
          goals={goals.data ?? null}
          scoresLink={
            <Link
              to="/scores"
              className="font-display text-sm font-medium text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {i18n._(INSIGHT_COPY.summariesLink)}
            </Link>
          }
        />
      )}
      {insights.isPending ? (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : insights.isError || !insights.data ? (
        <ErrorState
          title={<Trans>Could not load insights.</Trans>}
          action={
            <Button variant="outline" size="sm" onClick={() => void insights.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      ) : (
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <InsightsCard
            result={insights.data}
            settings={settings}
            pendingId={pendingId}
            coachLink={
              consent.data?.granted === true ? (
                <Link
                  to="/coach"
                  className="font-display text-sm font-medium text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {i18n._(INSIGHT_COPY.askCoach)}
                </Link>
              ) : null
            }
            onFeedback={onFeedback}
          />
          <div className="grid min-w-0 content-start gap-8">
            <section
              aria-labelledby="observation-title"
              className="grid min-w-0 content-start gap-3"
            >
              <div className="flex items-center gap-2">
                <h2 id="observation-title" className="text-xl leading-tight text-ink">
                  <Trans>Nutrition observations</Trans>
                </h2>
                <InfoTip align="end">
                  <p>
                    <Trans comment="safety">
                      Optional descriptions of how your recorded meals line up in time with recorded
                      sleep and workouts. This reads across those logs only when you turn it on. It
                      does not establish a cause or provide health advice. You can turn it off here
                      without changing either log.
                    </Trans>
                  </p>
                </InfoTip>
              </div>
              <div className="sheet grid gap-3 px-5 py-4">
                {observationPrefs.isPending ? (
                  <p role="status" className="text-sm text-ink-3">
                    <Trans>Loading observation setting…</Trans>
                  </p>
                ) : observationPrefs.isError || !observationPrefs.data ? (
                  <Button
                    variant="link"
                    className="w-fit"
                    onClick={() => void observationPrefs.refetch()}
                  >
                    <Trans>Could not load observation setting. Retry</Trans>
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="w-fit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    disabled={observation.isPending}
                    aria-label={
                      observationPrefs.data.channels.observation.in_app
                        ? t`Turn off nutrition observations`
                        : t`Turn on nutrition observations`
                    }
                    onClick={() => {
                      const enabled = !observationPrefs.data!.channels.observation.in_app;
                      if (!enabled) setHideObservations(true);
                      observation.mutate(observationPreferencePatch(enabled));
                    }}
                  >
                    {observationPrefs.data.channels.observation.in_app ? (
                      <Trans>Turn observations off</Trans>
                    ) : (
                      <Trans>Turn observations on</Trans>
                    )}
                  </Button>
                )}
                {observation.isError ? (
                  <p role="alert" className="text-sm text-destructive">
                    <Trans>Could not save this choice. Your saved setting is unchanged.</Trans>
                  </p>
                ) : null}
                {observation.isError && observation.variables ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => observation.mutate(observation.variables)}
                  >
                    <Trans>Retry saving choice</Trans>
                  </Button>
                ) : null}
                {showObservations && insights.data.observations.length === 0 ? (
                  <p className="text-sm text-ink-3">
                    <Trans>
                      No observations to show for this period. Some records may be missing or
                      incomplete.
                    </Trans>
                  </p>
                ) : null}
                {showObservations
                  ? insights.data.observations.map((item) =>
                      (() => {
                        const view = nutritionObservationView(i18n, item);
                        return (
                          <article
                            key={`${item.ruleId}:${item.window.from}`}
                            className="grid gap-1 border-t border-rule pt-3"
                            aria-label={view.accessibilityLabel}
                          >
                            <h3 className="text-base leading-snug text-ink">{view.title}</h3>
                            <p className="text-ink-2">{view.body}</p>
                            <p className="text-sm text-ink-3">{view.completeness}</p>
                            <p className="text-sm text-ink-3">{view.period}</p>
                          </article>
                        );
                      })(),
                    )
                  : null}
                {showObservations ? (
                  <p className="text-sm text-ink-3">
                    <Trans comment="safety">
                      Observations describe recorded timing only. They are not medical advice.
                    </Trans>
                  </p>
                ) : (
                  <p className="text-sm text-ink-3">
                    <Trans>Off by default. No nutrition observations are shown.</Trans>
                  </p>
                )}
              </div>
            </section>
            {insights.data.offerPush ? (
              <PushOfferCard
                pending={offer.isPending}
                onAnswer={(answer) => offer.mutate({ pushOffer: answer })}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
