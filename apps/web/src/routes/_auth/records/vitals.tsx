import {
  formatBpm,
  formatBpmRange,
  heartRateSeries,
  summarizeVitals,
  vitalsSourceLabel,
} from "@openhealth/api/presenters/vitals";
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
import { Line, LineChart, XAxis, YAxis } from "recharts";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/records/vitals")({
  component: VitalsPage,
});

const trendConfig = { avgBpm: { label: "Avg bpm", color: "var(--chart-1)" } } satisfies ChartConfig;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="font-mono text-lg">{value}</div>
    </div>
  );
}

function VitalsPage() {
  const daily = useQuery(orpc.vitals.daily.queryOptions({ input: { days: 30 } }));
  const samples = useQuery(orpc.vitals.recentSamples.queryOptions({ input: { limit: 20 } }));

  if (daily.isPending || samples.isPending) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Vitals</h1>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (daily.isError || !daily.data || samples.isError) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Vitals</h1>
        <p className="text-sm text-muted-foreground">
          Could not load vitals.{" "}
          <button
            className="underline"
            onClick={() => {
              void daily.refetch();
              void samples.refetch();
            }}
          >
            Retry
          </button>
        </p>
      </div>
    );
  }

  const summary = summarizeVitals(daily.data, samples.data ?? []);
  const series = heartRateSeries(summary.days);

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <h1 className="text-2xl font-semibold">Vitals</h1>

      {!summary.today ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">No vitals yet</p>
            <p className="text-sm text-muted-foreground">
              Sync Health Connect or Apple Health from the mobile app, or add a reading.
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
              <Stat label="Avg heart rate" value={formatBpm(summary.today.heartRate.avgBpm)} />
              <Stat
                label="Range"
                value={formatBpmRange(
                  summary.today.heartRate.avgBpm,
                  summary.today.heartRate.minBpm,
                  summary.today.heartRate.maxBpm,
                )}
              />
              <Stat
                label="Samples"
                value={summary.today.heartRate.sampleCount.toLocaleString("en-US")}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>30-day trend</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={trendConfig} className="h-56 w-full">
                <LineChart data={series}>
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={36}
                    domain={["dataMin - 5", "dataMax + 5"]}
                    tickFormatter={(value: number) => `${Math.round(value)}`}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent formatter={(value) => formatBpm(Number(value))} />
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="avgBpm"
                    stroke="var(--color-avgBpm)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>This week</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-4">
              <Stat label="7-day average" value={formatBpm(summary.sevenDayAverageBpm)} />
              <Stat
                label="Latest reading"
                value={formatBpm(summary.latestSample?.heartRateBpm ?? null)}
              />
              <Stat
                label="Source"
                value={vitalsSourceLabel(summary.latestSample?.source ?? null)}
              />
            </CardContent>
          </Card>

          <Card className="py-0">
            <ul className="divide-y divide-border">
              {(samples.data ?? []).map((sample) => (
                <li key={sample.sampledAt} className="flex items-center justify-between px-4 py-3">
                  <span className="font-mono text-sm text-muted-foreground">
                    {new Date(sample.sampledAt).toISOString().slice(0, 16).replace("T", " ")}
                  </span>
                  <span className="flex items-center gap-4">
                    <span className="font-mono">{formatBpm(sample.heartRateBpm)}</span>
                    <span className="text-xs text-muted-foreground">
                      {vitalsSourceLabel(sample.source)}
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
