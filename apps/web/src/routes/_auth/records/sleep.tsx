import {
  formatClockTime,
  formatSleepDuration,
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
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, Hourglass, Moon, Target } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";

import {
  Details,
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  Section,
  StatTile,
  StatusPill,
  ToneIcon,
} from "@/components/page";
import { ProductSettingsStatus } from "@/components/product-settings-status";
import { friendlyDate, pillTone } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";

export const Route = createFileRoute("/_auth/records/sleep")({
  component: SleepPage,
});

function StatusText({ status }: { status: string }) {
  const { i18n } = useLingui();
  const key = status as Parameters<typeof sleepStatusTone>[0];
  return (
    <StatusPill tone={pillTone(sleepStatusTone(key))}>{i18n._(sleepStatusLabel(key))}</StatusPill>
  );
}

// Stage colours: the deeper the sleep, the stronger the ink.
const STAGE_COLOUR: Record<string, string> = {
  deep: "var(--tone-sleep)",
  rem: "color-mix(in oklab, var(--tone-sleep) 60%, var(--sheet))",
  light: "color-mix(in oklab, var(--tone-sleep) 30%, var(--sheet))",
  awake: "var(--tone-steps)",
  unknown: "var(--paper-3)",
};

function SleepPage() {
  const summary = useQuery(orpc.sleep.summary.queryOptions({ input: { days: 30 } }));
  const settingsQuery = useProductSettings();
  const settings = settingsQuery.data;
  const { t, i18n } = useLingui();
  const trendConfig = {
    asleepMinutes: { label: t`Asleep (min)`, color: "var(--tone-sleep)" },
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

  const stageTotal = stages.reduce((sum, entry) => sum + entry.minutes, 0);

  return (
    <Page>
      <PageHeader title={<Trans>Sleep</Trans>} />

      <ProductSettingsStatus />

      {!last ? (
        <EmptyState
          icon={Moon}
          title={<Trans>No sleep yet</Trans>}
          description={
            <Trans>Track sleep through Health Connect or Apple Health, or add a session.</Trans>
          }
        />
      ) : (
        <>
          <section
            aria-labelledby="last-night"
            className="sheet grid gap-6 p-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:p-7"
          >
            <div className="grid content-start gap-3">
              <h2
                id="last-night"
                className="flex items-center gap-2.5 font-body text-base font-semibold tracking-normal text-ink-2"
              >
                <ToneIcon icon={Moon} tone="sleep" />
                <Trans>Last night</Trans>
                <span className="font-normal text-ink-3">{friendlyDate(i18n, last.date)}</span>
              </h2>
              <p className="num font-display text-[3.25rem] leading-none font-medium tracking-[-0.02em] text-ink">
                {formatSleepDuration(last.asleepMinutes)}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
                <StatusText status={last.status} />
                <span className="num">
                  {`${formatClockTime(last.mainSleepStart, settings)} – ${formatClockTime(last.mainSleepEnd, settings)}`}
                </span>
              </div>
            </div>
            {stageTotal > 0 ? (
              <div className="grid content-center gap-3">
                <div
                  className="flex h-4 w-full gap-1 overflow-hidden rounded-full"
                  role="img"
                  aria-label={stages
                    .map((entry) => `${i18n._(entry.label)} ${formatSleepDuration(entry.minutes)}`)
                    .join(", ")}
                >
                  {stages.map((entry) => (
                    <span
                      key={entry.stage}
                      className="h-full rounded-full"
                      style={{
                        width: `${(entry.minutes / stageTotal) * 100}%`,
                        background: STAGE_COLOUR[entry.stage] ?? "var(--paper-3)",
                      }}
                    />
                  ))}
                </div>
                <ul className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                  {stages.map((entry) => (
                    <li key={entry.stage} className="grid gap-0.5">
                      <span className="flex items-center gap-1.5 text-sm text-ink-3">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ background: STAGE_COLOUR[entry.stage] ?? "var(--paper-3)" }}
                          aria-hidden="true"
                        />
                        {i18n._(entry.label)}
                      </span>
                      <span className="num font-semibold text-ink">
                        {formatSleepDuration(entry.minutes)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile
              tone="sleep"
              icon={CalendarDays}
              label={t`7-day average`}
              value={formatSleepDuration(summary.data.sevenDayAverageMinutes)}
            />
            <StatTile
              tone="steps"
              icon={Hourglass}
              label={t`Avg debt`}
              value={formatSleepDuration(summary.data.averageSleepDebtMinutes)}
            />
            <StatTile
              tone="weight"
              icon={Target}
              label={t`Target`}
              value={formatSleepDuration(last.targetMinutes)}
            />
          </div>

          <Section title={<Trans>30-day trend</Trans>}>
            <div className="sheet p-5">
              <ChartContainer config={trendConfig} className="aspect-auto h-64 w-full">
                <AreaChart data={series} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sleep-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--tone-sleep)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--tone-sleep)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--rule)" strokeDasharray="4 6" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={32} />
                  <YAxis
                    domain={[0, Math.ceil(maxAsleep / 120) * 120]}
                    ticks={Array.from(
                      { length: Math.ceil(maxAsleep / 120) + 1 },
                      (_, index) => index * 120,
                    )}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                    tickFormatter={(value: number) => `${Math.round(value / 60)}h`}
                  />
                  {last.targetMinutes ? (
                    <ReferenceLine
                      y={last.targetMinutes}
                      stroke="var(--ink-3)"
                      strokeDasharray="4 4"
                      ifOverflow="extendDomain"
                    />
                  ) : null}
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => formatSleepDuration(Number(value))}
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="asleepMinutes"
                    stroke="var(--color-asleepMinutes)"
                    strokeWidth={3}
                    fill="url(#sleep-fill)"
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ChartContainer>
            </div>
          </Section>

          <Details summary={<Trans>All nights</Trans>}>
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
                      <TableCell className="num text-left text-ink-3">{night.date}</TableCell>
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
          </Details>
        </>
      )}
    </Page>
  );
}
