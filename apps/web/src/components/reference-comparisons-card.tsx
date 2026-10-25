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
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Footprints, HeartPulse, type LucideIcon, Moon, Scale } from "lucide-react";
import { toast } from "sonner";

import { Details, ErrorState, InfoTip, type Tone, ToneIcon } from "@/components/page";
import { orpc } from "@/utils/orpc";

/**
 * Issue #96 — reference comparisons card. Pure props → markup from the shared
 * view model (`@openvalens/api/presenters/reference-comparison`), so web and
 * native show the same bands, ranges, source labels, comparability notes and
 * unavailable states. Your own trend is listed first; each comparison is off
 * until you turn it on, and the toggle shows what it compares and its limits.
 * No colour carries meaning: positions are in text.
 */

const METRIC_LOOK: Record<ComparisonMetric, { icon: LucideIcon; tone: Tone }> = {
  resting_heart_rate: { icon: HeartPulse, tone: "heart" },
  sleep_duration: { icon: Moon, tone: "sleep" },
  active_minutes: { icon: Footprints, tone: "steps" },
};

/** One measure as a card: your own figures first, the published reference under them, and its opt-in. */
function MetricCard({
  metric,
  pending,
  onToggle,
}: {
  metric: MetricComparisonView;
  pending: boolean;
  onToggle: (metric: ComparisonMetric, enabled: boolean) => void;
}) {
  const headingId = `comparison-${metric.key}`;
  const look = METRIC_LOOK[metric.key] ?? { icon: Scale, tone: "water" as const };
  return (
    <li aria-labelledby={headingId} className="sheet grid min-w-0 content-start gap-4 p-5">
      <div className="flex items-start gap-3">
        <ToneIcon icon={look.icon} tone={look.tone} />
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex items-center gap-1">
            <h3 id={headingId} className="text-base leading-snug text-ink">
              {metric.title}
            </h3>
            {!metric.optedIn ? (
              <InfoTip>
                <p>{metric.disclosure}</p>
              </InfoTip>
            ) : null}
          </div>
          <p className="sr-only">
            <Trans>Your trend</Trans>
          </p>
          <ul className="grid gap-0.5 text-sm text-ink-2 tabular-nums">
            {metric.ownTrendLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
      {metric.statusText || metric.comparisonLines.length > 0 ? (
        <div className="grid gap-1 rounded-2xl bg-paper-2 px-4 py-3 text-sm">
          <p className="text-ink-3">
            <Trans>Published reference</Trans>
          </p>
          {metric.statusText ? <p className="text-ink-3">{metric.statusText}</p> : null}
          {metric.comparisonLines.map((line) => (
            <p key={line} className="text-ink tabular-nums">
              {line}
            </p>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
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
        <Details summary={metric.source.label} className="text-sm">
          <div className="grid gap-1 text-ink-3">
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
            {metric.notes.length > 0 ? (
              <ul className="grid gap-1 pt-1">
                {metric.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </Details>
      </div>
    </li>
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
      className="grid min-w-0 content-start gap-3"
    >
      <div className="flex items-center gap-2">
        <ToneIcon icon={Scale} tone="water" size="sm" />
        <h2 id="reference-comparisons-title" className="text-xl leading-tight text-ink">
          {i18n._(COMPARISON_COPY.title)}
        </h2>
        <InfoTip>
          <p>{i18n._(COMPARISON_COPY.intro)}</p>
          <p>{i18n._(COMPARISON_COPY.noOtherPeople)}</p>
          <p>{i18n._(COMPARISON_COPY.limits)}</p>
          <p className="text-ink-3">{view.versionText}</p>
        </InfoTip>
      </div>
      {view.withheldText ? <p className="sheet px-5 py-4 text-ink-2">{view.withheldText}</p> : null}
      {view.metrics.length > 0 ? (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {view.metrics.map((metric) => (
            <MetricCard key={metric.key} metric={metric} pending={pending} onToggle={onToggle} />
          ))}
        </ul>
      ) : null}
      <section aria-labelledby="not-compared-title" className="pt-1">
        <Details
          summary={<span id="not-compared-title">{i18n._(COMPARISON_COPY.notComparedTitle)}</span>}
        >
          <ul className="grid max-w-[65ch] gap-1 text-sm text-ink-3">
            {view.notCompared.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Details>
      </section>
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
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
        {["a", "b", "c"].map((key) => (
          <Skeleton key={key} className="h-48 w-full rounded-3xl" />
        ))}
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
