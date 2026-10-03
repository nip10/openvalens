import {
  defaultObservedAt,
  MANUAL_ENTRY_FIELDS,
  makeManualEntryHash,
  parseManualEntryValue,
  type ManualEntryMetric,
} from "@openvalens/api/presenters/manual-entry";
import {
  formatBpm,
  formatBpmRange,
  heartRateSeries,
  summarizeVitals,
  vitalsSourceLabel,
} from "@openvalens/api/presenters/vitals";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@openvalens/ui/components/chart";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openvalens/ui/components/select";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Line, LineChart, XAxis, YAxis } from "recharts";

import { SyncStatusBadge } from "@/components/sync-status-badge";
import { client, orpc } from "@/utils/orpc";
import { enqueueMetricSample, useCacheFirst } from "@/utils/sync-engine";

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

const MANUAL_METRICS: ManualEntryMetric[] = ["heart_rate", "resting_heart_rate"];

function AddReadingForm({ onSaved }: { onSaved: () => void }) {
  const [metric, setMetric] = useState<ManualEntryMetric>("heart_rate");
  const field = MANUAL_ENTRY_FIELDS[metric];
  const [value, setValue] = useState("");
  const [observedAt, setObservedAt] = useState(defaultObservedAt);

  const save = useMutation(
    orpc.healthRecord.ingestMetricSample.mutationOptions({
      onSuccess: () => {
        setValue("");
        setObservedAt(defaultObservedAt());
        onSaved();
      },
      onError: (error, variables) => enqueueMetricSample(variables, error),
    }),
  );

  const numeric = parseManualEntryValue(field, value);
  const submit = () => {
    if (numeric === null) return;
    save.mutate({
      metricCode: metric,
      observedAt,
      valueNumeric: numeric,
      dedupeHash: makeManualEntryHash(metric, observedAt, numeric),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add reading</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label className="text-sm font-medium">Metric</Label>
          <Select
            value={metric}
            onValueChange={(next) => {
              if (next === "heart_rate" || next === "resting_heart_rate") setMetric(next);
            }}
          >
            <SelectTrigger>
              <SelectValue>{field.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MANUAL_METRICS.map((code) => (
                <SelectItem key={code} value={code}>
                  {MANUAL_ENTRY_FIELDS[code].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label className="text-sm font-medium">Value ({field.unit})</Label>
            <Input
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={`${field.min}–${field.max}`}
            />
          </div>
          <div className="grid gap-2">
            <Label className="text-sm font-medium">Observed at</Label>
            <Input
              type="datetime-local"
              value={observedAt}
              onChange={(event) => setObservedAt(event.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={numeric === null || save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          {numeric === null && value.length > 0 ? (
            <span className="text-sm text-destructive">
              Value must be between {field.min} and {field.max} {field.unit}.
            </span>
          ) : save.isSuccess ? (
            <span className="text-sm text-success">Saved</span>
          ) : save.isError ? (
            <span className="text-sm text-destructive">Could not save.</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function VitalsPage() {
  const daily = useCacheFirst("vitals.daily", () => client.vitals.daily({ days: 30 }));
  const samples = useCacheFirst("vitals.recentSamples", () =>
    client.vitals.recentSamples({ limit: 20 }),
  );

  if (daily.isPending || samples.isPending) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Vitals</h1>
          <SyncStatusBadge />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (daily.isError || !daily.data || samples.isError) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Vitals</h1>
          <SyncStatusBadge />
        </div>
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
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Vitals</h1>
        <SyncStatusBadge />
      </div>

      <AddReadingForm
        onSaved={() => {
          void daily.refetch();
          void samples.refetch();
        }}
      />

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
