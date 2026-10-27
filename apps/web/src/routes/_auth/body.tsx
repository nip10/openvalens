import { Trans, useLingui } from "@lingui/react/macro";
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
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@openvalens/ui/components/chart";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
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
import { CalendarDays, Plus, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  Details,
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  Section,
  StatTile,
} from "@/components/page";
import { ProductSettingsStatus } from "@/components/product-settings-status";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { friendlyDate } from "@/utils/friendly";
import { client, orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";
import { enqueueMetricSample, useCacheFirst } from "@/utils/sync-engine";
import { ModuleHiddenNote } from "@/components/module-hidden-note";

export const Route = createFileRoute("/_auth/body")({
  component: BodyPage,
});

function weightUnit(settings: { units: "metric" | "imperial" } | null | undefined): string {
  return settings?.units === "imperial" ? "lb" : "kg";
}

function weightChartConfig(label: string): ChartConfig {
  return {
    weightKg: { label, color: "var(--tone-weight)" },
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

function AddWeightForm({ onSaved }: { onSaved: () => void }) {
  const { i18n } = useLingui();
  const field = MANUAL_ENTRY_FIELDS.weight;
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
      metricCode: "weight",
      observedAt,
      valueNumeric: numeric,
      dedupeHash: makeManualEntryHash("weight", observedAt, numeric),
    });
  };

  return (
    <Section icon={Plus} tone="weight" title={<Trans>Add weight</Trans>} sheet>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <div className="grid gap-2">
          <Label className="text-sm font-medium">
            <Trans>Weight ({unit})</Trans>
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
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-1">
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

function BodyPage() {
  const daily = useCacheFirst("body.dailyWeights", () => client.body.dailyWeights({ limit: 90 }));
  const summary = summarizeDailyWeights(daily.data ?? []);
  const settingsQuery = useProductSettings();
  const settings = settingsQuery.data;
  const { t, i18n } = useLingui();
  const unit = weightUnit(settings);

  return (
    <Page>
      <ModuleHiddenNote module="body" />
      <PageHeader title={<Trans>Body</Trans>} actions={<SyncStatusBadge />} />

      <ProductSettingsStatus />

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="grid min-w-0 content-start gap-8">
          {daily.isPending ? (
            <div className="grid gap-4">
              <Skeleton className="h-96 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : daily.isError ? (
            <ErrorState
              title={<Trans>Could not load weight.</Trans>}
              action={
                <Button variant="outline" onClick={() => void daily.refetch()}>
                  <Trans>Retry</Trans>
                </Button>
              }
            />
          ) : !summary.latest ? (
            <EmptyState
              title={<Trans>No weight yet</Trans>}
              description={
                <Trans>Sync a scale through Health Connect or Apple Health, or add a weight.</Trans>
              }
            />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <StatTile
                  icon={Scale}
                  tone="weight"
                  label={<Trans>Weight</Trans>}
                  value={formatKg(summary.latest.weightKg, settings)}
                  note={friendlyDate(i18n, summary.latest.date)}
                />
                <StatTile
                  icon={CalendarDays}
                  tone="weight"
                  label={<Trans>7 days</Trans>}
                  value={
                    summary.change7d === null
                      ? "—"
                      : formatKgDelta(i18n, summary.change7d, settings)
                  }
                />
                <StatTile
                  icon={TrendingDown}
                  tone="weight"
                  label={<Trans>30 days</Trans>}
                  value={
                    summary.change30d === null
                      ? "—"
                      : formatKgDelta(i18n, summary.change30d, settings)
                  }
                />
              </div>
              <Section icon={TrendingUp} tone="weight" title={<Trans>Last 90 days</Trans>}>
                <div className="sheet p-5">
                  <ChartContainer
                    config={weightChartConfig(t`Weight (${unit})`)}
                    className="aspect-auto h-72 w-full"
                  >
                    <AreaChart
                      data={summary.series}
                      margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
                    >
                      <defs>
                        <linearGradient id="body-weight-fill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--tone-weight)" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="var(--tone-weight)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="var(--rule)" strokeDasharray="4 6" />
                      <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        minTickGap={48}
                        tickFormatter={(value: string) => friendlyDate(i18n, value)}
                      />
                      <YAxis
                        domain={["dataMin - 1", "dataMax + 1"]}
                        tickLine={false}
                        axisLine={false}
                        width={40}
                        tickCount={5}
                        tickFormatter={(value: number) => weightAxisFormatter(value, settings)}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            formatter={(value) => [formatKg(value as number, settings), t`Weight`]}
                          />
                        }
                      />
                      <Area
                        type="monotone"
                        dataKey="weightKg"
                        stroke="var(--color-weightKg)"
                        strokeWidth={3}
                        fill="url(#body-weight-fill)"
                        dot={false}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ChartContainer>
                </div>
              </Section>

              <Details summary={<Trans>All readings</Trans>}>
                <div className="sheet min-w-0 px-2 pt-2 pb-1">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <Trans>Date</Trans>
                        </TableHead>
                        <TableHead>
                          <Trans>Source</Trans>
                        </TableHead>
                        <TableHead className="num">
                          <Trans>Weight</Trans>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...summary.series]
                        .reverse()
                        .slice(0, 14)
                        .map((point) => {
                          const source =
                            daily.data?.find((row) => row.date === point.date)?.source ?? "";
                          return (
                            <TableRow key={point.date}>
                              <TableCell className="num text-left text-ink-3">
                                {friendlyDate(i18n, point.date)}
                              </TableCell>
                              <TableCell className="text-ink-3">
                                {i18n._(weightSourceLabel(source))}
                              </TableCell>
                              <TableCell className="num text-ink">
                                {formatKg(point.weightKg, settings)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </div>
              </Details>
            </>
          )}
        </div>

        <AddWeightForm onSaved={() => void daily.refetch()} />
      </div>
    </Page>
  );
}
