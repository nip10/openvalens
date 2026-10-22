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

import { orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";
import { authClient } from "@/lib/auth-client";

import { InsightsCard, PushOfferCard, SummaryCards } from "./insights-panel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";
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
  if (!scope) return <p className="text-sm text-muted-foreground">Loading insights…</p>;
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
      onError: () => toast.error("Could not save your feedback."),
    }),
  );
  const offer = useMutation(
    orpc.insights.preferences.update.mutationOptions({
      onSuccess: (_data, variables) => {
        invalidate();
        if (variables.pushOffer === "accepted") toast.success("Insight notifications turned on");
      },
      onError: () => toast.error("Could not save your choice."),
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
          "Could not update observation settings. Your saved choice is unchanged; retry when connected.",
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
    <div className="grid gap-6">
      {readiness.isPending || goals.isPending ? (
        <Skeleton className="h-36 w-full" />
      ) : (
        <SummaryCards
          readiness={readiness.data ?? null}
          goals={goals.data ?? null}
          scoresLink={
            <Link to="/scores" className="text-sm text-muted-foreground underline">
              {INSIGHT_COPY.summariesLink}
            </Link>
          }
        />
      )}
      {insights.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : insights.isError || !insights.data ? (
        <p className="text-sm text-muted-foreground">
          Could not load insights.{" "}
          <button className="underline" onClick={() => void insights.refetch()}>
            Retry
          </button>
        </p>
      ) : (
        <>
          <InsightsCard
            result={insights.data}
            settings={settings}
            pendingId={pendingId}
            coachLink={
              consent.data?.granted === true ? (
                <Link to="/coach" className="text-sm underline">
                  {INSIGHT_COPY.askCoach}
                </Link>
              ) : null
            }
            onFeedback={onFeedback}
          />
          <Card aria-labelledby="observation-title">
            <CardHeader>
              <CardTitle id="observation-title">Nutrition observations</CardTitle>
              <CardDescription>
                Optional descriptions of how your recorded meals line up in time with recorded sleep
                and workouts. This reads across those logs only when you turn it on. It does not
                establish a cause or provide health advice. You can turn it off here without
                changing either log.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {observationPrefs.isPending ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Loading observation setting…
                </p>
              ) : observationPrefs.isError || !observationPrefs.data ? (
                <button className="w-fit underline" onClick={() => void observationPrefs.refetch()}>
                  Could not load observation setting. Retry
                </button>
              ) : (
                <Button
                  disabled={observation.isPending}
                  aria-label={
                    observationPrefs.data.channels.observation.in_app
                      ? "Turn off nutrition observations"
                      : "Turn on nutrition observations"
                  }
                  onClick={() => {
                    const enabled = !observationPrefs.data!.channels.observation.in_app;
                    if (!enabled) setHideObservations(true);
                    observation.mutate(observationPreferencePatch(enabled));
                  }}
                >
                  {observationPrefs.data.channels.observation.in_app
                    ? "Turn observations off"
                    : "Turn observations on"}
                </Button>
              )}
              {observation.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  Could not save this choice. Your saved setting is unchanged.
                </p>
              ) : null}
              {observation.isError && observation.variables ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => observation.mutate(observation.variables)}
                >
                  Retry saving choice
                </Button>
              ) : null}
              {showObservations && insights.data.observations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No observations to show for this period. Some records may be missing or
                  incomplete.
                </p>
              ) : null}
              {showObservations
                ? insights.data.observations.map((item) =>
                    (() => {
                      const view = nutritionObservationView(item);
                      return (
                        <article
                          key={`${item.ruleId}:${item.window.from}`}
                          className="grid gap-1 border-t border-border pt-3"
                          aria-label={view.accessibilityLabel}
                        >
                          <h3 className="font-medium">{view.title}</h3>
                          <p className="text-sm">{view.body}</p>
                          <p className="text-sm text-muted-foreground">{view.completeness}</p>
                          <p className="text-xs text-muted-foreground">{view.period}</p>
                        </article>
                      );
                    })(),
                  )
                : null}
              {showObservations ? (
                <p className="text-xs text-muted-foreground">
                  Observations describe recorded timing only. They are not medical advice.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Off by default. No nutrition observations are shown.
                </p>
              )}
            </CardContent>
          </Card>
          {insights.data.offerPush ? (
            <PushOfferCard
              pending={offer.isPending}
              onAnswer={(answer) => offer.mutate({ pushOffer: answer })}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
