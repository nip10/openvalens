import { Trans, useLingui } from "@lingui/react/macro";
import {
  formatDistanceMeters,
  formatKcalories,
  formatSteps,
  stepsSeries,
  summarizeDailyActivity,
} from "@openvalens/api/presenters/activity";
import {
  defaultObservedAt,
  MANUAL_ENTRY_FIELDS,
  makeManualEntryHash,
  parseManualEntryValue,
  type ManualEntryMetric,
} from "@openvalens/api/presenters/manual-entry";
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
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { ProductSettingsStatus } from "@/components/product-settings-status";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { client, orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";
import { enqueueMetricSample, useCacheFirst } from "@/utils/sync-engine";

export const Route = createFileRoute("/_auth/records/activity")({
  component: ActivityPage,
});

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="font-mono text-lg">{value}</div>
    </div>
  );
}

const MANUAL_METRICS: ManualEntryMetric[] = ["steps", "active_calories", "distance"];

function AddReadingForm({ onSaved }: { onSaved: () => void }) {
  const [metric, setMetric] = useState<ManualEntryMetric>("steps");
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
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label className="text-sm font-medium">
            <Trans>Metric</Trans>
          </Label>
          <Select
            value={metric}
            onValueChange={(next) => {
              if (MANUAL_METRICS.includes(next as ManualEntryMetric)) {
                setMetric(next as ManualEntryMetric);
              }
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
        <div className="flex items-center gap-3 sm:col-span-3">
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

function ActivityPage() {
  const totals = useCacheFirst("activity.dailyTotals", () =>
    client.activity.dailyTotals({ days: 30 }),
  );
  const settingsQuery = useProductSettings();
  const settings = settingsQuery.data;
  const { t } = useLingui();
  const trendConfig = {
    steps: { label: t`Steps`, color: "var(--chart-1)" },
  } satisfies ChartConfig;

  if (totals.isPending) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">
            <Trans>Activity</Trans>
          </h1>
          <SyncStatusBadge />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (totals.isError || !totals.data) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">
            <Trans>Activity</Trans>
          </h1>
          <SyncStatusBadge />
        </div>
        <p className="text-sm text-muted-foreground">
          <Trans>Could not load activity.</Trans>{" "}
          <button className="underline" onClick={() => void totals.refetch()}>
            <Trans>Retry</Trans>
          </button>
        </p>
      </div>
    );
  }

  const summary = summarizeDailyActivity(totals.data);
  const series = stepsSeries(summary.days);

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          <Trans>Activity</Trans>
        </h1>
        <SyncStatusBadge />
      </div>

      <ProductSettingsStatus />

      <AddReadingForm onSaved={() => void totals.refetch()} />

      {!summary.today ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">
              <Trans>No activity yet</Trans>
            </p>
            <p className="text-sm text-muted-foreground">
              <Trans>
                Sync Health Connect or Apple Health from the mobile app, or add an entry.
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
              <Stat label={t`Steps`} value={formatSteps(summary.today.steps)} />
              <Stat label={t`Calories`} value={formatKcalories(summary.today.activeCaloriesKcal)} />
              <Stat
                label={t`Distance`}
                value={formatDistanceMeters(summary.today.distanceMeters, settings)}
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
              <CardTitle>
                <Trans>This week</Trans>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-4">
              <Stat
                label={t`Steps / active day`}
                value={formatSteps(summary.sevenDayAverageSteps)}
              />
              <Stat
                label={t`Calories / day`}
                value={formatKcalories(summary.sevenDayAverageCalories)}
              />
              <Stat
                label={t`Distance / day`}
                value={formatDistanceMeters(summary.sevenDayAverageDistance, settings)}
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
                      <span className="font-mono">
                        {t({ message: `${formatSteps(day.steps)} steps`, comment: "safety" })}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {formatKcalories(day.activeCaloriesKcal)}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {formatDistanceMeters(day.distanceMeters, settings)}
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
