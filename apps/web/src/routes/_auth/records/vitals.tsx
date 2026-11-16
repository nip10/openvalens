import { Trans, useLingui } from "@lingui/react/macro";
import {
  formatBpm,
  formatBpmRange,
  summarizeVitals,
  vitalsSevenDayAverage,
  vitalsSourceLabel,
  vitalsTrendSeries,
  type VitalsTrendMetric,
} from "@openvalens/api/presenters/vitals";
import { evenAxisTicks } from "@openvalens/api/presenters/body";
import { Button } from "@openvalens/ui/components/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@openvalens/ui/components/chart";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Activity, Droplet, HeartPulse, List, Waves, Wind, type LucideIcon } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  Details,
  EmptyState,
  ErrorState,
  Figure,
  Page,
  PageHeader,
  Section,
  StatTile,
} from "@/components/page";
import {
  BloodPressureChart,
  BloodPressureList,
  useBloodPressureReadings,
} from "@/components/blood-pressure-section";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { friendlyDate } from "@/utils/friendly";
import { client } from "@/utils/orpc";
import { useCacheFirst } from "@/utils/sync-engine";
import { ModuleHiddenNote } from "@/components/module-hidden-note";

export const Route = createFileRoute("/_auth/records/vitals")({
  component: VitalsPage,
});

/** A number with at most one decimal in the reader's locale. */
function oneDecimal(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}

