import {
  formatDistanceMeters,
  formatKcalories,
  formatSteps,
  stepsSeries,
  summarizeDailyActivity,
} from "@openhealth/api/presenters/activity";
import { Card, CardContent, CardHeader, CardTitle } from "@openhealth/ui/components/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@openhealth/ui/components/chart";
import { Skeleton } from "@openhealth/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/records/activity")({
  component: ActivityPage,
});

const trendConfig = { steps: { label: "Steps", color: "var(--chart-1)" } } satisfies ChartConfig;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="font-mono text-lg">{value}</div>
    </div>
  );
}

function ActivityPage() {
  const totals = useQuery(orpc.activity.dailyTotals.queryOptions({ input: { days: 30 } }));

  if (totals.isPending) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Activity</h1>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (totals.isError || !totals.data) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Activity</h1>
        <p className="text-sm text-muted-foreground">
          Could not load activity.{" "}
          <button className="underline" onClick={() => void totals.refetch()}>
            Retry
          </button>
        </p>
      </div>
    );
  }

  const summary = summarizeDailyActivity(totals.data);
  const series = stepsSeries(summary.days);

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <h1 className="text-2xl font-semibold">Activity</h1>

      {!summary.today ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">No activity yet</p>
            <p className="text-sm text-muted-foreground">
              Sync Health Connect or Apple Health from the mobile app, or add an entry.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Today · {summary.today.date}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-4">
              <Stat label="Steps" value={formatSteps(summary.today.steps)} />
              <Stat label="Calories" value={formatKcalories(summary.today.activeCaloriesKcal)} />
              <Stat label="Distance" value={formatDistanceMeters(summary.today.distanceMeters)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>30-day trend</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={trendConfig} className="h-56 w-full">
                <BarChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={36}
                    tickFormatter={(value: number) => formatSteps(value)}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="steps" fill="var(--color-steps)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>This week</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-4">
              <Stat label="Steps / active day" value={formatSteps(summary.sevenDayAverageSteps)} />
              <Stat
                label="Calories / day"
                value={formatKcalories(summary.sevenDayAverageCalories)}
              />
              <Stat
                label="Distance / day"
                value={formatDistanceMeters(summary.sevenDayAverageDistance)}
              />
            </CardContent>
          </Card>

          <Card className="py-0">
            <ul className="divide-y divide-border">
              {[...summary.days]
                .reverse()
                .slice(0, 14)
                .map((day) => (
                  <li key={day.date} className="flex items-center justify-between px-4 py-3">
                    <span className="font-mono text-sm text-muted-foreground">{day.date}</span>
                    <span className="flex items-center gap-6 text-sm">
                      <span className="font-mono">{formatSteps(day.steps)} steps</span>
                      <span className="font-mono text-muted-foreground">
                        {formatKcalories(day.activeCaloriesKcal)}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {formatDistanceMeters(day.distanceMeters)}
                      </span>
                    </span>
                  </li>
                ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
