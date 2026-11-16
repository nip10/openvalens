import { Trans, useLingui } from "@lingui/react/macro";
import { readinessMoverText, readinessTrend } from "@openvalens/api/presenters/score";
import type { ReadinessHistory } from "@openvalens/api/score-contract";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@openvalens/ui/components/chart";
import { Area, AreaChart, YAxis } from "recharts";

import { Figure } from "@/components/page";
import { friendlyDate } from "@/utils/friendly";

/**
 * scores#8 — the readiness index over the last 30 days, beside today's gauge:
 * a small line, yesterday's figure and the part that moved most since then.
 * Every day's figure is the server's own readiness calculation for that day;
 * this only draws it and subtracts two days.
 */
export function ReadinessTrend({ history }: { history: ReadinessHistory }) {
  const { t, i18n } = useLingui();
  if (history.status !== "available") return null;
  const trend = readinessTrend(history);
  // One day alone draws no line; say so instead of an empty chart.
  if (trend.scoredDays < 2) {
    return (
      <p className="text-sm text-ink-3">
        <Trans>Your 30-day line appears after a few days with a score.</Trans>
      </p>
    );
  }
  const config = {
    score: { label: t`Readiness`, color: "var(--tone-sleep)" },
  } satisfies ChartConfig;
  return (
    <div className="grid min-w-0 gap-3" aria-label={t`Readiness, last 30 days`} role="group">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm text-ink-3">
          <Trans>Last 30 days</Trans>
        </span>
        {trend.mover ? (
          <span className="text-sm font-medium text-ink-2">
            {readinessMoverText(trend.mover, i18n)}
          </span>
        ) : null}
      </div>
      <ChartContainer config={config} className="aspect-auto h-20 w-full">
        <AreaChart data={trend.points} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="readiness-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--tone-sleep)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--tone-sleep)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[0, 100]} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const date = payload?.[0]?.payload?.date;
                  return typeof date === "string" ? friendlyDate(i18n, date) : null;
                }}
              />
            }
          />
          <Area
            type="monotone"
            dataKey="score"
            stroke="var(--color-score)"
            strokeWidth={3}
            fill="url(#readiness-fill)"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        <Figure
          label={<Trans>Yesterday</Trans>}
          value={trend.yesterday === null ? "—" : String(trend.yesterday)}
        />
        <Figure
          label={<Trans>Days with a score</Trans>}
          value={t`${trend.scoredDays} of ${trend.points.length}`}
        />
      </dl>
    </div>
  );
}
