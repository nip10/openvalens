import type { InsightFeedbackAction } from "@openvalens/api/insight-contract";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { INSIGHT_COPY } from "@openvalens/api/presenters/insights";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";

import { InsightsCard, PushOfferCard, SummaryCards } from "./insights-panel";

/**
 * Issue #92 — connected dashboard section: the two summaries first, then the
 * insights. Each part loads on its own; none waits for AI, nutrition or
 * messaging. The coach hand-off shows only when the person has AI consent.
 */
export function InsightsSection() {
  const queryClient = useQueryClient();
  const readiness = useQuery({
    ...orpc.score.readiness.queryOptions({ input: {} }),
    staleTime: 60_000,
  });
  const goals = useQuery({
    ...orpc.score.goalProgress.queryOptions({ input: {} }),
    staleTime: 60_000,
  });
  const insights = useQuery({
    ...orpc.insights.list.queryOptions({ input: {} }),
    staleTime: 60_000,
  });
  const consent = useQuery({ ...orpc.ai.consent.get.queryOptions({ input: {} }), retry: false });
  const settings = useProductSettings().data;
  const [pendingId, setPendingId] = useState<string | null>(null);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: orpc.insights.key() });

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
