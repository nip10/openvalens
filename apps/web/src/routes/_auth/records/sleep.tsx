import {
  formatClockTime,
  formatSleepDuration,
  formatSleepEfficiency,
  lastNightStages,
  sleepSeries,
  sleepStatusLabel,
  sleepStatusTone,
  type SleepDailyLike,
} from "@openvalens/api/presenters/sleep";
import { caffeineWindowsForNights, lastCaffeineText } from "@openvalens/api/presenters/drinks";
import { defaultNightToLog } from "@openvalens/api/presenters/manual-sleep";
import { formatBreathsPerMinute, formatPercent } from "@openvalens/api/presenters/vitals";
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
import { CalendarDays, Hourglass, ListOrdered, Moon, Target, TrendingUp } from "lucide-react";
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
import { ManualSleepNights } from "@/components/manual-sleep-section";
import { ProductSettingsStatus } from "@/components/product-settings-status";
import { useLogTarget } from "@/components/quick-log/log-launcher";
import { friendlyDate, localIsoDay, nightSpan, pillTone } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";
import { ModuleHiddenNote } from "@/components/module-hidden-note";

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

/** Overnight blood oxygen and breathing for a wake-up date, from the vitals days. */
type NightVitals = {
  spo2: number | null;
  spo2Low: number | null;
  breathing: number | null;
};

function useNightVitals(): Map<string, NightVitals> {
  const daily = useQuery(orpc.vitals.daily.queryOptions({ input: { days: 30 } }));
  const map = new Map<string, NightVitals>();
  for (const day of daily.data ?? []) {
    const spo2 = day.oxygenSaturation?.avgPercent ?? null;
    const breathing = day.respiratoryRate?.avgBreathsPerMinute ?? null;
    if (spo2 === null && breathing === null) continue;
    map.set(day.date, { spo2, spo2Low: day.oxygenSaturation?.minPercent ?? null, breathing });
  }
  return map;
}

