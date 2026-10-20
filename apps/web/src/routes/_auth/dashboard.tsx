import {
  formatDistanceMeters,
  formatKcalories,
  formatSteps,
} from "@openvalens/api/presenters/activity";
import { formatKg } from "@openvalens/api/presenters/body";
import { COCKPIT_SLEEP_WINDOW_DAYS } from "@openvalens/api/presenters/cockpit";
import { formatClockTime, formatSleepDuration } from "@openvalens/api/presenters/sleep";
import { formatBpm } from "@openvalens/api/presenters/vitals";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { InsightsSection } from "@/components/insights-section";
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
  primary: string;
  secondary: string;
  tertiary: string | null;
};

function DashboardPage() {
  const weight = useQuery(orpc.body.dailyWeights.queryOptions({ input: { limit: 1 } }));
  const sleep = useQuery(
    orpc.sleep.summary.queryOptions({ input: { days: COCKPIT_SLEEP_WINDOW_DAYS } }),
  );
  const activity = useQuery(orpc.activity.dailyTotals.queryOptions({ input: { days: 1 } }));
  const vitals = useQuery(orpc.vitals.daily.queryOptions({ input: { days: 1 } }));
  const settingsQuery = useProductSettings();
  const settings = settingsQuery.data;

  const isPending = weight.isPending || sleep.isPending || activity.isPending || vitals.isPending;
  const isError = weight.isError || sleep.isError || activity.isError || vitals.isError;

  const weightRow = weight.data?.[0];
  const sleepRow = sleep.data?.lastNight;
  const activityRow = activity.data?.at(-1);
  const vitalsRow = vitals.data?.at(-1);

  const blocks: CockpitBlock[] = [
    {
      key: "weight",
      title: "Weight",
      primary: weightRow ? formatKg(weightRow.weightKg, settings) : "—",
      secondary: weightRow ? `Last reading · ${weightRow.date}` : "No reading yet",
      tertiary: null,
    },
    {
      key: "sleep",
      title: "Sleep",
      primary: sleepRow ? formatSleepDuration(sleepRow.asleepMinutes) : "—",
      secondary: sleepRow
        ? `Latest night · ${sleepRow.date} · ${sleepRow.status}`
        : `No sleep logged in the last ${COCKPIT_SLEEP_WINDOW_DAYS} days`,
      tertiary:
        sleepRow && sleepRow.mainSleepStart && sleepRow.mainSleepEnd
          ? `${formatClockTime(sleepRow.mainSleepStart, settings)} → ${formatClockTime(sleepRow.mainSleepEnd, settings)}`
          : null,
    },
    {
      key: "activity",
      title: "Activity",
      primary: activityRow ? formatSteps(activityRow.steps ?? 0) : "—",
      secondary: activityRow
        ? `${activityRow.date} · ${formatKcalories(activityRow.activeCaloriesKcal ?? 0)} · ${formatDistanceMeters(activityRow.distanceMeters ?? 0, settings)}`
        : "No activity logged",
      tertiary: null,
    },
    {
      key: "vitals",
      title: "Heart rate",
      primary:
        vitalsRow && vitalsRow.heartRate.avgBpm !== null
          ? formatBpm(vitalsRow.heartRate.avgBpm)
          : "—",
      secondary: vitalsRow ? `Avg · ${vitalsRow.date}` : "No reading yet",
      tertiary: null,
    },
  ];

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Link to="/records/timeline" className="text-sm text-muted-foreground underline">
          Full timeline →
        </Link>
      </div>

      <ProductSettingsStatus />

      <ProfileSetupPrompt />

      <div className="mb-6">
        <InsightsSection />
      </div>

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : isError ? (
        <p className="text-sm text-muted-foreground">Could not load your data. Pull to retry.</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {blocks.map((block) => (
              <Card key={block.key}>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {block.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="font-mono text-2xl">{block.primary}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{block.secondary}</div>
                  {block.tertiary ? (
                    <div className="mt-1 text-sm text-muted-foreground">{block.tertiary}</div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
