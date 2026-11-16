import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  formatDistanceMeters,
  formatKcalories,
  summarizeDailyActivity,
} from "@openvalens/api/presenters/activity";
import { metersToMiles } from "@openvalens/api/presenters/product-formatting";
import { Button } from "@openvalens/ui/components/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@openvalens/ui/components/chart";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { BarChart3, CalendarDays, Flame, Footprints, Route as RouteIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, XAxis, YAxis } from "recharts";

import { EmptyState, ErrorState, Page, PageHeader, Section, StatTile } from "@/components/page";
import { ProductSettingsStatus } from "@/components/product-settings-status";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { friendlyDate } from "@/utils/friendly";
import { client, orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";
import { useCacheFirst } from "@/utils/sync-engine";
import { ModuleHiddenNote } from "@/components/module-hidden-note";

export const Route = createFileRoute("/_auth/records/activity")({
  component: ActivityPage,
});

type ChartMetric = "steps" | "calories" | "distance";

/** "11,240" in the reader's locale: the tile shows the whole count. */
function fullCount(value: number, locale: string): string {
  return Math.round(value).toLocaleString(locale);
}

/** Axis ticks: "7k", "14k", "500". */
function compactTick(value: number): string {
  if (Math.abs(value) < 1000) return `${Math.round(value)}`;
  return `${Number((value / 1000).toFixed(1))}k`;
}

/**
 * activity#7 — a workout day's marker: a small steps-toned dot just above its
 * bar (recharts `LabelList` content; `value` is the day's workout count).
 */
function WorkoutMarker(props: {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  value?: unknown;
}) {
  const count = Number(props.value ?? 0);
  if (!count) return null;
  const cx = Number(props.x ?? 0) + Number(props.width ?? 0) / 2;
  const cy = Number(props.y ?? 0) - 9;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4.5}
      fill="var(--tone-steps)"
      stroke="var(--card)"
      strokeWidth={2}
      data-workout-marker=""
      aria-hidden="true"
    />
  );
}

