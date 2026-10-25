import { Trans, useLingui } from "@lingui/react/macro";
import {
  formatDistanceMeters,
  formatKcalories,
  formatSteps,
} from "@openvalens/api/presenters/activity";
import { formatKg, formatKgDelta, summarizeDailyWeights } from "@openvalens/api/presenters/body";
import { kgToLb } from "@openvalens/api/presenters/product-formatting";
import { COCKPIT_SLEEP_WINDOW_DAYS } from "@openvalens/api/presenters/cockpit";
import {
  formatClockTime,
  formatSleepDuration,
  sleepStatusLabel,
} from "@openvalens/api/presenters/sleep";
import { formatBpm } from "@openvalens/api/presenters/vitals";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@openvalens/ui/components/chart";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { InsightsSection } from "@/components/insights-section";
import { ErrorState, Figure, Page, PageHeader, Section } from "@/components/page";
import { ProductSettingsStatus } from "@/components/product-settings-status";
import { ProfileSetupPrompt } from "@/components/profile-setup-prompt";
import { orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";

export const Route = createFileRoute("/_auth/dashboard")({
  component: DashboardPage,
});

type CockpitBlock = {
  key: "weight" | "sleep" | "activity" | "vitals";
  title: string;
  to: "/body" | "/records/sleep" | "/records/activity" | "/records/vitals";
  primary: string;
  secondary: string;
  tertiary: string | null;
};

// The dashboard's chart reads the same 90-day window the Body screen does.
const WEIGHT_TREND_DAYS = 90;

function DashboardPage() {
  const weight = useQuery(
    orpc.body.dailyWeights.queryOptions({ input: { limit: WEIGHT_TREND_DAYS } }),
  );
  const sleep = useQuery(
    orpc.sleep.summary.queryOptions({ input: { days: COCKPIT_SLEEP_WINDOW_DAYS } }),
  );
  const activity = useQuery(orpc.activity.dailyTotals.queryOptions({ input: { days: 1 } }));
  const vitals = useQuery(orpc.vitals.daily.queryOptions({ input: { days: 1 } }));
  const settingsQuery = useProductSettings();
  const settings = settingsQuery.data;
  const { t, i18n } = useLingui();
  const windowDays = COCKPIT_SLEEP_WINDOW_DAYS;

  const isPending = weight.isPending || sleep.isPending || activity.isPending || vitals.isPending;
  const isError = weight.isError || sleep.isError || activity.isError || vitals.isError;

  const weightRow = weight.data?.[0];
  const sleepRow = sleep.data?.lastNight;
  const activityRow = activity.data?.at(-1);
  const vitalsRow = vitals.data?.at(-1);

  const blocks: CockpitBlock[] = [
    {
      key: "weight",
      title: t`Weight`,
      to: "/body",
      primary: weightRow ? formatKg(weightRow.weightKg, settings) : "—",
      secondary: weightRow ? t`Last reading, ${weightRow.date}` : t`No reading yet`,
      tertiary: null,
    },
    {
      key: "sleep",
      title: t`Sleep`,
      to: "/records/sleep",
      primary: sleepRow ? formatSleepDuration(sleepRow.asleepMinutes) : "—",
      secondary: sleepRow
        ? t`Latest night, ${sleepRow.date}: ${i18n._(sleepStatusLabel(sleepRow.status))}`
        : t`No sleep logged in the last ${windowDays} days`,
      tertiary:
        sleepRow && sleepRow.mainSleepStart && sleepRow.mainSleepEnd
          ? `${formatClockTime(sleepRow.mainSleepStart, settings)} to ${formatClockTime(sleepRow.mainSleepEnd, settings)}`
          : null,
    },
    {
      key: "activity",
      title: t`Activity`,
      to: "/records/activity",
      primary: activityRow ? formatSteps(activityRow.steps ?? 0) : "—",
      secondary: activityRow
        ? `${activityRow.date}: ${formatKcalories(activityRow.activeCaloriesKcal ?? 0)}, ${formatDistanceMeters(activityRow.distanceMeters ?? 0, settings)}`
        : t`No activity logged`,
      tertiary: null,
    },
    {
      key: "vitals",
      title: t`Heart rate`,
      to: "/records/vitals",
      primary:
        vitalsRow && vitalsRow.heartRate.avgBpm !== null
          ? formatBpm(vitalsRow.heartRate.avgBpm)
          : "—",
      secondary: vitalsRow ? t`Average, ${vitalsRow.date}` : t`No reading yet`,
      tertiary: null,
    },
  ];

  return (
    <Page>
      <PageHeader
        title={<Trans>Dashboard</Trans>}
        description={
          <Trans>The latest reading of each measure, and how your weight has moved.</Trans>
        }
        actions={
          <Link
            to="/records/timeline"
            className="font-display text-sm font-medium text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2"
          >
            <Trans>Full timeline</Trans>
          </Link>
        }
      />

      <ProductSettingsStatus />

      <ProfileSetupPrompt />

      {isPending ? (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : isError ? (
        <ErrorState
          title={<Trans>Could not load your data.</Trans>}
          description={<Trans>Check your connection, then reload the page.</Trans>}
        />
      ) : (
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <DaySheet blocks={blocks} />
          <WeightTrend
            rows={weight.data ?? []}
            settings={settings}
            emptyLabel={t`No weight logged in the last ${WEIGHT_TREND_DAYS} days.`}
          />
        </div>
      )}

      <InsightsSection />
    </Page>
  );
}

/** Today's figures, printed on one sheet: a measure per row, its figure in mono. */
function DaySheet({ blocks }: { blocks: CockpitBlock[] }) {
  return (
    <Section title={<Trans>Latest readings</Trans>}>
      <div className="sheet">
        <ul className="divide-y divide-rule">
          {blocks.map((block) => (
            <li key={block.key}>
              <Link
                to={block.to}
                className="group grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 px-5 py-4 no-underline transition-colors duration-[var(--dur-short)] hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <span className="font-display text-base font-medium text-ink">{block.title}</span>
                <span className="num row-span-2 self-center text-right text-2xl font-medium tracking-[-0.03em] text-ink">
                  {block.primary}
                </span>
                <span className="text-sm text-ink-3">
                  {block.secondary}
                  {block.tertiary ? <span className="block">{block.tertiary}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

type WeightRow = Parameters<typeof summarizeDailyWeights>[0][number];
type Settings = Parameters<typeof formatKg>[1];

function weightAxisFormatter(value: number, settings: Settings): string {
  if (settings?.units === "imperial") return Math.round(kgToLb(value)).toString();
  return value.toFixed(0);
}

/** One chart, set large: the weight series over the window, with its change. */
function WeightTrend({
  rows,
  settings,
  emptyLabel,
}: {
  rows: WeightRow[];
  settings: Settings;
  emptyLabel: string;
}) {
  const { t, i18n } = useLingui();
  const summary = summarizeDailyWeights(rows);
  const unit = settings?.units === "imperial" ? "lb" : "kg";
  const config: ChartConfig = { weightKg: { label: t`Weight (${unit})`, color: "var(--chart-1)" } };

  return (
    <Section title={<Trans>Weight, last {WEIGHT_TREND_DAYS} days</Trans>}>
      <div className="sheet grid gap-5 px-5 pt-4 pb-5">
        {summary.latest ? (
          <>
            <dl className="grid grid-cols-3 divide-x divide-rule">
              <Figure
                className="pr-4"
                label={summary.latest.date}
                value={formatKg(summary.latest.weightKg, settings)}
              />
              <Figure
                className="px-4"
                label={<Trans>7 days</Trans>}
                value={
                  summary.change7d === null ? "—" : formatKgDelta(i18n, summary.change7d, settings)
                }
              />
              <Figure
                className="pl-4"
                label={<Trans>30 days</Trans>}
                value={
                  summary.change30d === null
                    ? "—"
                    : formatKgDelta(i18n, summary.change30d, settings)
                }
              />
            </dl>
            <ChartContainer config={config} className="aspect-auto h-60 w-full">
              <LineChart data={summary.series} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--rule)" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={48} />
                <YAxis
                  domain={["dataMin - 1", "dataMax + 1"]}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  tickCount={4}
                  tickFormatter={(value: number) => weightAxisFormatter(value, settings)}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => [formatKg(value as number, settings), t`Weight`]}
                    />
                  }
                />
                <Line
                  dataKey="weightKg"
                  stroke="var(--color-weightKg)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartContainer>
          </>
        ) : (
          <div className="grid justify-items-start gap-2 py-4">
            <p className="text-ink-2">{emptyLabel}</p>
            <Link
              to="/body"
              className="font-display text-sm font-medium text-ink underline decoration-signal underline-offset-[0.15em]"
            >
              <Trans>Add a weight</Trans>
            </Link>
          </div>
        )}
      </div>
    </Section>
  );
}
