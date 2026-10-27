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
import { Activity, HeartPulse, Plus, Waves } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  Details,
  EmptyState,
  ErrorState,
  Figure,
  Page,
  PageHeader,
  Section,
  StatTile,
} from "@/components/page";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { friendlyDate } from "@/utils/friendly";
import { client, orpc } from "@/utils/orpc";
import { enqueueMetricSample, useCacheFirst } from "@/utils/sync-engine";
import { ModuleHiddenNote } from "@/components/module-hidden-note";

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
    <Section icon={Plus} tone="heart" title={<Trans>Add reading</Trans>} sheet>
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
    avgBpm: { label: t`Avg bpm`, color: "var(--tone-heart)" },
  } satisfies ChartConfig;

  const header = <PageHeader title={<Trans>Vitals</Trans>} actions={<SyncStatusBadge />} />;

  if (daily.isPending || samples.isPending) {
    return (
      <Page>
        <ModuleHiddenNote module="heart" />
        {header}
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-36 w-full rounded-3xl" />
          <Skeleton className="h-36 w-full rounded-3xl" />
          <Skeleton className="h-36 w-full rounded-3xl" />
        </div>
        <Skeleton className="h-72 w-full rounded-3xl" />
      </Page>
    );
  }

  if (daily.isError || !daily.data || samples.isError) {
    return (
      <Page>
        <ModuleHiddenNote module="heart" />
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
  const today = summary.today;

  return (
    <Page>
      <ModuleHiddenNote module="heart" />
      {header}

      {!today ? (
        <EmptyState
          icon={HeartPulse}
          title={<Trans>No vitals yet</Trans>}
          description={
            <Trans>
              Sync Health Connect or Apple Health from the mobile app, or add a reading.
            </Trans>
          }
        />
      ) : (
        <>
          <div
            className={
              summary.latestHrv ? "grid gap-4 sm:grid-cols-3" : "grid gap-4 sm:grid-cols-2"
            }
          >
            <StatTile
              icon={HeartPulse}
              tone="heart"
              label={t`Avg heart rate`}
              value={formatBpm(today.heartRate.avgBpm)}
              note={t`Your usual: ${formatBpm(summary.sevenDayAverageBpm)}`}
            />
            <StatTile
              icon={Activity}
              tone="heart"
              label={i18n._(MANUAL_ENTRY_FIELDS.resting_heart_rate.label)}
              value={formatBpm(today.restingHeartRate.avgBpm)}
            />
            {summary.latestHrv ? (
              <StatTile
                icon={Waves}
                tone="heart"
                label={t`Overnight HRV`}
                value={formatMs(summary.latestHrv.avgMs)}
                note={friendlyDate(i18n, summary.latestHrv.date)}
              />
            ) : null}
          </div>

          <Section icon={HeartPulse} tone="heart" title={<Trans>30-day trend</Trans>}>
            <div className="sheet p-5">
              <ChartContainer config={trendConfig} className="aspect-auto h-64 w-full">
                <AreaChart data={series} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="vitals-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--tone-heart)" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="var(--tone-heart)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--rule)" strokeDasharray="4 6" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={32}
                    tickFormatter={(value: string) => friendlyDate(i18n, value)}
                  />
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
                  <Area
                    type="monotone"
                    dataKey="avgBpm"
                    stroke="var(--color-avgBpm)"
                    strokeWidth={3}
                    fill="url(#vitals-fill)"
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                </AreaChart>
              </ChartContainer>
            </div>
          </Section>
        </>
      )}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <AddReadingForm
          onSaved={() => {
            void daily.refetch();
            void samples.refetch();
          }}
        />
        {today ? (
          <Details summary={<Trans>Recent readings</Trans>}>
            <div className="grid gap-4">
              <dl className="sheet grid grid-cols-2 gap-4 p-5 sm:grid-cols-3">
                <Figure label={t`7-day average`} value={formatBpm(summary.sevenDayAverageBpm)} />
                <Figure
                  label={t`Latest reading`}
                  value={formatBpm(summary.latestSample?.heartRateBpm ?? null)}
                />
                <Figure
                  label={t`Source`}
                  value={
                    <span className="font-body text-base tracking-normal">
                      {vitalsSourceLabel(summary.latestSample?.source ?? null, i18n)}
                    </span>
                  }
                />
                <Figure
                  className="col-span-2"
                  label={t`Range`}
                  value={formatBpmRange(
                    today.heartRate.avgBpm,
                    today.heartRate.minBpm,
                    today.heartRate.maxBpm,
                  )}
                  note={<Trans>Today</Trans>}
                />
                <Figure
                  label={t`Samples`}
                  value={today.heartRate.sampleCount.toLocaleString("en-US")}
                />
              </dl>
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
                    {(samples.data ?? []).map((sample) => {
                      const iso = new Date(sample.sampledAt).toISOString();
                      return (
                        <TableRow key={sample.sampledAt}>
                          <TableCell className="num text-left text-ink-3">
                            {`${friendlyDate(i18n, iso)} ${iso.slice(11, 16)}`}
                          </TableCell>
                          <TableCell className="num text-ink">
                            {formatBpm(sample.heartRateBpm)}
                          </TableCell>
                          <TableCell className="text-ink-3">
                            {vitalsSourceLabel(sample.source, i18n)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </Details>
        ) : null}
      </div>
    </Page>
  );
}
