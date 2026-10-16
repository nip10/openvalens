import {
  COMPARISON_COPY,
  referenceComparisonsView,
  type MetricComparisonView,
} from "@openvalens/api/presenters/reference-comparison";
import type {
  ComparisonMetric,
  ReferenceComparisonsResult,
} from "@openvalens/api/reference-comparison-contract";
import { Button } from "@openvalens/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

/**
 * Issue #96 — reference comparisons card. Pure props → markup from the shared
 * view model (`@openvalens/api/presenters/reference-comparison`), so web and
 * native show the same bands, ranges, source labels, comparability notes and
 * unavailable states. Your own trend is listed first; each comparison is off
 * until you turn it on, and the toggle shows what it compares and its limits.
 * No colour carries meaning: positions are in text.
 */

function MetricSection({
  metric,
  pending,
  onToggle,
}: {
  metric: MetricComparisonView;
  pending: boolean;
  onToggle: (metric: ComparisonMetric, enabled: boolean) => void;
}) {
  const headingId = `comparison-${metric.key}`;
  return (
    <section aria-labelledby={headingId} className="grid gap-2 border-t border-border pt-4">
      <h3 id={headingId} className="font-medium">
        {metric.title}
      </h3>
      <ul className="text-sm text-muted-foreground">
        {metric.ownTrendLines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {metric.statusText ? <p className="text-sm">{metric.statusText}</p> : null}
      {metric.comparisonLines.map((line) => (
        <p key={line} className="text-sm">
          {line}
        </p>
      ))}
      {metric.notes.length > 0 ? (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {metric.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      <details className="text-sm">
        <summary className="cursor-pointer">{metric.source.label}</summary>
        <div className="mt-2 grid gap-1 text-muted-foreground">
          <p>
            <a href={metric.source.url} target="_blank" rel="noreferrer" className="underline">
              {metric.source.citation}
            </a>
          </p>
          {metric.source.details.map((detail) => (
            <p key={detail.label}>
              <span className="font-medium text-foreground">{detail.label}:</span> {detail.text}
            </p>
          ))}
        </div>
      </details>
      {!metric.optedIn ? (
        <p className="text-sm text-muted-foreground">{metric.disclosure}</p>
      ) : null}
      <div>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={metric.optedIn}
          aria-describedby={headingId}
          disabled={pending}
          onClick={() => onToggle(metric.key, !metric.optedIn)}
        >
          {metric.toggleLabel}
        </Button>
      </div>
    </section>
  );
}

export function ReferenceComparisonsCard({
  result,
  pending = false,
  onToggle,
}: {
  result: ReferenceComparisonsResult;
  pending?: boolean;
  onToggle: (metric: ComparisonMetric, enabled: boolean) => void;
}) {
  const view = referenceComparisonsView(result);
  return (
    <Card role="region" aria-labelledby="reference-comparisons-title">
      <CardHeader>
        <CardTitle id="reference-comparisons-title">{COMPARISON_COPY.title}</CardTitle>
        <CardDescription>{COMPARISON_COPY.intro}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">{COMPARISON_COPY.noOtherPeople}</p>
        {view.withheldText ? <p className="text-sm">{view.withheldText}</p> : null}
        {view.metrics.map((metric) => (
          <MetricSection key={metric.key} metric={metric} pending={pending} onToggle={onToggle} />
        ))}
        <section
          aria-labelledby="not-compared-title"
          className="grid gap-2 border-t border-border pt-4"
        >
          <h3 id="not-compared-title" className="font-medium">
            {COMPARISON_COPY.notComparedTitle}
          </h3>
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {view.notCompared.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
        <p className="text-sm text-muted-foreground">{COMPARISON_COPY.limits}</p>
        <p className="text-xs text-muted-foreground">{view.versionText}</p>
      </CardContent>
    </Card>
  );
}

/** Loads `comparison.get` and wires the per-metric opt-in toggles. */
export function ReferenceComparisonsSection() {
  const queryClient = useQueryClient();
  const comparisons = useQuery({
    ...orpc.comparison.get.queryOptions({ input: {} }),
    staleTime: 60_000,
  });
  const update = useMutation(
    orpc.comparison.updateSettings.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.comparison.key() }),
      onError: () => toast.error("Could not update the comparison setting."),
    }),
  );
  if (comparisons.isPending) return <Skeleton className="h-64 w-full" />;
  if (comparisons.isError || !comparisons.data)
    return (
      <p className="text-sm text-muted-foreground">
        Could not load reference comparisons.{" "}
        <button className="underline" onClick={() => void comparisons.refetch()}>
          Retry
        </button>
      </p>
    );
  return (
    <ReferenceComparisonsCard
      result={comparisons.data}
      pending={update.isPending}
      onToggle={(metric, enabled) => update.mutate({ metric, enabled })}
    />
  );
}
