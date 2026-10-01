import {
  formatKg,
  formatKgDelta,
  summarizeDailyWeights,
  weightSourceLabel,
} from "@openhealth/api/presenters/body";
import {
  defaultObservedAt,
  MANUAL_ENTRY_FIELDS,
  makeManualEntryHash,
  parseManualEntryValue,
} from "@openhealth/api/presenters/manual-entry";
import { Button } from "@openhealth/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openhealth/ui/components/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@openhealth/ui/components/chart";
import { Input } from "@openhealth/ui/components/input";
import { Label } from "@openhealth/ui/components/label";
import { Skeleton } from "@openhealth/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Line, LineChart, XAxis, YAxis } from "recharts";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/body")({
  component: BodyPage,
});

const chartConfig = {
  weightKg: { label: "Weight (kg)", color: "var(--chart-1)" },
} satisfies ChartConfig;

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
  const daily = useQuery(orpc.body.dailyWeights.queryOptions({ input: { limit: 90 } }));
  const summary = summarizeDailyWeights(daily.data ?? []);

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <h1 className="text-2xl font-semibold">Body</h1>

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
              <Stat label={summary.latest.date} value={formatKg(summary.latest.weightKg)} />
              <Stat
                label="7 days"
                value={summary.change7d === null ? "—" : formatKgDelta(summary.change7d)}
              />
              <Stat
                label="30 days"
                value={summary.change30d === null ? "—" : formatKgDelta(summary.change30d)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Last 90 days</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-56 w-full">
                <LineChart data={summary.series}>
                  <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} />
                  <YAxis
                    domain={["dataMin - 1", "dataMax + 1"]}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    tickFormatter={(value: number) => value.toFixed(0)}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
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
                        <span className="font-mono">{formatKg(point.weightKg)}</span>
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
