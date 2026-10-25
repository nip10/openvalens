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
import { BarChart3, Flame, Footprints, Plus, Route as RouteIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

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

export const Route = createFileRoute("/_auth/records/activity")({
  component: ActivityPage,
});

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
    <Section icon={Plus} tone="steps" title={<Trans>Add reading</Trans>} sheet>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
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
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3 lg:col-span-1">
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

function ActivityPage() {
  const totals = useCacheFirst("activity.dailyTotals", () =>
    client.activity.dailyTotals({ days: 30 }),
  );
  const settingsQuery = useProductSettings();
  const settings = settingsQuery.data;
  const { t, i18n } = useLingui();
  const trendConfig = {
    steps: { label: t`Steps`, color: "var(--tone-steps)" },
  } satisfies ChartConfig;

  const header = <PageHeader title={<Trans>Activity</Trans>} actions={<SyncStatusBadge />} />;

  if (totals.isPending) {
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

  if (totals.isError || !totals.data) {
    return (
      <Page>
        {header}
        <ErrorState
          title={<Trans>Could not load activity.</Trans>}
          action={
            <Button variant="outline" onClick={() => void totals.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      </Page>
    );
  }

  const summary = summarizeDailyActivity(totals.data);
  const series = stepsSeries(summary.days);

  return (
    <Page>
      {header}

      <ProductSettingsStatus />

      {!summary.today ? (
        <EmptyState
          icon={Footprints}
          title={<Trans>No activity yet</Trans>}
          description={
            <Trans>Sync Health Connect or Apple Health from the mobile app, or add an entry.</Trans>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile
              icon={Footprints}
              tone="steps"
              label={<Trans>Steps</Trans>}
              value={formatSteps(summary.today.steps)}
              meter={
                summary.sevenDayAverageSteps
                  ? { value: summary.today.steps / summary.sevenDayAverageSteps }
                  : undefined
              }
              note={t`Your usual: ${formatSteps(summary.sevenDayAverageSteps)}`}
            />
            <StatTile
              icon={Flame}
              tone="food"
              label={<Trans>Calories</Trans>}
              value={formatKcalories(summary.today.activeCaloriesKcal)}
              note={t`Your usual: ${formatKcalories(summary.sevenDayAverageCalories)}`}
            />
            <StatTile
              icon={RouteIcon}
              tone="water"
              label={<Trans>Distance</Trans>}
              value={formatDistanceMeters(summary.today.distanceMeters, settings)}
              note={t`Your usual: ${formatDistanceMeters(summary.sevenDayAverageDistance, settings)}`}
            />
          </div>

          <Section icon={BarChart3} tone="steps" title={<Trans>30-day trend</Trans>}>
            <div className="sheet p-5">
              <ChartContainer config={trendConfig} className="aspect-auto h-64 w-full">
                <BarChart data={series} margin={{ left: 0, right: 4, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--rule)" strokeDasharray="4 6" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={32}
                    tickFormatter={(value: string) => friendlyDate(i18n, value)}
                  />
                  <YAxis
                    domain={[0, "auto"]}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tickCount={4}
                    tickFormatter={(value: number) => formatSteps(value)}
                  />
                  <ChartTooltip
                    cursor={{ fill: "var(--paper-2)" }}
                    content={<ChartTooltipContent />}
                  />
                  <Bar
                    dataKey="steps"
                    fill="var(--color-steps)"
                    radius={[8, 8, 8, 8]}
                    maxBarSize={18}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ChartContainer>
            </div>
          </Section>
        </>
      )}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <AddReadingForm onSaved={() => void totals.refetch()} />
        {summary.today ? (
          <Details summary={<Trans>Recent days</Trans>}>
            <div className="sheet min-w-0 px-2 pt-2 pb-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <Trans>Date</Trans>
                    </TableHead>
                    <TableHead className="num">
                      <Trans>Steps</Trans>
                    </TableHead>
                    <TableHead className="num">
                      <Trans>Calories</Trans>
                    </TableHead>
                    <TableHead className="num">
                      <Trans>Distance</Trans>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...summary.days]
                    .reverse()
                    .slice(0, 14)
                    .map((day) => (
                      <TableRow key={day.date}>
                        <TableCell className="num text-left text-ink-3">
                          {friendlyDate(i18n, day.date)}
                        </TableCell>
                        <TableCell className="num text-ink">{formatSteps(day.steps)}</TableCell>
                        <TableCell className="num">
                          {formatKcalories(day.activeCaloriesKcal)}
                        </TableCell>
                        <TableCell className="num">
                          {formatDistanceMeters(day.distanceMeters, settings)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </Details>
        ) : null}
      </div>
    </Page>
  );
}
