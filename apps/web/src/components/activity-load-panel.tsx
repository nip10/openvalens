import { Trans, useLingui } from "@lingui/react/macro";
import type { ActivityLoadResult } from "@openvalens/api/activity-load-contract";
import {
  ACTIVITY_LOAD_COPY,
  activityLoadView,
  formatDay,
  type ActivityNumberView,
} from "@openvalens/api/presenters/activity-load";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@openvalens/ui/components/chart";
import { cn } from "@openvalens/ui/lib/utils";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

/**
 * Issue #99 — weekly activity: WHO active minutes and session effort points.
 * Pure props → markup from the shared view model
 * (`@openvalens/api/presenters/activity-load`), so web and native show the
 * same numbers, formulas, units, coverage and unavailable states. No colour
 * carries meaning; each number has a screen-reader label.
 */

function NumberBlock({ part, className }: { part: ActivityNumberView; className?: string }) {
  const titleId = `${part.key}-title`;
  return (
    <section className={cn("grid content-start gap-2", className)} aria-labelledby={titleId}>
      <h3 id={titleId} className="font-body text-sm font-medium text-ink-3">
        {part.title}
      </h3>
      <div className="flex items-baseline gap-1.5">
        <span
          className="num text-3xl font-medium tracking-[-0.03em] text-ink"
          role="img"
          aria-label={part.accessibilityLabel}
        >
          {part.valueText}
        </span>
        {part.available ? (
          <span className="text-sm text-ink-3" aria-hidden="true">
            {part.unitText}
          </span>
        ) : null}
      </div>
      <p className="max-w-[60ch] text-sm text-ink-2">{part.statusText}</p>
      {part.breakdown.length > 0 ? (
        <ul className="text-sm text-ink-3">
          {part.breakdown.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {part.coverage.map((line) => (
        <p key={line} className="text-sm text-ink-3">
          {line}
        </p>
      ))}
      <details className="text-sm">
        <summary className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring cursor-pointer font-display font-medium text-ink">
          <Trans>How this is calculated</Trans>
        </summary>
        <p className="mt-2 max-w-[65ch] text-ink-2">{part.formula}</p>
        {part.sources.map((line) => (
          <p key={line} className="mt-2 max-w-[65ch] text-ink-3">
            {line}
          </p>
        ))}
        {part.key === "active_minutes" ? (
          <p className="mt-2">
            <a
              className="underline decoration-signal underline-offset-[0.15em] hover:decoration-2"
              href={ACTIVITY_LOAD_COPY.whoUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              <Trans>WHO 2020 guidelines (opens the paper)</Trans>
            </a>
          </p>
        ) : null}
      </details>
    </section>
  );
}

/** The one chart: effort points for each day of the window, bars from zero. */
function EffortChart({ result }: { result: ActivityLoadResult }) {
  const { i18n } = useLingui();
  const days = result.load?.effort.days ?? [];
  const data = days.map((day) => ({ label: formatDay(day.date), points: day.points ?? 0 }));
  const config: ChartConfig = {
    points: { label: i18n._(ACTIVITY_LOAD_COPY.effortTitle), color: "var(--chart-1)" },
  };
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full" aria-hidden="true">
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--rule)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} width={40} tickCount={4} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="points" fill="var(--color-points)" isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

export function ActivityLoadCard({ result }: { result: ActivityLoadResult }) {
  const { i18n } = useLingui();
  const view = activityLoadView(result, i18n);
  return (
    <section
      role="region"
      aria-labelledby="activity-load-title"
      className="grid min-w-0 content-start gap-4"
    >
      <div className="grid gap-1">
        <h2 id="activity-load-title" className="text-xl leading-tight text-ink">
          {view.title}
        </h2>
        <p className="max-w-[65ch] text-sm text-ink-3">{view.intro}</p>
        {view.windowText ? <p className="text-sm text-ink-3">{view.windowText}</p> : null}
      </div>
      <div className="sheet grid gap-6 px-5 pt-4 pb-5">
        {view.withheldExplanation ? (
          <p className="max-w-[65ch] text-ink-2">{view.withheldExplanation}</p>
        ) : null}
        {view.activeMinutes && view.effort ? (
          <div className="grid gap-6 sm:grid-cols-2 sm:gap-0 sm:divide-x sm:divide-rule">
            <NumberBlock part={view.activeMinutes} className="sm:pr-6" />
            <NumberBlock part={view.effort} className="sm:pl-6" />
          </div>
        ) : null}
        {view.effortDays.length > 0 ? (
          <div className="grid gap-6 border-t border-rule pt-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="grid content-start gap-2">
              <h3 className="font-body text-sm font-medium text-ink-3">
                <Trans>Effort points by day</Trans>
              </h3>
              <EffortChart result={result} />
            </div>
            <ul className="divide-y divide-rule self-start text-sm">
              {view.effortDays.map((day) => (
                <li
                  key={day.date}
                  className="flex justify-between gap-4 py-1.5"
                  aria-label={day.accessibilityLabel}
                >
                  <span className="text-ink-3" aria-hidden="true">
                    {day.label}
                  </span>
                  <span className="num text-ink" aria-hidden="true">
                    {day.valueText}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {view.comparison || view.context.length > 0 ? (
          <div className="grid gap-6 border-t border-rule pt-4 sm:grid-cols-2">
            {view.comparison ? (
              <section
                className="grid content-start gap-1 text-sm"
                aria-labelledby="effort-comparison-title"
              >
                <h3 id="effort-comparison-title" className="text-base text-ink">
                  {view.comparison.title}
                </h3>
                <p className="text-ink-2">{view.comparison.text}</p>
                {view.comparison.detail ? (
                  <p className="text-ink-3">{view.comparison.detail}</p>
                ) : null}
                <p className="text-ink-3">{view.comparison.limits}</p>
              </section>
            ) : null}
            {view.context.length > 0 ? (
              <section
                className="grid content-start gap-1 text-sm"
                aria-labelledby="activity-context-title"
              >
                <h3 id="activity-context-title" className="text-base text-ink">
                  {i18n._(ACTIVITY_LOAD_COPY.contextTitle)}
                </h3>
                {view.context.map((line) => (
                  <p key={line} className="text-ink-3">
                    {line}
                  </p>
                ))}
              </section>
            ) : null}
          </div>
        ) : null}
        {view.notes.length > 0 || view.versionText ? (
          <div className="grid gap-1 border-t border-rule pt-3 text-sm text-ink-3">
            {view.notes.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {view.versionText ? <p>{view.versionText}</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
