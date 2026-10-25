import { Trans, useLingui } from "@lingui/react/macro";
import type { ActivityLoadResult } from "@openvalens/api/activity-load-contract";
import {
  ACTIVITY_LOAD_COPY,
  activityLoadView,
  type ActivityNumberView,
} from "@openvalens/api/presenters/activity-load";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@openvalens/ui/components/chart";
import { Flame, Footprints, type LucideIcon, Timer, TrendingUp, Zap } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Details, InfoTip, StatTile, ToneIcon } from "@/components/page";
import { friendlyDate } from "@/utils/friendly";

/**
 * Issue #99 — weekly activity: WHO active minutes and session effort points.
 * Pure props → markup from the shared view model
 * (`@openvalens/api/presenters/activity-load`), so web and native show the
 * same numbers, formulas, units, coverage and unavailable states. No colour
 * carries meaning; each number has a screen-reader label.
 */

/** A headline tile for one weekly number; the method, sources and coverage sit behind its ⓘ. */
function NumberTile({
  part,
  icon,
  meter,
}: {
  part: ActivityNumberView;
  icon: LucideIcon;
  meter?: { value: number };
}) {
  const titleId = `${part.key}-title`;
  return (
    <StatTile
      icon={icon}
      tone="steps"
      label={<span id={titleId}>{part.title}</span>}
      value={
        <span role="img" aria-label={part.accessibilityLabel}>
          {part.valueText}
        </span>
      }
      unit={part.available ? <span aria-hidden="true">{part.unitText}</span> : undefined}
      meter={meter}
      note={
        <span className="inline-flex items-center gap-1">
          {part.statusText}
          <InfoTip>
            {part.breakdown.length > 0 ? (
              <ul>
                {part.breakdown.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
            {part.coverage.map((line) => (
              <p key={line} className="text-ink-3">
                {line}
              </p>
            ))}
            <p className="font-semibold text-ink">
              <Trans>How this is calculated</Trans>
            </p>
            <p>{part.formula}</p>
            {part.sources.map((line) => (
              <p key={line} className="text-ink-3">
                {line}
              </p>
            ))}
            {part.key === "active_minutes" ? (
              <p>
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
          </InfoTip>
        </span>
      }
    />
  );
}

/** The one chart: effort points for each day of the window, bars from zero. */
function EffortChart({ result }: { result: ActivityLoadResult }) {
  const { i18n } = useLingui();
  const days = result.load?.effort.days ?? [];
  const data = days.map((day) => ({ date: day.date, points: day.points ?? 0 }));
  const config: ChartConfig = {
    points: { label: i18n._(ACTIVITY_LOAD_COPY.effortTitle), color: "var(--tone-steps)" },
  };
  return (
    <ChartContainer config={config} className="aspect-auto h-56 w-full" aria-hidden="true">
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--rule)" strokeDasharray="4 6" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          minTickGap={16}
          tickFormatter={(value: string) => friendlyDate(i18n, value)}
        />
        <YAxis tickLine={false} axisLine={false} width={40} tickCount={4} allowDecimals={false} />
        <ChartTooltip
          content={
            <ChartTooltipContent labelFormatter={(value) => friendlyDate(i18n, String(value))} />
          }
        />
        <Bar
          dataKey="points"
          fill="var(--color-points)"
          radius={[8, 8, 8, 8]}
          maxBarSize={18}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}

export function ActivityLoadCard({ result }: { result: ActivityLoadResult }) {
  const { i18n } = useLingui();
  const view = activityLoadView(result, i18n);
  const active = result.load?.activeMinutes;
  const activeMeter =
    active && active.activeMinutes !== null && active.whoRange.lower > 0
      ? { value: active.activeMinutes / active.whoRange.lower }
      : undefined;
  return (
    <section
      role="region"
      aria-labelledby="activity-load-title"
      className="grid min-w-0 content-start gap-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ToneIcon icon={Flame} tone="steps" size="sm" />
        <h2 id="activity-load-title" className="text-xl leading-tight text-ink">
          {view.title}
        </h2>
        {view.windowText ? <span className="text-sm text-ink-3">{view.windowText}</span> : null}
        <InfoTip>
          <p>{view.intro}</p>
          {view.notes.map((line) => (
            <p key={line} className="text-ink-3">
              {line}
            </p>
          ))}
          {view.versionText ? <p className="text-ink-3">{view.versionText}</p> : null}
        </InfoTip>
      </div>
      {view.withheldExplanation ? (
        <p className="sheet p-5 text-ink-2">{view.withheldExplanation}</p>
      ) : null}
      {view.activeMinutes && view.effort ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberTile part={view.activeMinutes} icon={Timer} meter={activeMeter} />
          <NumberTile part={view.effort} icon={Zap} />
        </div>
      ) : null}
      {view.effortDays.length > 0 ? (
        <div className="sheet grid min-w-0 gap-3 p-5">
          <h3 className="font-body text-base font-semibold text-ink-2">
            <Trans>Effort points by day</Trans>
          </h3>
          <EffortChart result={result} />
          <Details summary={<Trans>By day</Trans>}>
            <ul className="grid gap-x-6 text-sm sm:grid-cols-2">
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
          </Details>
        </div>
      ) : null}
      {view.comparison || view.context.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {view.comparison ? (
            <section
              className="sheet flex items-start gap-3 p-5 text-sm"
              aria-labelledby="effort-comparison-title"
            >
              <ToneIcon icon={TrendingUp} tone="steps" size="sm" />
              <div className="grid min-w-0 gap-1">
                <h3
                  id="effort-comparison-title"
                  className="flex items-center gap-1 font-body text-base font-semibold text-ink"
                >
                  {view.comparison.title}
                  <InfoTip>
                    {view.comparison.detail ? <p>{view.comparison.detail}</p> : null}
                    <p className="text-ink-3">{view.comparison.limits}</p>
                  </InfoTip>
                </h3>
                <p className="text-ink-2">{view.comparison.text}</p>
              </div>
            </section>
          ) : null}
          {view.context.length > 0 ? (
            <section
              className="sheet flex items-start gap-3 p-5 text-sm"
              aria-labelledby="activity-context-title"
            >
              <ToneIcon icon={Footprints} tone="steps" size="sm" />
              <div className="grid min-w-0 gap-1">
                <h3
                  id="activity-context-title"
                  className="font-body text-base font-semibold text-ink"
                >
                  {i18n._(ACTIVITY_LOAD_COPY.contextTitle)}
                </h3>
                {view.context.map((line) => (
                  <p key={line} className="text-ink-2">
                    {line}
                  </p>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