function ActivityPage() {
  const totals = useCacheFirst("activity.dailyTotals", () =>
    client.activity.dailyTotals({ days: 30 }),
  );
  // activity#7: the days with workouts, marked on the chart's bars.
  const workouts = useQuery(orpc.activity.dailyWorkouts.queryOptions({ input: { days: 30 } }));
  const settingsQuery = useProductSettings();
  const settings = settingsQuery.data;
  const { t, i18n } = useLingui();
  const [metric, setMetric] = useState<ChartMetric>("steps");
  const imperial = settings?.units === "imperial";

  const header = <PageHeader title={<Trans>Activity</Trans>} actions={<SyncStatusBadge />} />;

  if (totals.isPending) {
    return (
      <Page>
        <ModuleHiddenNote module="activity" />
        {header}
        <div className="grid gap-10 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </Page>
    );
  }

  if (totals.isError || !totals.data) {
    return (
      <Page>
        <ModuleHiddenNote module="activity" />
        {header}
        <ErrorState
          title={<Trans>Could not load activity.</Trans>}
          action={
            <Button variant="outline" onClick={() => void totals.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      </Page>
    );
  }

  const summary = summarizeDailyActivity(totals.data);
  const distanceIn = (meters: number) => (imperial ? metersToMiles(meters) : meters / 1000);
  const workoutDays = new Map((workouts.data ?? []).map((day) => [day.date, day]));
  const series = summary.days.map((day) => ({
    date: day.date,
    steps: day.steps,
    calories: Math.round(day.activeCaloriesKcal),
    distance: Math.round(distanceIn(day.distanceMeters) * 10) / 10,
    workouts: workoutDays.get(day.date)?.count ?? 0,
  }));
  const hasWorkouts = series.some((day) => day.workouts > 0);
  /** "1 workout, 45 min" for a day's tooltip and list row; null on a rest day. */
  const workoutText = (date: string) => {
    const day = workoutDays.get(date);
    if (!day) return null;
    const count = t`${plural(day.count, { one: "# workout", other: "# workouts" })}`;
    return day.minutes ? t`${count}, ${day.minutes} min` : count;
  };
  const charts: Record<
    ChartMetric,
    { title: string; label: string; tone: string; usual: number; format: (v: number) => string }
  > = {
    steps: {
      title: t`Steps, 30 days`,
      label: t`Steps`,
      tone: "var(--tone-steps)",
      usual: summary.sevenDayAverageSteps,
      format: (value) => fullCount(value, i18n.locale),
    },
    calories: {
      title: t`Active calories, 30 days`,
      label: t`Active calories`,
      tone: "var(--tone-food)",
      usual: summary.sevenDayAverageCalories,
      format: (value) => formatKcalories(value),
    },
    distance: {
      title: t`Distance, 30 days`,
      label: t`Distance`,
      tone: "var(--tone-water)",
      usual: Math.round(distanceIn(summary.sevenDayAverageDistance) * 10) / 10,
      format: (value) => (imperial ? `${value} mi` : `${value} km`),
    },
  };
  const chart = charts[metric];
  const trendConfig = { [metric]: { label: chart.label, color: chart.tone } } satisfies ChartConfig;
  const usualLabel = t({ message: "avg", context: "chart line for the 7-day average" });
  const meter = (value: number, usual: number) =>
    usual > 0 ? { value: value / usual } : undefined;
  const recentDays = [...summary.days].reverse().slice(0, 7);

  return (
    <Page>
      <ModuleHiddenNote module="activity" />
      {header}

      <ProductSettingsStatus />

      {!summary.today ? (
        <EmptyState
          icon={Footprints}
          title={<Trans>No activity yet</Trans>}
          description={
            <Trans>
              Sync Health Connect or Apple Health from the mobile app, or log a reading with +.
            </Trans>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <StatTile
              compact
              icon={Footprints}
              tone="steps"
              label={<Trans>Steps</Trans>}
              value={fullCount(summary.today.steps, i18n.locale)}
              meter={meter(summary.today.steps, summary.sevenDayAverageSteps)}
              note={t`7-day avg: ${fullCount(summary.sevenDayAverageSteps, i18n.locale)}`}
              pressed={metric === "steps"}
              onPress={() => setMetric("steps")}
            />
            <StatTile
              compact
              icon={Flame}
              tone="food"
              label={<Trans>Active calories</Trans>}
              value={formatKcalories(summary.today.activeCaloriesKcal)}
              meter={meter(summary.today.activeCaloriesKcal, summary.sevenDayAverageCalories)}
              note={t`7-day avg: ${formatKcalories(summary.sevenDayAverageCalories)}`}
              pressed={metric === "calories"}
              onPress={() => setMetric("calories")}
            />
            <StatTile
              compact
              icon={RouteIcon}
              tone="water"
              label={<Trans>Distance</Trans>}
              value={formatDistanceMeters(summary.today.distanceMeters, settings)}
              meter={meter(summary.today.distanceMeters, summary.sevenDayAverageDistance)}
              note={t`7-day avg: ${formatDistanceMeters(summary.sevenDayAverageDistance, settings)}`}
              pressed={metric === "distance"}
              onPress={() => setMetric("distance")}
            />
          </div>

          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <Section
              icon={BarChart3}
              tone="steps"
              title={chart.title}
              info={
                <Trans>
                  Pick a tile above to chart it. The dashed line is your 7-day average. A dot above
                  a bar marks a day with a workout.
                </Trans>
              }
            >
              <div className="sheet grid gap-3 p-5">
                <ChartContainer config={trendConfig} className="aspect-auto h-64 w-full">
                  <BarChart data={series} margin={{ left: 0, right: 36, top: 20, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--rule)" strokeDasharray="4 6" />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={32}
                      tickFormatter={(value: string) => friendlyDate(i18n, value)}
                    />
                    <YAxis
                      domain={[0, "auto"]}
                      tickLine={false}
                      axisLine={false}
                      width={44}
                      tickCount={4}
                      tickFormatter={(value: number) =>
                        metric === "distance" ? `${value}` : compactTick(value)
                      }
                    />
                    {chart.usual > 0 ? (
                      <ReferenceLine
                        y={chart.usual}
                        stroke="var(--ink-3)"
                        strokeDasharray="4 4"
                        ifOverflow="extendDomain"
                        label={{
                          value: usualLabel,
                          position: "right",
                          fill: "var(--ink-3)",
                          fontSize: 12,
                        }}
                      />
                    ) : null}
                    <ChartTooltip
                      cursor={{ fill: "var(--paper-2)" }}
                      content={
                        <ChartTooltipContent
                          labelFormatter={(_, payload) => {
                            const date = payload?.[0]?.payload?.date;
                            if (typeof date !== "string") return null;
                            const workout = workoutText(date);
                            return workout
                              ? `${friendlyDate(i18n, date)} · ${workout}`
                              : friendlyDate(i18n, date);
                          }}
                          formatter={(value) => chart.format(Number(value))}
                        />
                      }
                    />
                    <Bar
                      dataKey={metric}
                      fill={`var(--color-${metric})`}
                      radius={[8, 8, 8, 8]}
                      maxBarSize={18}
                      isAnimationActive={false}
                    >
                      <LabelList dataKey="workouts" content={WorkoutMarker} />
                    </Bar>
                  </BarChart>
                </ChartContainer>
                {hasWorkouts ? (
                  <p className="flex items-center gap-2 text-sm text-ink-3">
                    <span aria-hidden="true" className="size-2.5 rounded-full bg-steps" />
                    <Trans>Workout day</Trans>
                  </p>
                ) : null}
              </div>
            </Section>

            <Section icon={CalendarDays} tone="steps" title={<Trans>Recent days</Trans>}>
              <ul className="sheet grid divide-y divide-rule px-5 py-1" aria-label={t`Recent days`}>
                {recentDays.map((day) => (
                  <li
                    key={day.date}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 py-3"
                  >
                    <span className="text-sm font-semibold text-ink-2">
                      {friendlyDate(i18n, day.date)}
                    </span>
                    <span className="num text-right font-display text-lg font-medium text-ink">
                      {t`${plural(day.steps, { one: "# step", other: "# steps" })}`}
                    </span>
                    <span className="num col-span-2 text-sm text-ink-3">
                      {[
                        formatKcalories(day.activeCaloriesKcal),
                        formatDistanceMeters(day.distanceMeters, settings),
                        workoutText(day.date),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </>
      )}
    </Page>
  );
}
