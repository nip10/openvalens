import { Trans, useLingui } from "@lingui/react/macro";
import { SCORE_COPY } from "@openvalens/api/presenters/score";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { ErrorState, Page, PageHeader } from "@/components/page";
import { ReferenceComparisonsSection } from "@/components/reference-comparisons-card";
import { GoalProgressCard, ReadinessCard } from "@/components/score-panels";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/scores")({
  component: ScoresPage,
});

/**
 * Issue #95 — "How am I doing?": the experimental readiness index and goal
 * progress, side by side and never combined. Both are computed on the server
 * from the workspace's records on every request; nothing is cached offline.
 * Issue #96 adds opt-in reference comparisons below them (own trend first).
 */
function ScoresPage() {
  const { i18n } = useLingui();
  const readiness = useQuery({
    ...orpc.score.readiness.queryOptions({ input: {} }),
    staleTime: 60_000,
  });
  const goals = useQuery({
    ...orpc.score.goalProgress.queryOptions({ input: {} }),
    staleTime: 60_000,
  });

  return (
    <Page>
      <PageHeader
        title={i18n._(SCORE_COPY.pageTitle)}
        description={
          <>
            {i18n._(SCORE_COPY.pageIntro)}
            <span className="mt-1 block text-sm">{i18n._(SCORE_COPY.noStorage)}</span>
          </>
        }
      />

      <div className="grid items-start gap-10 lg:grid-cols-2">
        {readiness.isPending ? (
          <ScoreSkeleton />
        ) : readiness.isError || !readiness.data ? (
          <ErrorState
            title={<Trans>Could not load the readiness index.</Trans>}
            action={
              <Button variant="outline" size="sm" onClick={() => void readiness.refetch()}>
                <Trans>Retry</Trans>
              </Button>
            }
          />
        ) : (
          <ReadinessCard result={readiness.data} />
        )}

        {goals.isPending ? (
          <ScoreSkeleton />
        ) : goals.isError || !goals.data ? (
          <ErrorState
            title={<Trans>Could not load goal progress.</Trans>}
            action={
              <Button variant="outline" size="sm" onClick={() => void goals.refetch()}>
                <Trans>Retry</Trans>
              </Button>
            }
          />
        ) : (
          <GoalProgressCard result={goals.data} />
        )}
      </div>

      <ReferenceComparisonsSection />

      <p className="border-t border-rule pt-4 text-sm text-ink-3">
        <Trans>
          Set targets, directions and priorities for your goals under{" "}
          <Link
            to="/workouts"
            className="text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Workouts
          </Link>
          .
        </Trans>
      </p>
    </Page>
  );
}

function ScoreSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}
