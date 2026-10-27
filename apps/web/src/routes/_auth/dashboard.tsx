import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { formatSteps, summarizeDailyActivity } from "@openvalens/api/presenters/activity";
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
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Footprints, HeartPulse, History, Moon, Scale, TrendingUp } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { InsightsSection } from "@/components/insights-section";
import { ErrorState, Figure, Page, PageHeader, Section, StatTile } from "@/components/page";
import { ProductSettingsStatus } from "@/components/product-settings-status";
import { ProfileSetupPrompt } from "@/components/profile-setup-prompt";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import { friendlyDate, pillTone } from "@/utils/friendly";
import { useEnabledModules } from "@/utils/modules";
import { useProductSettings } from "@/utils/product-settings";

export const Route = createFileRoute("/_auth/dashboard")({
  component: DashboardPage,
});

// The dashboard's chart reads the same 90-day window the Body screen does.
const WEIGHT_TREND_DAYS = 90;

function greeting(hour: number) {
  if (hour < 12) return msg`Good morning`;
  if (hour < 18) return msg`Good afternoon`;
  return msg`Good evening`;
}

function DashboardPage() {
  const weight = useQuery(
    orpc.body.dailyWeights.queryOptions({ input: { limit: WEIGHT_TREND_DAYS } }),
  );
  const sleep = useQuery(
    orpc.sleep.summary.queryOptions({ input: { days: COCKPIT_SLEEP_WINDOW_DAYS } }),
  );
  const activity = useQuery(orpc.activity.dailyTotals.queryOptions({ input: { days: 30 } }));
  const vitals = useQuery(orpc.vitals.daily.queryOptions({ input: { days: 1 } }));
  const settingsQuery = useProductSettings();
  const settings = settingsQuery.data;
  const { data: session } = authClient.useSession();
  const { t, i18n } = useLingui();
  // Onboarding stage 1: tiles of hidden modules are left out (all show until
  // the person chooses, or while the profile loads).
  const { isEnabled } = useEnabledModules();

  const isPending = weight.isPending || sleep.isPending || activity.isPending || vitals.isPending;
  const isError = weight.isError || sleep.isError || activity.isError || vitals.isError;

  const weightRow = weight.data?.[0];
  const weightSummary = summarizeDailyWeights(weight.data ?? []);
  const sleepRow = sleep.data?.lastNight;
  const activityRow = activity.data?.at(-1);
  // "Usual" steps: the same seven-day average the Activity screen shows.
  const usualSteps = activity.data
    ? summarizeDailyActivity(activity.data).sevenDayAverageSteps || null
    : null;
  const vitalsRow = vitals.data?.at(-1);

  const now = new Date();
  const firstName = session?.user?.name?.trim().split(/\s+/)[0];
  const hello = i18n._(greeting(now.getHours()));
  const today = new Intl.DateTimeFormat(i18n.locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);

  return (
    <Page>
      <PageHeader
        title={firstName ? `${hello}, ${firstName}` : hello}
        description={today}
        actions={
          <Button variant="outline" asChild>
            <Link to="/records/timeline">
              <History aria-hidden="true" />
              <Trans>Full timeline</Trans>
            </Link>
          </Button>
        }
      />

      <ProductSettingsStatus />

      <ProfileSetupPrompt />

      {isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-40 w-full rounded-3xl" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title={<Trans>Could not load your data.</Trans>}
          description={<Trans>Check your connection, then reload the page.</Trans>}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {isEnabled("sleep") ? (
              <StatTile
                icon={Moon}
                tone="sleep"
                label={<Trans>Sleep</Trans>}
                to="/records/sleep"
                value={sleepRow ? formatSleepDuration(sleepRow.asleepMinutes) : "—"}
                meter={
                  sleepRow && sleepRow.targetMinutes
                    ? { value: sleepRow.asleepMinutes / sleepRow.targetMinutes }
                    : undefined
                }
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
            ) : null}
            {isEnabled("activity") ? (
              <StatTile
                icon={Footprints}
                tone="steps"
                label={<Trans>Steps</Trans>}
                to="/records/activity"
                value={activityRow ? formatSteps(activityRow.steps ?? 0) : "—"}
                meter={
                  activityRow && usualSteps
                    ? { value: (activityRow.steps ?? 0) / usualSteps }
                    : undefined
                }
                note={
                  activityRow
                    ? usualSteps
                      ? t`Your usual: ${formatSteps(Math.round(usualSteps))}`
                      : friendlyDate(i18n, activityRow.date)
                    : t`No activity logged`
                }
              />
            ) : null}
            {isEnabled("heart") ? (
              <StatTile
                icon={HeartPulse}
                tone="heart"
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
            ) : null}
            {isEnabled("body") ? (
              <StatTile
                icon={Scale}
                tone="weight"
                label={<Trans>Weight</Trans>}
                to="/body"
                value={weightRow ? formatKg(weightRow.weightKg, settings) : "—"}
                note={
                  weightSummary.change30d !== null
                    ? t`${formatKgDelta(i18n, weightSummary.change30d, settings)} in 30 days`
                    : weightRow
                      ? friendlyDate(i18n, weightRow.date)
                      : t`No reading yet`
                }
              />
            ) : null}
          </div>
          {isEnabled("body") ? (
            <WeightTrend
              rows={weight.data ?? []}
              settings={settings}
              emptyLabel={t`No weight logged in the last ${WEIGHT_TREND_DAYS} days.`}
            />
          ) : null}
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
  const config: ChartConfig = {
    weightKg: { label: t`Weight (${unit})`, color: "var(--tone-weight)" },
  };

  return (
    <Section
      icon={TrendingUp}
      tone="weight"
      title={<Trans>Weight, last {WEIGHT_TREND_DAYS} days</Trans>}
    >
      <div className="sheet grid gap-5 p-5">
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
              <AreaChart data={summary.series} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="weight-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--tone-weight)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--tone-weight)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--rule)" strokeDasharray="4 6" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={48}
                  tickFormatter={(value: string) => friendlyDate(i18n, value)}
                />
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
                <Area
                  type="monotone"
                  dataKey="weightKg"
                  stroke="var(--color-weightKg)"
                  strokeWidth={3}
                  fill="url(#weight-fill)"
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
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
