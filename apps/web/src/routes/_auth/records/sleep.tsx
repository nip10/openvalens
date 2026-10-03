import {
  formatClockTime,
  formatSleepDuration,
  formatSleepDurationWithHours,
  formatSleepEfficiency,
  lastNightStages,
  sleepSeries,
  sleepStatusLabel,
  sleepStatusTone,
} from "@openvalens/api/presenters/sleep";
import { Badge } from "@openvalens/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@openvalens/ui/components/chart";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { cn } from "@openvalens/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, Cell, Line, LineChart, XAxis, YAxis } from "recharts";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/records/sleep")({
  component: SleepPage,
});

const trendConfig = {
  asleepMinutes: { label: "Asleep (min)", color: "var(--chart-1)" },
} satisfies ChartConfig;

const TONE_CLASS = {
  destructive: "border-destructive/40 bg-destructive/10 text-destructive",
  warning: "border-warning/40 bg-warning/10 text-warning",
  success: "border-success/40 bg-success/10 text-success",
} as const;

const STAGE_COLORS: Record<string, string> = {
  awake: "var(--chart-4)",
  light: "var(--chart-1)",
  deep: "var(--chart-3)",
  rem: "var(--chart-2)",
  unknown: "var(--muted)",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="font-mono text-lg">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = sleepStatusTone(status as Parameters<typeof sleepStatusTone>[0]);
  return (
    <Badge variant="outline" className={cn(tone && TONE_CLASS[tone])}>
      {sleepStatusLabel(status as Parameters<typeof sleepStatusLabel>[0])}
    </Badge>
  );
}

function SleepPage() {
  const summary = useQuery(orpc.sleep.summary.queryOptions({ input: { days: 30 } }));

  if (summary.isPending) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Sleep</h1>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (summary.isError || !summary.data) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Sleep</h1>
        <p className="text-sm text-muted-foreground">
          Could not load sleep.{" "}
          <button className="underline" onClick={() => void summary.refetch()}>
            Retry
          </button>
        </p>
      </div>
    );
  }

  const last = summary.data.lastNight;
  const stages = lastNightStages(last);
  const series = sleepSeries(summary.data);
  const maxAsleep = Math.max(60, ...series.map((p) => p.asleepMinutes));

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <h1 className="text-2xl font-semibold">Sleep</h1>

      {!last ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">No sleep yet</p>
            <p className="text-sm text-muted-foreground">
              Track sleep through Health Connect or Apple Health, or add a session.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Last night · {last.date}</CardTitle>
              <StatusBadge status={last.status} />
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Asleep" value={formatSleepDuration(last.asleepMinutes)} />
              <Stat label="In bed" value={formatSleepDuration(last.timeInBedMinutes)} />
              <Stat label="Efficiency" value={formatSleepEfficiency(last.sleepEfficiencyPct)} />
              <Stat
                label="Bedtime → wake"
                value={`${formatClockTime(last.mainSleepStart)} → ${formatClockTime(last.mainSleepEnd)}`}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stages</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <ChartContainer
                  config={{
                    minutes: { label: "Minutes" },
                  }}
                  className="h-32 w-full"
                >
                  <BarChart
                    data={stages}
                    layout="vertical"
                    margin={{ left: 0, right: 0, top: 0, bottom: 0 }}
                  >
                    <XAxis type="number" hide domain={[0, "dataMax"]} />
                    <YAxis type="category" dataKey="stage" hide />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="minutes" radius={[0, 4, 4, 0]} stackId="stages">
                      {stages.map((entry) => (
                        <Cell
                          key={entry.stage}
                          fill={STAGE_COLORS[entry.stage] ?? "var(--muted)"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
                <ul className="grid gap-1 text-sm">
                  {stages.map((entry) => (
                    <li key={entry.stage} className="flex items-center justify-between gap-6">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <span
                          aria-hidden
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: STAGE_COLORS[entry.stage] ?? "var(--muted)" }}
                        />
                        {entry.label}
                      </span>
                      <span className="font-mono">{formatSleepDuration(entry.minutes)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>30-day trend</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={trendConfig} className="h-48 w-full">
                <LineChart data={series} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis
                    domain={[0, Math.ceil(maxAsleep / 60) * 60]}
                    tickLine={false}
                    axisLine={false}
                    width={36}
                    tickFormatter={(value: number) => formatSleepDurationWithHours(value)}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => formatSleepDuration(Number(value))}
                      />
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="asleepMinutes"
                    stroke="var(--color-asleepMinutes)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
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
              <Stat
                label="7-day average"
                value={formatSleepDuration(summary.data.sevenDayAverageMinutes)}
              />
              <Stat
                label="Avg debt"
                value={formatSleepDuration(summary.data.averageSleepDebtMinutes)}
              />
              <Stat label="Target" value={formatSleepDuration(last.targetMinutes)} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
