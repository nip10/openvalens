import { SCORE_COPY } from "@openvalens/api/presenters/score";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

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
  const readiness = useQuery({
    ...orpc.score.readiness.queryOptions({ input: {} }),
    staleTime: 60_000,
  });
  const goals = useQuery({
    ...orpc.score.goalProgress.queryOptions({ input: {} }),
    staleTime: 60_000,
  });

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">{SCORE_COPY.pageTitle}</h1>
        <p className="text-sm text-muted-foreground">{SCORE_COPY.pageIntro}</p>
        <p className="text-xs text-muted-foreground">{SCORE_COPY.noStorage}</p>
      </div>

      {readiness.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : readiness.isError || !readiness.data ? (
        <p className="text-sm text-muted-foreground">
          Could not load the readiness index.{" "}
          <button className="underline" onClick={() => void readiness.refetch()}>
            Retry
          </button>
        </p>
      ) : (
        <ReadinessCard result={readiness.data} />
      )}

      {goals.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : goals.isError || !goals.data ? (
        <p className="text-sm text-muted-foreground">
          Could not load goal progress.{" "}
          <button className="underline" onClick={() => void goals.refetch()}>
            Retry
          </button>
        </p>
      ) : (
        <GoalProgressCard result={goals.data} />
      )}

      <ReferenceComparisonsSection />

      <p className="text-sm text-muted-foreground">
        Set targets, directions and priorities for your goals under{" "}
        <Link to="/workouts" className="underline">
          Workouts
        </Link>
        .
      </p>
    </div>
  );
}
