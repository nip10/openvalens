import {
  formatKg,
  formatKgDelta,
  summarizeDailyWeights,
  weightSourceLabel,
} from "@openvalens/api/presenters/body";
import { kgToLb } from "@openvalens/api/presenters/product-formatting";
import {
  defaultObservedAt,
  MANUAL_ENTRY_FIELDS,
  makeManualEntryHash,
  parseManualEntryValue,
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
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Line, LineChart, XAxis, YAxis } from "recharts";

import { ProductSettingsStatus } from "@/components/product-settings-status";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { client, orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";
import { enqueueMetricSample, useCacheFirst } from "@/utils/sync-engine";

export const Route = createFileRoute("/_auth/body")({
  component: BodyPage,
});

function weightChartConfig(
  settings:
    | { units: "metric" | "imperial"; locale: "en-US" | "en-GB" | "en-CA" }
    | null
    | undefined,
): ChartConfig {
  const unit = settings?.units === "imperial" ? "lb" : "kg";
  return {
    weightKg: { label: `Weight (${unit})`, color: "var(--chart-1)" },
  };
}

function weightAxisFormatter(
  value: number,
  settings: { units: "metric" | "imperial" } | null | undefined,
): string {
  if (settings?.units === "imperial") {
    return Math.round(kgToLb(value)).toString();
  }
  return value.toFixed(0);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="font-mono text-lg">{value}</div>
    </div>
  );
}

function AddWeightForm({ onSaved }: { onSaved: () => void }) {
  const field = MANUAL_ENTRY_FIELDS.weight;
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
      metricCode: "weight",
      observedAt,
      valueNumeric: numeric,
      dedupeHash: makeManualEntryHash("weight", observedAt, numeric),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add weight</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label className="text-sm font-medium">Weight ({field.unit})</Label>
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
        <div className="flex items-center gap-3 sm:col-span-2">
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

function BodyPage() {
  const daily = useCacheFirst("body.dailyWeights", () => client.body.dailyWeights({ limit: 90 }));
  const summary = summarizeDailyWeights(daily.data ?? []);
  const settingsQuery = useProductSettings();
  const settings = settingsQuery.data;

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Body</h1>
        <SyncStatusBadge />
      </div>

      <ProductSettingsStatus />

      <AddWeightForm onSaved={() => void daily.refetch()} />

      {daily.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : daily.isError ? (
        <p className="text-sm text-muted-foreground">
          Could not load weight.{" "}
          <button className="underline" onClick={() => void daily.refetch()}>
            Retry
          </button>
        </p>
      ) : !summary.latest ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">No weight yet</p>
            <p className="text-sm text-muted-foreground">
              Sync a scale through Health Connect or Apple Health, or add a weight.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Weight</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-4">
              <Stat
                label={summary.latest.date}
                value={formatKg(summary.latest.weightKg, settings)}
              />
              <Stat
                label="7 days"
                value={summary.change7d === null ? "—" : formatKgDelta(summary.change7d, settings)}
              />
              <Stat
                label="30 days"
                value={
                  summary.change30d === null ? "—" : formatKgDelta(summary.change30d, settings)
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Last 90 days</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={weightChartConfig(settings)} className="h-56 w-full">
                <LineChart data={summary.series}>
                  <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} />
                  <YAxis
                    domain={["dataMin - 1", "dataMax + 1"]}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    tickFormatter={(value: number) => weightAxisFormatter(value, settings)}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => [formatKg(value as number, settings), "Weight"]}
                      />
                    }
                  />
                  <Line
                    dataKey="weightKg"
                    stroke="var(--color-weightKg)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card className="py-0">
            <ul className="divide-y divide-border">
              {[...summary.series]
                .reverse()
                .slice(0, 14)
                .map((point) => {
                  const source = daily.data?.find((row) => row.date === point.date)?.source ?? "";
                  return (
                    <li key={point.date} className="flex items-center justify-between px-4 py-3">
                      <span className="font-mono text-sm text-muted-foreground">{point.date}</span>
                      <span className="flex items-center gap-4">
                        <span className="text-xs text-muted-foreground">
                          {weightSourceLabel(source)}
                        </span>
                        <span className="font-mono">{formatKg(point.weightKg, settings)}</span>
                      </span>
                    </li>
                  );
                })}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