/** "SpO₂ 96%, lowest 94% · Breathing 14.1/min", or null without readings. */
function useNightVitalsText() {
  const { t, i18n } = useLingui();
  return (vitals: NightVitals | undefined): string | null => {
    if (!vitals) return null;
    const parts: string[] = [];
    if (vitals.spo2 !== null) {
      const avg = formatPercent(vitals.spo2);
      parts.push(
        vitals.spo2Low !== null && Math.round(vitals.spo2Low) !== Math.round(vitals.spo2)
          ? t`SpO₂ ${avg}, lowest ${formatPercent(vitals.spo2Low)}`
          : t`SpO₂ ${avg}`,
      );
    }
    if (vitals.breathing !== null) {
      const rate = formatBreathsPerMinute(vitals.breathing, i18n.locale);
      parts.push(t`Breathing ${rate}`);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  };
}

function SleepPage() {
  const summary = useQuery(orpc.sleep.summary.queryOptions({ input: { days: 30 } }));
  // #443: a plain fact per night, only while the caffeine total is turned on.
  const caffeineWindows = caffeineWindowsForNights(summary.data?.days ?? []);
  const lastCaffeine = useQuery({
    ...orpc.nutritionDrinks.lastCaffeine.queryOptions({ input: caffeineWindows }),
    enabled: caffeineWindows.nights.length > 0,
  });
  const nightVitals = useNightVitals();
  const vitalsText = useNightVitalsText();
  const settingsQuery = useProductSettings();
  const settings = settingsQuery.data;
  const { t, i18n } = useLingui();
  const trendConfig = {
    asleepMinutes: { label: t`Asleep (min)`, color: "var(--tone-sleep)" },
  } satisfies ChartConfig;

  // The "+" offers the most recent night with nothing recorded.
  const recorded = new Set((summary.data?.days ?? []).map((day) => day.date));
  const night = defaultNightToLog(recorded);
  useLogTarget(
    summary.data
      ? { kind: "sleep", values: { bedtime: night.bedtime, wakeAt: night.wakeAt } }
      : null,
  );

  if (summary.isPending) {
    return (
      <Page>
        <ModuleHiddenNote module="sleep" />
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
        <ModuleHiddenNote module="sleep" />
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
  const recentNights = nights.slice(0, 7);
  const hasNightVitals = nights.some((entry) => nightVitals.has(entry.date));

  const stageTotal = stages.reduce((sum, entry) => sum + entry.minutes, 0);
  const caffeineByNight =
    lastCaffeine.data?.status === "ready"
      ? new Map(lastCaffeine.data.nights.map((night) => [night.key, night.lastCaffeineAt]))
      : null;
  const caffeineLine = (date: string) => {
    const at = caffeineByNight?.get(date);
    return at ? lastCaffeineText(formatClockTime(at, settings), i18n) : null;
  };
  const lastNightCaffeine = caffeineLine(last?.date ?? "");
  const lastNightVitals = vitalsText(nightVitals.get(last?.date ?? ""));
  // The most recent night is "Last night"; an older one says which night it was.
  const isLastNight = last ? last.date === localIsoDay() : false;
  const targetHours = last ? formatSleepDuration(last.targetMinutes) : "";

  return (
    <Page>
      <ModuleHiddenNote module="sleep" />
      <PageHeader title={<Trans>Sleep</Trans>} />

      <ProductSettingsStatus />

      {!last ? (
        <EmptyState
          icon={Moon}
          title={<Trans>No sleep yet</Trans>}
          description={
            <Trans>
              Track sleep through Health Connect or Apple Health, or log a night with +.
            </Trans>
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
                {isLastNight ? (
                  <Trans>Last night</Trans>
                ) : (
                  <>
                    <Trans>Latest night</Trans>
                    <span className="num font-normal text-ink-3">{nightSpan(i18n, last.date)}</span>
                  </>
                )}
              </h2>
              <p className="num font-display text-[3.25rem] leading-none font-medium tracking-[-0.02em] text-ink">
                {formatSleepDuration(last.asleepMinutes)}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
                <StatusText status={last.status} />
                <span className="num">
                  {`${formatClockTime(last.mainSleepStart, settings)} – ${formatClockTime(last.mainSleepEnd, settings)}`}
                </span>
                {lastNightCaffeine ? <span className="num">{lastNightCaffeine}</span> : null}
              </div>
            </div>
            {stageTotal > 0 || lastNightVitals ? (
              <div className="grid content-center gap-3">
                {stageTotal > 0 ? (
                  <>
                    <div
                      className="flex h-4 w-full gap-1 overflow-hidden rounded-full"
                      role="img"
                      aria-label={stages
                        .map(
                          (entry) => `${i18n._(entry.label)} ${formatSleepDuration(entry.minutes)}`,
                        )
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
                  </>
                ) : null}
                {lastNightVitals ? (
                  <p className="num text-sm text-ink-2">{lastNightVitals}</p>
                ) : null}
              </div>
            ) : null}
          </section>

          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <StatTile
              compact
              tone="sleep"
              icon={CalendarDays}
              label={t`7-day average`}
              value={formatSleepDuration(summary.data.sevenDayAverageMinutes)}
            />
            <StatTile
              compact
              tone="steps"
              icon={Hourglass}
              label={t`Sleep debt`}
              value={formatSleepDuration(summary.data.averageSleepDebtMinutes)}
              note={t`Average, last 7 nights`}
            />
            <StatTile
              compact
              tone="weight"
              icon={Target}
              label={t`Target`}
              value={formatSleepDuration(last.targetMinutes)}
            />
          </div>

          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <Section icon={TrendingUp} tone="sleep" title={<Trans>30-day trend</Trans>}>
              <div className="sheet p-5">
                <ChartContainer config={trendConfig} className="aspect-auto h-64 w-full">
                  <AreaChart data={series} margin={{ left: 0, right: 8, top: 18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="sleep-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--tone-sleep)" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="var(--tone-sleep)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="var(--rule)" strokeDasharray="4 6" />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={32}
                      tickFormatter={(value: string) => friendlyDate(i18n, value)}
                    />
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
                        label={{
                          value: t`Target ${targetHours}`,
                          position: "insideTopRight",
                          fill: "var(--ink-3)",
                          fontSize: 12,
                        }}
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

            <Section icon={ListOrdered} tone="sleep" title={<Trans>Last 7 nights</Trans>}>
              <ul
                className="sheet grid divide-y divide-rule px-5 py-1"
                aria-label={t`Last 7 nights`}
              >
                {recentNights.map((entry) => (
                  <NightRow
                    key={entry.date}
                    night={entry}
                    vitals={vitalsText(nightVitals.get(entry.date))}
                    settings={settings}
                  />
                ))}
              </ul>
            </Section>
          </div>

          <Details summary={<Trans>Show all nights</Trans>}>
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
                    {hasNightVitals ? (
                      <>
                        <TableHead className="num">SpO₂</TableHead>
                        <TableHead className="num">
                          <Trans>Breathing</Trans>
                        </TableHead>
                      </>
                    ) : null}
                    {caffeineByNight ? (
                      <TableHead>
                        <Trans>Last caffeine</Trans>
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nights.map((entry) => {
                    const vitals = nightVitals.get(entry.date);
                    return (
                      <TableRow key={entry.date}>
                        <TableCell className="num text-left text-ink-3">{entry.date}</TableCell>
                        <TableCell className="num text-ink">
                          {formatSleepDuration(entry.asleepMinutes)}
                        </TableCell>
                        <TableCell className="num">
                          {formatSleepDuration(entry.timeInBedMinutes)}
                        </TableCell>
                        <TableCell className="num">
                          {formatSleepEfficiency(entry.sleepEfficiencyPct)}
                        </TableCell>
                        <TableCell>
                          <StatusText status={entry.status} />
                        </TableCell>
                        {hasNightVitals ? (
                          <>
                            <TableCell className="num">{formatPercent(vitals?.spo2)}</TableCell>
                            <TableCell className="num">
                              {formatBreathsPerMinute(vitals?.breathing, i18n.locale)}
                            </TableCell>
                          </>
                        ) : null}
                        {caffeineByNight ? (
                          <TableCell className="num text-ink-3">
                            {formatClockTime(caffeineByNight.get(entry.date), settings)}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Details>
        </>
      )}

      <ManualSleepNights settings={settings} />
    </Page>
  );
}

/** One night in the open list: which night, how long, the window and its status. */
function NightRow({
  night,
  vitals,
  settings,
}: {
  night: SleepDailyLike;
  vitals: string | null;
  settings: Parameters<typeof formatClockTime>[1];
}) {
  const { i18n } = useLingui();
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-3">
      <span className="num text-sm font-semibold text-ink-2">{nightSpan(i18n, night.date)}</span>
      <span className="num text-right font-display text-lg font-medium text-ink">
        {formatSleepDuration(night.asleepMinutes)}
      </span>
      <span className="num text-sm text-ink-3">
        {`${formatClockTime(night.mainSleepStart, settings)} – ${formatClockTime(night.mainSleepEnd, settings)}`}
        {vitals ? ` · ${vitals}` : ""}
      </span>
      <span className="justify-self-end">
        <StatusText status={night.status} />
      </span>
    </li>
  );
}
