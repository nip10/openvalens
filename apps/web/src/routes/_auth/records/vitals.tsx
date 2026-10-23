import { Trans, useLingui } from "@lingui/react/macro";
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
  const { i18n } = useLingui();
  const unit = i18n._(field.unit);
  const min = field.min;
  const max = field.max;
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
        <CardTitle>
          <Trans>Add reading</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label className="text-sm font-medium">
            <Trans>Metric</Trans>
          </Label>
          <Select
            value={metric}
            onValueChange={(next) => {
              if (next === "heart_rate" || next === "resting_heart_rate") setMetric(next);
            }}
          >
            <SelectTrigger>
              <SelectValue>{i18n._(field.label)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MANUAL_METRICS.map((code) => (
                <SelectItem key={code} value={code}>
                  {i18n._(MANUAL_ENTRY_FIELDS[code].label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label className="text-sm font-medium">
              <Trans>Value ({unit})</Trans>
            </Label>
            <Input
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={`${field.min}–${field.max}`}
            />
          </div>
          <div className="grid gap-2">
            <Label className="text-sm font-medium">
              <Trans>Observed at</Trans>
            </Label>
            <Input
              type="datetime-local"
              value={observedAt}
              onChange={(event) => setObservedAt(event.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={numeric === null || save.isPending}>
            {save.isPending ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
          </Button>
          {numeric === null && value.length > 0 ? (
            <span className="text-sm text-destructive">
              <Trans>
                Value must be between {min} and {max} {unit}.
              </Trans>
            </span>
          ) : save.isSuccess ? (
            <span className="text-sm text-success">
              <Trans>Saved</Trans>
            </span>
          ) : save.isError ? (
            <span className="text-sm text-destructive">
              <Trans>Could not save.</Trans>
            </span>
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
  const { t, i18n } = useLingui();
  const trendConfig = {
    avgBpm: { label: t`Avg bpm`, color: "var(--chart-1)" },
  } satisfies ChartConfig;

  if (daily.isPending || samples.isPending) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">
            <Trans>Vitals</Trans>
          </h1>
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
          <h1 className="text-2xl font-semibold">
            <Trans>Vitals</Trans>
          </h1>
          <SyncStatusBadge />
        </div>
        <p className="text-sm text-muted-foreground">
          <Trans>Could not load vitals.</Trans>{" "}
          <button
            className="underline"
            onClick={() => {
              void daily.refetch();
              void samples.refetch();
            }}
          >
            <Trans>Retry</Trans>
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
        <h1 className="text-2xl font-semibold">
          <Trans>Vitals</Trans>
        </h1>
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
            <p className="font-medium">
              <Trans>No vitals yet</Trans>
            </p>
            <p className="text-sm text-muted-foreground">
              <Trans>
                Sync Health Connect or Apple Health from the mobile app, or add a reading.
              </Trans>
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>{t`Today · ${summary.today.date}`}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-4">
              <Stat label={t`Avg heart rate`} value={formatBpm(summary.today.heartRate.avgBpm)} />
              <Stat
                label={t`Range`}
                value={formatBpmRange(
                  summary.today.heartRate.avgBpm,
                  summary.today.heartRate.minBpm,
                  summary.today.heartRate.maxBpm,
                )}
              />
              <Stat
                label={t`Samples`}
                value={summary.today.heartRate.sampleCount.toLocaleString("en-US")}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>30-day trend</Trans>
              </CardTitle>
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
              <CardTitle>
                <Trans>This week</Trans>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-4">
              <Stat label={t`7-day average`} value={formatBpm(summary.sevenDayAverageBpm)} />
              <Stat
                label={t`Latest reading`}
                value={formatBpm(summary.latestSample?.heartRateBpm ?? null)}
              />
              <Stat
                label={t`Source`}
                value={vitalsSourceLabel(summary.latestSample?.source ?? null, i18n)}
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
                      {vitalsSourceLabel(sample.source, i18n)}
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
