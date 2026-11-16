import { Trans, useLingui } from "@lingui/react/macro";
import {
  formatKg,
  evenAxisTicks,
  formatKgDelta,
  summarizeDailyWeights,
  weightSourceLabel,
} from "@openvalens/api/presenters/body";
import { kgToLb, type ProductDisplaySettings } from "@openvalens/api/presenters/product-formatting";
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
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarDays,
  CalendarRange,
  PersonStanding,
  Scale,
  TrendingUp,
} from "lucide-react";
import { CartesianGrid, ComposedChart, Line, Scatter, XAxis, YAxis } from "recharts";

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
import { ProductSettingsStatus } from "@/components/product-settings-status";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { friendlyDate, localIsoDay } from "@/utils/friendly";
import { client } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";
import { useCacheFirst } from "@/utils/sync-engine";
import { ModuleHiddenNote } from "@/components/module-hidden-note";

export const Route = createFileRoute("/_auth/body")({
  component: BodyPage,
});

type Settings = ProductDisplaySettings | null | undefined;

function weightUnit(settings: Settings): string {
  return settings?.units === "imperial" ? "lb" : "kg";
}

const toDisplay = (kg: number, settings: Settings) =>
  settings?.units === "imperial" ? kgToLb(kg) : kg;

function BodyPage() {
  const daily = useCacheFirst("body.dailyWeights", () => client.body.dailyWeights({ limit: 90 }));
  const summary = summarizeDailyWeights(daily.data ?? []);
  const trend = useQuery({
    queryKey: ["body", "weightTrend", localIsoDay()],
    queryFn: () =>
      client.body.weightTrend({ from: localIsoDay(new Date(), -89), to: localIsoDay() }),
    retry: false,
  });
  const settingsQuery = useProductSettings();
  const settings = settingsQuery.data;
  const { t, i18n } = useLingui();
  const unit = weightUnit(settings);

  const trendByDate = new Map(
    (trend.data?.points ?? [])
      .filter((point) => point.trendKg !== null)
      .map((point) => [point.date, point.trendKg as number]),
  );
  const series = summary.series.map((point) => ({
    date: point.date,
    weight: Math.round(toDisplay(point.weightKg, settings) * 10) / 10,
    trend: trendByDate.has(point.date)
      ? Math.round(toDisplay(trendByDate.get(point.date)!, settings) * 10) / 10
      : null,
  }));
  const values = series.flatMap((point) =>
    point.trend === null ? [point.weight] : [point.weight, point.trend],
  );
  const ticks = evenAxisTicks(Math.min(...values) - 0.5, Math.max(...values) + 0.5);
  const tickText = (value: number) =>
    value.toLocaleString(settings?.locale ?? i18n.locale, { maximumFractionDigits: 1 });
  const chartConfig = {
    weight: { label: t`Weight (${unit})`, color: "var(--tone-weight)" },
    trend: { label: t`7-day trend (${unit})`, color: "var(--tone-weight)" },
  } satisfies ChartConfig;

  return (
    <Page>
      <ModuleHiddenNote module="body" />
      <PageHeader title={<Trans>Body</Trans>} actions={<SyncStatusBadge />} />

      <ProductSettingsStatus />

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="grid min-w-0 content-start gap-8">
          {daily.isPending ? (
            <div className="grid gap-4">
              <Skeleton className="h-96 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : daily.isError ? (
            <ErrorState
              title={<Trans>Could not load weight.</Trans>}
              action={
                <Button variant="outline" onClick={() => void daily.refetch()}>
                  <Trans>Retry</Trans>
                </Button>
              }
            />
          ) : !summary.latest ? (
            <EmptyState
              icon={Scale}
              title={<Trans>No weight yet</Trans>}
              description={
                <Trans>
                  Sync a scale through Health Connect or Apple Health, or log a weight with +.
                </Trans>
              }
            />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 sm:gap-4">
                <StatTile
                  compact
                  icon={Scale}
                  tone="weight"
                  label={<Trans>Weight</Trans>}
                  value={formatKg(summary.latest.weightKg, settings)}
                  note={friendlyDate(i18n, summary.latest.date)}
                />
                <StatTile
                  compact
                  icon={CalendarDays}
                  tone="weight"
                  label={<Trans>Change, 7 days</Trans>}
                  value={
                    summary.change7d === null
                      ? "—"
                      : formatKgDelta(i18n, summary.change7d, settings)
                  }
                />
                <StatTile
                  compact
                  icon={CalendarRange}
                  tone="weight"
                  label={<Trans>Change, 30 days</Trans>}
                  value={
                    summary.change30d === null
                      ? "—"
                      : formatKgDelta(i18n, summary.change30d, settings)
                  }
                />
              </div>
              <Section
                icon={TrendingUp}
                tone="weight"
                title={<Trans>Last 90 days</Trans>}
                info={
                  <Trans>
                    Dots are your daily weights. The line is the 7-day trend: the average of the
                    recorded days in each week, once a week has at least three.
                  </Trans>
                }
              >
                <div className="sheet p-5">
                  <ChartContainer config={chartConfig} className="aspect-auto h-72 w-full">
                    <ComposedChart data={series} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--rule)" strokeDasharray="4 6" />
                      <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        minTickGap={48}
                        tickMargin={8}
                        tickFormatter={(value: string) => friendlyDate(i18n, value)}
                      />
                      <YAxis
                        domain={[ticks[0] ?? "auto", ticks.at(-1) ?? "auto"]}
                        ticks={ticks}
                        interval={0}
                        tickLine={false}
                        axisLine={false}
                        width={44}
                        tickFormatter={tickText}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            formatter={(value, name) => [
                              `${tickText(Number(value))} ${unit}`,
                              name === "trend" ? t`7-day trend` : t`Weight`,
                            ]}
                          />
                        }
                      />
                      <Scatter
                        dataKey="weight"
                        fill="var(--color-weight)"
                        fillOpacity={0.35}
                        shape="circle"
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="trend"
                        stroke="var(--color-trend)"
                        strokeWidth={3}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ChartContainer>
                </div>
              </Section>

              <Details summary={<Trans>All readings</Trans>}>
                <div className="sheet min-w-0 px-2 pt-2 pb-1">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <Trans>Date</Trans>
                        </TableHead>
                        <TableHead>
                          <Trans>Source</Trans>
                        </TableHead>
                        <TableHead className="num">
                          <Trans>Weight</Trans>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...summary.series]
                        .reverse()
                        .slice(0, 14)
                        .map((point) => {
                          const source =
                            daily.data?.find((row) => row.date === point.date)?.source ?? "";
                          return (
                            <TableRow key={point.date}>
                              <TableCell className="num text-left text-ink-3">
                                {friendlyDate(i18n, point.date)}
                              </TableCell>
                              <TableCell className="text-ink-3">
                                {i18n._(weightSourceLabel(source))}
                              </TableCell>
                              <TableCell className="num text-ink">
                                {formatKg(point.weightKg, settings)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </div>
              </Details>
            </>
          )}
        </div>

        <BodyCompositionCard settings={settings} />
      </div>
    </Page>
  );
}

type DexaScanRow = {
  id: number;
  date: string;
  bodyFatPct: number | null;
  leanMass: number | null;
  fatMass: number | null;
};

function readScan(row: Record<string, unknown>): DexaScanRow {
  const num = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    id: Number(row.id),
    date: String(row.date ?? ""),
    bodyFatPct: num(row.bodyFatPct),
    leanMass: num(row.leanMass),
    fatMass: num(row.fatMass),
  };
}

