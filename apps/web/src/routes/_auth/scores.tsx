import { Trans, useLingui } from "@lingui/react/macro";
import { SCORE_COPY } from "@openvalens/api/presenters/score";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { Target } from "lucide-react";

import { ErrorState, Page, PageHeader, ToneIcon } from "@/components/page";
import { ReferenceComparisonsSection } from "@/components/reference-comparisons-card";
import { ReadinessCard } from "@/components/score-panels";
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
  return (
    <Page>
      {/* The nav says "Scores"; the friendly question stays as the subtitle. */}
      <PageHeader
        title={<Trans>Scores</Trans>}
        description={i18n._(SCORE_COPY.pageTitle)}
        info={
          <>
            <p>{i18n._(SCORE_COPY.pageIntro)}</p>
            <p>{i18n._(SCORE_COPY.noStorage)}</p>
          </>
        }
      />

      {/* Desktop: readiness on the left (about 55%), the references stacked on the right. */}
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
        <div className="grid min-w-0 gap-6">
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
        </div>
        <ReferenceComparisonsSection />
      </div>

      <p className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
        <ToneIcon icon={Target} tone="weight" size="sm" />
        {/* One flex item, so the gap never lands before the full stop. */}
        <span>
          <Trans>
            Manage your personal goals on{" "}
            <Link
              to="/goals"
              className="text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Goals
            </Link>
            .
          </Trans>
        </span>
      </p>
    </Page>
  );
}

function ScoreSkeleton() {
  return <Skeleton className="h-80 w-full rounded-3xl" />;
}
