import { Trans, useLingui } from "@lingui/react/macro";
import { formatSteps } from "@openvalens/api/presenters/activity";
import { formatKg, formatKgDelta, summarizeDailyWeights } from "@openvalens/api/presenters/body";
import { kgToLb } from "@openvalens/api/presenters/product-formatting";
import { COCKPIT_SLEEP_WINDOW_DAYS } from "@openvalens/api/presenters/cockpit";
import {
  formatSleepDuration,
  sleepStatusLabel,
  sleepStatusTone,
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
import { Footprints, HeartPulse, Moon, Scale, TrendingUp } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { InsightsSection } from "@/components/insights-section";
import { ErrorState, Figure, Page, PageHeader, Section, StatTile } from "@/components/page";
import { ProductSettingsStatus } from "@/components/product-settings-status";
import { ProfileSetupPrompt } from "@/components/profile-setup-prompt";
import { orpc } from "@/utils/orpc";
import { friendlyDate, pillTone } from "@/utils/friendly";
import { useProductSettings } from "@/utils/product-settings";

export const Route = createFileRoute("/_auth/dashboard")({
  component: DashboardPage,
});

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

  const isPending = weight.isPending || sleep.isPending || activity.isPending || vitals.isPending;
  const isError = weight.isError || sleep.isError || activity.isError || vitals.isError;

  const weightRow = weight.data?.[0];
  const sleepRow = sleep.data?.lastNight;
  const activityRow = activity.data?.at(-1);
  const vitalsRow = vitals.data?.at(-1);

  return (
    <Page>
      <PageHeader
        title={<Trans>Dashboard</Trans>}
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title={<Trans>Could not load your data.</Trans>}
          description={<Trans>Check your connection, then reload the page.</Trans>}
        />
      ) : (
        <>
          <Section title={<Trans>Latest readings</Trans>}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                icon={Scale}
                label={<Trans>Weight</Trans>}
                to="/body"
                value={weightRow ? formatKg(weightRow.weightKg, settings) : "—"}
                note={weightRow ? friendlyDate(i18n, weightRow.date) : t`No reading yet`}
              />
              <StatTile
                icon={Moon}
                label={<Trans>Sleep</Trans>}
                to="/records/sleep"
                value={sleepRow ? formatSleepDuration(sleepRow.asleepMinutes) : "—"}
                status={
                  sleepRow
                    ? {
                        label: i18n._(sleepStatusLabel(sleepRow.status)),
                        tone: pillTone(sleepStatusTone(sleepRow.status)),
                      }
                    : undefined
                }
                note={sleepRow ? undefined : t`No reading yet`}
              />
              <StatTile
                icon={Footprints}
                label={<Trans>Steps</Trans>}
                to="/records/activity"
                value={activityRow ? formatSteps(activityRow.steps ?? 0) : "—"}
                note={activityRow ? friendlyDate(i18n, activityRow.date) : t`No activity logged`}
              />
              <StatTile
                icon={HeartPulse}
                label={<Trans>Heart rate</Trans>}
                to="/records/vitals"
                value={
                  vitalsRow && vitalsRow.heartRate.avgBpm !== null
                    ? formatBpm(vitalsRow.heartRate.avgBpm)
                    : "—"
                }
                note={
                  vitalsRow ? t`Average, ${friendlyDate(i18n, vitalsRow.date)}` : t`No reading yet`
                }
              />
            </div>
          </Section>
          <WeightTrend
            rows={weight.data ?? []}
            settings={settings}
            emptyLabel={t`No weight logged in the last ${WEIGHT_TREND_DAYS} days.`}
          />
        </>
      )}

      <InsightsSection />
    </Page>
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
    <Section icon={TrendingUp} title={<Trans>Weight, last {WEIGHT_TREND_DAYS} days</Trans>}>
      <div className="sheet grid gap-5 px-5 pt-4 pb-5">
        {summary.latest ? (
          <>
            <dl className="grid grid-cols-3 divide-x divide-rule">
              <Figure
                className="pr-4"
                label={friendlyDate(i18n, summary.latest.date)}
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
            <ChartContainer config={config} className="aspect-auto h-56 w-full">
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
