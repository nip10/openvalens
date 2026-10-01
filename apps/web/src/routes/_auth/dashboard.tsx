import { buildCockpitBlocks, type CockpitSnapshot } from "@openhealth/api/presenters/cockpit";
import { Badge } from "@openhealth/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@openhealth/ui/components/card";
import { Skeleton } from "@openhealth/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const weight = useQuery(orpc.body.dailyWeights.queryOptions({ input: { limit: 1 } }));
  const sleep = useQuery(orpc.sleep.summary.queryOptions({ input: { days: 1 } }));
  const activity = useQuery(orpc.activity.dailyTotals.queryOptions({ input: { days: 1 } }));
  const vitals = useQuery(orpc.vitals.daily.queryOptions({ input: { days: 1 } }));

  const isPending = weight.isPending || sleep.isPending || activity.isPending || vitals.isPending;
  const isError = weight.isError || sleep.isError || activity.isError || vitals.isError;

  const snapshot: CockpitSnapshot = {
    weight: weight.data?.[0]
      ? { date: weight.data[0].date, weightKg: weight.data[0].weightKg }
      : null,
    sleep: sleep.data?.lastNight
      ? {
          date: sleep.data.lastNight.date,
          asleepMinutes: sleep.data.lastNight.asleepMinutes,
          status: sleep.data.lastNight.status,
          bedtime: formatClockTime(sleep.data.lastNight.mainSleepStart),
          wakeAt: formatClockTime(sleep.data.lastNight.mainSleepEnd),
        }
      : null,
    activity: activity.data?.at(-1)
      ? {
          date: activity.data.at(-1)!.date,
          steps: activity.data.at(-1)!.steps ?? 0,
          activeCaloriesKcal: activity.data.at(-1)!.activeCaloriesKcal ?? 0,
          distanceMeters: activity.data.at(-1)!.distanceMeters ?? 0,
        }
      : null,
    vitals: vitals.data?.at(-1)
      ? { date: vitals.data.at(-1)!.date, heartRateAvgBpm: vitals.data.at(-1)!.heartRate.avgBpm }
      : null,
  };

  const blocks = buildCockpitBlocks(snapshot);

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Link to="/records/timeline" className="text-sm text-muted-foreground underline">
          Full timeline →
        </Link>
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

          <div className="mt-6">
            <InsightCard snapshot={snapshot} />
          </div>
        </>
      )}
    </div>
  );
}

function InsightCard({ snapshot }: { snapshot: CockpitSnapshot }) {
  const insight = useQuery({
    ...orpc.ai.generateInsight.queryOptions({
      input: { topic: "today's health snapshot", snapshot },
    }),
    retry: false,
  });

  if (insight.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">AI insight</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (insight.isError || !insight.data) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">AI insight</CardTitle>
        <Badge variant="outline">{insight.data.severity}</Badge>
      </CardHeader>
      <CardContent>
        <div className="font-medium">{insight.data.title}</div>
        <p className="mt-1 text-sm text-muted-foreground">{insight.data.body}</p>
      </CardContent>
    </Card>
  );
}

function formatClockTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
