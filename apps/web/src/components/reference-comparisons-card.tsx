import { Trans, useLingui } from "@lingui/react/macro";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openvalens/ui/components/table";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ErrorState } from "@/components/page";
import { orpc } from "@/utils/orpc";

/**
 * Issue #96 — reference comparisons card. Pure props → markup from the shared
 * view model (`@openvalens/api/presenters/reference-comparison`), so web and
 * native show the same bands, ranges, source labels, comparability notes and
 * unavailable states. Your own trend is listed first; each comparison is off
 * until you turn it on, and the toggle shows what it compares and its limits.
 * No colour carries meaning: positions are in text.
 */

/** One measure: your own figures beside the published reference, and its opt-in. */
function MetricRow({
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
    <TableRow aria-labelledby={headingId} className="align-top hover:bg-transparent">
      <TableCell className="w-56 py-4 align-top whitespace-normal">
        <div className="grid gap-3">
          <h3 id={headingId} className="text-base leading-snug text-ink">
            {metric.title}
          </h3>
          {!metric.optedIn ? <p className="text-sm text-ink-3">{metric.disclosure}</p> : null}
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
        </div>
      </TableCell>
      <TableCell className="py-4 align-top whitespace-normal">
        <ul className="grid gap-1 text-ink tabular-nums">
          {metric.ownTrendLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </TableCell>
      <TableCell className="py-4 align-top whitespace-normal">
        <div className="grid gap-2">
          {metric.statusText ? <p className="text-ink-3">{metric.statusText}</p> : null}
          {metric.comparisonLines.map((line) => (
            <p key={line} className="text-ink tabular-nums">
              {line}
            </p>
          ))}
          {metric.notes.length > 0 ? (
            <ul className="grid gap-1 border-t border-rule pt-2 text-ink-3">
              {metric.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
          <details>
            <summary className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring cursor-pointer text-ink-2">
              {metric.source.label}
            </summary>
            <div className="mt-2 grid gap-1 text-ink-3">
              <p>
                <a
                  href={metric.source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {metric.source.citation}
                </a>
              </p>
              {metric.source.details.map((detail) => (
                <p key={detail.label}>
                  <span className="font-medium text-ink">{detail.label}:</span> {detail.text}
                </p>
              ))}
            </div>
          </details>
        </div>
      </TableCell>
    </TableRow>
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
  const { i18n } = useLingui();
  const view = referenceComparisonsView(result, i18n);
  return (
    <section
      aria-labelledby="reference-comparisons-title"
      className="grid min-w-0 content-start gap-4"
    >
      <div className="grid gap-1">
        <h2 id="reference-comparisons-title" className="text-xl leading-tight text-ink">
          {i18n._(COMPARISON_COPY.title)}
        </h2>
        <p className="max-w-[65ch] text-sm text-ink-3">{i18n._(COMPARISON_COPY.intro)}</p>
        <p className="max-w-[65ch] text-sm text-ink-3">{i18n._(COMPARISON_COPY.noOtherPeople)}</p>
      </div>
      <div className="sheet grid min-w-0">
        {view.withheldText ? (
          <p className="max-w-[65ch] px-5 py-4 text-ink-2">{view.withheldText}</p>
        ) : null}
        {view.metrics.length > 0 ? (
          <div className="px-2">
            <Table className="min-w-[44rem]">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">
                    <Trans>Measure</Trans>
                  </TableHead>
                  <TableHead scope="col">
                    <Trans>Your trend</Trans>
                  </TableHead>
                  <TableHead scope="col">
                    <Trans>Published reference</Trans>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.metrics.map((metric) => (
                  <MetricRow
                    key={metric.key}
                    metric={metric}
                    pending={pending}
                    onToggle={onToggle}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
        <section
          aria-labelledby="not-compared-title"
          className="grid gap-2 border-t border-rule px-5 py-4"
        >
          <h3 id="not-compared-title" className="text-base leading-snug text-ink">
            {i18n._(COMPARISON_COPY.notComparedTitle)}
          </h3>
          <ul className="grid max-w-[65ch] gap-1 text-sm text-ink-3">
            {view.notCompared.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
        <div className="grid gap-2 border-t border-rule px-5 py-4 text-sm text-ink-3">
          <p className="max-w-[65ch]">{i18n._(COMPARISON_COPY.limits)}</p>
          <p>{view.versionText}</p>
        </div>
      </div>
    </section>
  );
}

/** Loads `comparison.get` and wires the per-metric opt-in toggles. */
export function ReferenceComparisonsSection() {
  const queryClient = useQueryClient();
  const { t } = useLingui();
  const comparisons = useQuery({
    ...orpc.comparison.get.queryOptions({ input: {} }),
    staleTime: 60_000,
  });
  const update = useMutation(
    orpc.comparison.updateSettings.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.comparison.key() }),
      onError: () => toast.error(t`Could not update the comparison setting.`),
    }),
  );
  if (comparisons.isPending)
    return (
      <div className="grid gap-4">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (comparisons.isError || !comparisons.data)
    return (
      <ErrorState
        title={<Trans>Could not load reference comparisons.</Trans>}
        action={
          <Button variant="outline" size="sm" onClick={() => void comparisons.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        }
      />
    );
  return (
    <ReferenceComparisonsCard
      result={comparisons.data}
      pending={update.isPending}
      onToggle={(metric, enabled) => update.mutate({ metric, enabled })}
    />
  );
}