function VitalsPage() {
  const daily = useCacheFirst("vitals.daily", () => client.vitals.daily({ days: 30 }));
  const samples = useCacheFirst("vitals.recentSamples", () =>
    client.vitals.recentSamples({ limit: 20 }),
  );
  const bloodPressure = useBloodPressureReadings();
  const { t, i18n } = useLingui();
  const [metric, setMetric] = useState<VitalsTrendMetric>("heart_rate");

  const header = <PageHeader title={<Trans>Vitals</Trans>} actions={<SyncStatusBadge />} />;

  if (daily.isPending || samples.isPending) {
    return (
      <Page>
        <ModuleHiddenNote module="heart" />
        {header}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          <Skeleton className="h-36 w-full rounded-3xl" />
          <Skeleton className="h-36 w-full rounded-3xl" />
          <Skeleton className="h-36 w-full rounded-3xl" />
        </div>
        <Skeleton className="h-72 w-full rounded-3xl" />
      </Page>
    );
  }

  if (daily.isError || !daily.data || samples.isError) {
    return (
      <Page>
        <ModuleHiddenNote module="heart" />
        {header}
        <ErrorState
          title={<Trans>Could not load vitals.</Trans>}
          action={
            <Button
              variant="outline"
              onClick={() => {
                void daily.refetch();
                void samples.refetch();
              }}
            >
              <Trans>Retry</Trans>
            </Button>
          }
        />
      </Page>
    );
  }

  const summary = summarizeVitals(daily.data, samples.data ?? []);
  const today = summary.today;
  const readings = bloodPressure.data ?? [];
  const locale = i18n.locale;
  const avg = (key: VitalsTrendMetric) => vitalsSevenDayAverage(summary.days, key);

  type TileSpec = {
    metric: VitalsTrendMetric;
    icon: LucideIcon;
    label: string;
    chartTitle: string;
    unit: string;
    value: number | null;
    format: (value: number) => string;
    note: string | null;
  };
  const usual = (value: number | null, format: (v: number) => string, unit: string) =>
    value === null ? null : t`7-day avg: ${format(value)} ${unit}`;
  const whole = (value: number) => `${Math.round(value)}`;
  const decimal = (value: number) => oneDecimal(value, locale);
  const oxygen = summary.latestOxygenSaturation;
  const tiles: TileSpec[] = [
    {
      metric: "heart_rate",
      icon: HeartPulse,
      label: t`Avg heart rate`,
      chartTitle: t`Average heart rate, 30 days`,
      unit: "bpm",
      value: today?.heartRate.avgBpm ?? null,
      format: whole,
      note: usual(avg("heart_rate"), whole, "bpm"),
    },
    {
      metric: "resting_heart_rate",
      icon: Activity,
      label: t`Resting heart rate`,
      chartTitle: t`Resting heart rate, 30 days`,
      unit: "bpm",
      value: today?.restingHeartRate.avgBpm ?? null,
      format: whole,
      note: usual(avg("resting_heart_rate"), whole, "bpm"),
    },
    ...(summary.latestHrv
      ? [
          {
            metric: "hrv" as const,
            icon: Waves,
            label: t`Overnight HRV`,
            chartTitle: t`Overnight HRV, 30 days`,
            unit: "ms",
            value: summary.latestHrv.avgMs,
            format: whole,
            note: usual(avg("hrv"), whole, "ms"),
          },
        ]
      : []),
    ...(oxygen
      ? [
          {
            metric: "spo2" as const,
            icon: Droplet,
            label: t`Blood oxygen`,
            chartTitle: t`Overnight blood oxygen, 30 days`,
            unit: "%",
            value: oxygen.avgPercent,
            format: whole,
            // The lowest reading only when it says something the figure does not.
            note:
              oxygen.minPercent !== null &&
              Math.round(oxygen.minPercent) !== Math.round(oxygen.avgPercent)
                ? t`Lowest ${whole(oxygen.minPercent)}% overnight`
                : usual(avg("spo2"), whole, "%"),
          },
        ]
      : []),
    ...(summary.latestRespiratoryRate
      ? [
          {
            metric: "breathing" as const,
            icon: Wind,
            label: t`Breathing rate`,
            chartTitle: t`Overnight breathing rate, 30 days`,
            unit: t`breaths/min`,
            value: summary.latestRespiratoryRate.avgBreathsPerMinute,
            format: decimal,
            note: usual(avg("breathing"), decimal, t`breaths/min`),
          },
        ]
      : []),
  ];
  const active = tiles.find((tile) => tile.metric === metric) ?? tiles[0]!;
  const series = vitalsTrendSeries(summary.days, active.metric);
  const seriesValues = series.flatMap((point) => (point.value === null ? [] : [point.value]));
  const pad = active.metric === "breathing" ? 0.5 : 2;
  const ticks = evenAxisTicks(
    Math.min(...seriesValues) - pad,
    Math.min(Math.max(...seriesValues) + pad, active.metric === "spo2" ? 100 : Infinity),
  );
  const trendConfig = {
    value: { label: active.label, color: "var(--tone-heart)" },
  } satisfies ChartConfig;

  return (
    <Page>
      <ModuleHiddenNote module="heart" />
      {header}

      {!today ? (
        <EmptyState
          icon={HeartPulse}
          title={<Trans>No vitals yet</Trans>}
          description={
            <Trans>
              Sync Health Connect or Apple Health from the mobile app, or log a reading with +.
            </Trans>
          }
        />
      ) : (
        <>
          <div
            className={
              tiles.length > 3
                ? "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5"
                : "grid grid-cols-2 gap-3 sm:gap-4"
            }
          >
            {tiles.map((tile) => (
              <StatTile
                key={tile.metric}
                compact
                icon={tile.icon}
                tone="heart"
                label={tile.label}
                value={tile.value === null ? "—" : tile.format(tile.value)}
                unit={tile.value === null ? undefined : tile.unit}
                note={tile.note}
                pressed={tile.metric === active.metric}
                onPress={() => setMetric(tile.metric)}
              />
            ))}
          </div>

          <div className="grid items-start gap-8 lg:grid-cols-2">
            <Section
              icon={active.icon}
              tone="heart"
              title={active.chartTitle}
              info={<Trans>Pick a tile above to chart it.</Trans>}
            >
              <div className="sheet p-5">
                <ChartContainer config={trendConfig} className="aspect-auto h-64 w-full">
                  <AreaChart data={series} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="vitals-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--tone-heart)" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="var(--tone-heart)" stopOpacity={0} />
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
                      tickLine={false}
                      axisLine={false}
                      width={52}
                      tickCount={5}
                      domain={[ticks[0] ?? "auto", ticks.at(-1) ?? "auto"]}
                      ticks={ticks}
                      interval={0}
                      tickFormatter={(value: number) => active.format(value)}
                      label={{
                        value: active.unit,
                        angle: -90,
                        position: "insideLeft",
                        fill: "var(--ink-3)",
                        fontSize: 12,
                      }}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value) => `${active.format(Number(value))} ${active.unit}`}
                        />
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="var(--color-value)"
                      strokeWidth={3}
                      fill="url(#vitals-fill)"
                      dot={false}
                      isAnimationActive={false}
                      connectNulls
                    />
                  </AreaChart>
                </ChartContainer>
              </div>
            </Section>

            <BloodPressureChart readings={readings} />
          </div>

          <Section icon={List} tone="heart" title={<Trans>Recent readings</Trans>}>
            <div className="grid items-start gap-6 lg:grid-cols-2">
              {readings.length > 0 ? <BloodPressureList readings={readings} /> : null}
              {(samples.data ?? []).length > 0 ? (
                <div className="grid gap-2">
                  <h3 className="text-sm font-semibold text-ink-2">
                    <Trans>Heart rate</Trans>
                  </h3>
                  <ul
                    className="sheet grid divide-y divide-rule px-5 py-1"
                    aria-label={t`Heart rate readings`}
                  >
                    {(samples.data ?? []).slice(0, 10).map((sample) => {
                      const iso = new Date(sample.sampledAt).toISOString();
                      return (
                        <li
                          key={sample.sampledAt}
                          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
                        >
                          <span className="num font-semibold text-ink">
                            {formatBpm(sample.heartRateBpm)}
                          </span>
                          <span className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
                            <span className="num">{`${friendlyDate(i18n, iso)} ${iso.slice(11, 16)}`}</span>
                            <span>{vitalsSourceLabel(sample.source, i18n)}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          </Section>

          <Details summary={<Trans>More about today</Trans>}>
            <dl className="sheet grid grid-cols-2 gap-4 p-5 sm:grid-cols-3">
              <Figure
                label={t`Latest reading`}
                value={formatBpm(summary.latestSample?.heartRateBpm ?? null)}
              />
              <Figure
                label={t`Source`}
                value={
                  <span className="font-body text-base tracking-normal">
                    {vitalsSourceLabel(summary.latestSample?.source ?? null, i18n)}
                  </span>
                }
              />
              <Figure
                label={t`Samples`}
                value={today.heartRate.sampleCount.toLocaleString(locale)}
              />
              <Figure
                className="col-span-2"
                label={t`Range`}
                value={formatBpmRange(
                  today.heartRate.avgBpm,
                  today.heartRate.minBpm,
                  today.heartRate.maxBpm,
                )}
                note={<Trans>Today</Trans>}
              />
            </dl>
          </Details>
        </>
      )}
    </Page>
  );
}