/**
 * The latest DEXA scan beside the weight: total body fat, lean and fat mass,
 * and the change since the scan before. The regional view is on Body map.
 */
function BodyCompositionCard({ settings }: { settings: Settings }) {
  const { t, i18n } = useLingui();
  const scans = useQuery({
    queryKey: ["body", "dexaScans"],
    queryFn: async () =>
      ((await client.body.listDexaScans({})) as Record<string, unknown>[])
        .map(readScan)
        .sort((a, b) => b.date.localeCompare(a.date)),
    retry: false,
  });
  // A member without DEXA access, or with no scans, sees nothing here.
  if (scans.isError || (scans.data && scans.data.length === 0)) return null;

  const latest = scans.data?.[0];
  const earlier = scans.data?.[1];
  const percent = (value: number) =>
    `${value.toLocaleString(i18n.locale, { maximumFractionDigits: 1 })}%`;
  const pointDelta = (now: number | null, before: number | null | undefined) => {
    if (now === null || before === null || before === undefined) return null;
    const delta = Math.round((now - before) * 10) / 10;
    if (delta === 0) return t`No change`;
    const size = Math.abs(delta).toLocaleString(i18n.locale, { maximumFractionDigits: 1 });
    return delta > 0 ? t`+${size} pts` : t`−${size} pts`;
  };
  const massDelta = (now: number | null, before: number | null | undefined) =>
    now === null || before === null || before === undefined
      ? null
      : formatKgDelta(i18n, (now - before) / 1000, settings);
  const since = earlier ? friendlyDate(i18n, earlier.date) : null;

  return (
    <Section icon={PersonStanding} tone="weight" title={<Trans>Body composition</Trans>}>
      <div className="sheet grid gap-5 p-5">
        {scans.isPending || !latest ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : (
          <>
            <p className="text-sm text-ink-3">
              {since ? (
                <Trans>
                  DEXA scan, {friendlyDate(i18n, latest.date)}. Change since {since}.
                </Trans>
              ) : (
                <Trans>DEXA scan, {friendlyDate(i18n, latest.date)}</Trans>
              )}
            </p>
            <dl className="grid grid-cols-2 gap-4 lg:grid-cols-1 xl:grid-cols-2">
              {latest.bodyFatPct !== null ? (
                <Figure
                  label={t`Body fat`}
                  value={percent(latest.bodyFatPct)}
                  note={pointDelta(latest.bodyFatPct, earlier?.bodyFatPct)}
                />
              ) : null}
              {latest.leanMass !== null ? (
                <Figure
                  label={t`Lean mass`}
                  value={formatKg(latest.leanMass / 1000, settings)}
                  note={massDelta(latest.leanMass, earlier?.leanMass)}
                />
              ) : null}
              {latest.fatMass !== null ? (
                <Figure
                  label={t`Fat mass`}
                  value={formatKg(latest.fatMass / 1000, settings)}
                  note={massDelta(latest.fatMass, earlier?.fatMass)}
                />
              ) : null}
            </dl>
            <Link
              to="/body-map"
              className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-signal no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Trans>See it by region on Body map</Trans>
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </>
        )}
      </div>
    </Section>
  );
}
