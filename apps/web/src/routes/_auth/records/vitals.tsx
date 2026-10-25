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
  formatMs,
  formatBpmRange,
  heartRateSeries,
  summarizeVitals,
  vitalsSourceLabel,
} from "@openvalens/api/presenters/vitals";
import { Button } from "@openvalens/ui/components/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openvalens/ui/components/table";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { EmptyState, ErrorState, Figure, Page, PageHeader, Section } from "@/components/page";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { client, orpc } from "@/utils/orpc";
import { enqueueMetricSample, useCacheFirst } from "@/utils/sync-engine";

export const Route = createFileRoute("/_auth/records/vitals")({
  component: VitalsPage,
});

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
    <Section title={<Trans>Add reading</Trans>} className="well px-5 pt-4 pb-5">
      <div className="grid gap-4">
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
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
        <div className="flex flex-wrap items-center gap-3">
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
      </div>
    </Section>
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

  const header = <PageHeader title={<Trans>Vitals</Trans>} actions={<SyncStatusBadge />} />;

  if (daily.isPending || samples.isPending) {
    return (
      <Page>
        {header}
        <div className="grid gap-10 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </Page>
    );
  }

  if (daily.isError || !daily.data || samples.isError) {
    return (
      <Page>
        {header}
        <ErrorState
          title={<Trans>Could not load vitals.</Trans>}
          action={
            <Button
              variant="outline"
              onClick={() => {
                void daily.refetch();
                void samples.refetch();
              }}
            >
              <Trans>Retry</Trans>
            </Button>
          }
        />
      </Page>
    );
  }

  const summary = summarizeVitals(daily.data, samples.data ?? []);
  const series = heartRateSeries(summary.days);

  return (
    <Page>
      {header}

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        {!summary.today ? (
          <EmptyState
            title={<Trans>No vitals yet</Trans>}
            description={
              <Trans>
                Sync Health Connect or Apple Health from the mobile app, or add a reading.
              </Trans>
            }
          />
        ) : (
          <Section title={<Trans>30-day trend</Trans>}>
            <div className="sheet grid gap-5 px-5 pt-4 pb-5">
              <dl className="grid grid-cols-2 gap-y-4 sm:grid-cols-4 sm:divide-x sm:divide-rule">
                <Figure
                  className="pr-4"
                  label={t`7-day average`}
                  value={formatBpm(summary.sevenDayAverageBpm)}
                />
                <Figure
                  className="sm:px-4"
                  label={t`Latest reading`}
                  value={formatBpm(summary.latestSample?.heartRateBpm ?? null)}
                />
                <Figure
                  className="pr-4 sm:px-4"
                  label={t`Source`}
                  value={
                    <span className="font-body text-base tracking-normal">
                      {vitalsSourceLabel(summary.latestSample?.source ?? null, i18n)}
                    </span>
                  }
                />
                {summary.latestHrv ? (
                  <Figure
                    className="sm:pl-4"
                    label={t`Overnight HRV`}
                    value={formatMs(summary.latestHrv.avgMs)}
                    note={summary.latestHrv.date}
                  />
                ) : null}
              </dl>
              <ChartContainer config={trendConfig} className="aspect-auto h-72 w-full">
                <LineChart data={series} margin={{ left: 0, right: 4, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--rule)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={36}
                    tickCount={5}
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
            </div>
          </Section>
        )}

        <div className="grid content-start gap-10">
          {summary.today ? (
            <Section title={<Trans>Today</Trans>} description={summary.today.date}>
              <dl className="grid grid-cols-3 gap-4 border-t border-rule pt-4 lg:grid-cols-1">
                <Figure
                  label={t`Avg heart rate`}
                  value={formatBpm(summary.today.heartRate.avgBpm)}
                />
                <Figure
                  label={t`Range`}
                  value={formatBpmRange(
                    summary.today.heartRate.avgBpm,
                    summary.today.heartRate.minBpm,
                    summary.today.heartRate.maxBpm,
                  )}
                />
                <Figure
                  label={t`Samples`}
                  value={summary.today.heartRate.sampleCount.toLocaleString("en-US")}
                />
              </dl>
            </Section>
          ) : null}
          <AddReadingForm
            onSaved={() => {
              void daily.refetch();
              void samples.refetch();
            }}
          />
        </div>
      </div>

      {summary.today ? (
        <div className="sheet min-w-0 px-2 pt-2 pb-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Trans>Time</Trans>
                </TableHead>
                <TableHead className="num">
                  <Trans>Heart rate</Trans>
                </TableHead>
                <TableHead>
                  <Trans>Source</Trans>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(samples.data ?? []).map((sample) => (
                <TableRow key={sample.sampledAt}>
                  <TableCell className="num text-ink-3">
                    {new Date(sample.sampledAt).toISOString().slice(0, 16).replace("T", " ")}
                  </TableCell>
                  <TableCell className="num text-ink">{formatBpm(sample.heartRateBpm)}</TableCell>
                  <TableCell className="text-ink-3">
                    {vitalsSourceLabel(sample.source, i18n)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </Page>
  );
}
