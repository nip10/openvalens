import {
  formatClockTime,
  formatSleepDuration,
  formatSleepDurationWithHours,
  formatSleepEfficiency,
  lastNightStages,
  sleepSeries,
  sleepStatusLabel,
  sleepStatusTone,
} from "@openvalens/api/presenters/sleep";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@openvalens/ui/components/chart";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openvalens/ui/components/table";
import { cn } from "@openvalens/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { EmptyState, ErrorState, Figure, Page, PageHeader, Section } from "@/components/page";
import { ProductSettingsStatus } from "@/components/product-settings-status";
import { orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";

export const Route = createFileRoute("/_auth/records/sleep")({
  component: SleepPage,
});

const TONE_CLASS = {
  destructive: "text-destructive",
  warning: "text-warning",
  success: "text-success",
} as const;

function StatusText({ status }: { status: string }) {
  const { i18n } = useLingui();
  const tone = sleepStatusTone(status as Parameters<typeof sleepStatusTone>[0]);
  return (
    <span className={cn("text-sm font-medium", tone ? TONE_CLASS[tone] : "text-ink-2")}>
      {i18n._(sleepStatusLabel(status as Parameters<typeof sleepStatusLabel>[0]))}
    </span>
  );
}

function SleepPage() {
  const summary = useQuery(orpc.sleep.summary.queryOptions({ input: { days: 30 } }));
  const settingsQuery = useProductSettings();
  const settings = settingsQuery.data;
  const { t, i18n } = useLingui();
  const trendConfig = {
    asleepMinutes: { label: t`Asleep (min)`, color: "var(--chart-1)" },
  } satisfies ChartConfig;

  if (summary.isPending) {
    return (
      <Page>
        <PageHeader title={<Trans>Sleep</Trans>} />
        <div className="grid gap-10 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </Page>
    );
  }

  if (summary.isError || !summary.data) {
    return (
      <Page>
        <PageHeader title={<Trans>Sleep</Trans>} />
        <ErrorState
          title={<Trans>Could not load sleep.</Trans>}
          action={
            <Button variant="outline" onClick={() => void summary.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      </Page>
    );
  }

  const last = summary.data.lastNight;
  const stages = lastNightStages(last);
  const series = sleepSeries(summary.data);
  const maxAsleep = Math.max(60, ...series.map((p) => p.asleepMinutes));
  const nights = [...summary.data.days].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Page>
      <PageHeader title={<Trans>Sleep</Trans>} />

      <ProductSettingsStatus />

      {!last ? (
        <EmptyState
          title={<Trans>No sleep yet</Trans>}
          description={
            <Trans>Track sleep through Health Connect or Apple Health, or add a session.</Trans>
          }
        />
      ) : (
        <>
          <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
            <Section title={<Trans>30-day trend</Trans>}>
              <div className="sheet grid gap-5 px-5 pt-4 pb-5">
                <dl className="grid grid-cols-3 divide-x divide-rule">
                  <Figure
                    className="pr-4"
                    label={t`7-day average`}
                    value={formatSleepDuration(summary.data.sevenDayAverageMinutes)}
                  />
                  <Figure
                    className="px-4"
                    label={t`Avg debt`}
                    value={formatSleepDuration(summary.data.averageSleepDebtMinutes)}
                  />
                  <Figure
                    className="pl-4"
                    label={t`Target`}
                    value={formatSleepDuration(last.targetMinutes)}
                  />
                </dl>
                <ChartContainer config={trendConfig} className="aspect-auto h-72 w-full">
                  <LineChart data={series} margin={{ left: 0, right: 4, top: 8, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--rule)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis
                      domain={[0, Math.ceil(maxAsleep / 60) * 60]}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                      tickCount={5}
                      tickFormatter={(value: number) => formatSleepDurationWithHours(value)}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value) => formatSleepDuration(Number(value))}
                        />
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="asleepMinutes"
                      stroke="var(--color-asleepMinutes)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ChartContainer>
              </div>
            </Section>

            <Section
              title={<Trans>Last night</Trans>}
              description={last.date}
              actions={<StatusText status={last.status} />}
            >
              <div className="well grid gap-5 px-5 pt-4 pb-5">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <Figure label={t`Asleep`} value={formatSleepDuration(last.asleepMinutes)} />
                  <Figure label={t`In bed`} value={formatSleepDuration(last.timeInBedMinutes)} />
                  <Figure
                    label={t`Efficiency`}
                    value={formatSleepEfficiency(last.sleepEfficiencyPct)}
                  />
                  <Figure
                    label={t`Bedtime → wake`}
                    value={
                      <span className="text-lg">
                        {`${formatClockTime(last.mainSleepStart, settings)} → ${formatClockTime(last.mainSleepEnd, settings)}`}
                      </span>
                    }
                  />
                </dl>
                <div className="grid gap-2 border-t border-rule pt-4">
                  <h3 className="text-base text-ink">
                    <Trans>Stages</Trans>
                  </h3>
                  <ul className="divide-y divide-rule">
                    {stages.map((entry) => (
                      <li
                        key={entry.stage}
                        className="flex items-baseline justify-between gap-6 py-1.5 text-sm"
                      >
                        <span className="text-ink-3">{i18n._(entry.label)}</span>
                        <span className="num text-ink">{formatSleepDuration(entry.minutes)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Section>
          </div>

          <div className="sheet min-w-0 px-2 pt-2 pb-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Trans>Date</Trans>
                  </TableHead>
                  <TableHead className="num">
                    <Trans>Asleep</Trans>
                  </TableHead>
                  <TableHead className="num">
                    <Trans>In bed</Trans>
                  </TableHead>
                  <TableHead className="num">
                    <Trans>Efficiency</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Status</Trans>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nights.map((night) => (
                  <TableRow key={night.date}>
                    <TableCell className="num text-ink-3">{night.date}</TableCell>
                    <TableCell className="num text-ink">
                      {formatSleepDuration(night.asleepMinutes)}
                    </TableCell>
                    <TableCell className="num">
                      {formatSleepDuration(night.timeInBedMinutes)}
                    </TableCell>
                    <TableCell className="num">
                      {formatSleepEfficiency(night.sleepEfficiencyPct)}
                    </TableCell>
                    <TableCell>
                      <StatusText status={night.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </Page>
  );
}
