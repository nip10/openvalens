import { Trans, useLingui } from "@lingui/react/macro";
import { displayLabValue } from "@openvalens/api/presenters/clinical-units";
import {
  displayLabRange,
  formatLabDate,
  formatLabRangeShort,
  formatLabValue,
  labRangePosition,
  type LabReferenceRangeLike,
} from "@openvalens/api/presenters/labs";
import { Button } from "@openvalens/ui/components/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@openvalens/ui/components/chart";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { FormDialog } from "@/components/form-dialog";
import { ErrorState, StatusPill } from "@/components/page";
import { useDisplayPreferences } from "@/lib/display-preferences";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";

export type LabHistoryReading = {
  sampledAt: string;
  value: number;
  referenceRange: LabReferenceRangeLike | null;
};

/**
 * One reading as the history list shows it: the value in the member's unit
 * choice, the range the lab printed with that reading, and whether the
 * reading sat above or below that range.
 */
export function labHistoryRows(
  marker: { code: string; unit: string | null },
  readings: readonly LabHistoryReading[],
  labUnits: Parameters<typeof displayLabValue>[2],
) {
  return readings.map((reading) => {
    const shown = displayLabValue(marker, reading.value, labUnits);
    const range = displayLabRange(marker, reading.referenceRange, labUnits);
    // A text range with numeric bounds is compared on its bounds.
    const numeric =
      range?.kind === "text" &&
      reading.referenceRange &&
      (reading.referenceRange.low !== null || reading.referenceRange.high !== null)
        ? displayLabRange(marker, { ...reading.referenceRange, text: null }, labUnits)
        : range;
    return {
      sampledAt: reading.sampledAt,
      value: shown.value,
      unit: shown.unit,
      range,
      position: labRangePosition(shown.value, shown.unit, numeric),
    };
  });
}

/**
 * A marker's full history, opened from its row on Labs: every reading as a
 * chart and as a list, newest first, each with the lab's own range.
 */
export function LabMarkerHistoryDialog({
  marker,
  onClose,
}: {
  marker: { code: string; displayName: string; unit: string | null } | null;
  onClose: () => void;
}) {
  const { t, i18n } = useLingui();
  const { labUnits } = useDisplayPreferences();
  const settings = useProductSettings().data;
  const history = useQuery({
    ...orpc.labs.history.queryOptions({ input: { code: marker?.code ?? "blood_marker_none" } }),
    enabled: marker !== null,
  });
  if (!marker) return null;
  const data = history.data ?? null;
  const rows = data ? labHistoryRows(data, data.readings, labUnits) : [];
  const unit = rows.at(-1)?.unit ?? marker.unit;
  const config = {
    value: { label: marker.displayName, color: "var(--tone-water)" },
  } satisfies ChartConfig;
  const series = rows.map((row) => ({ date: row.sampledAt, value: row.value }));

  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="lg"
      title={marker.displayName}
      description={unit ? t`Every reading on file, in ${unit}` : t`Every reading on file`}
    >
      {history.isPending ? (
        <div className="grid gap-3" role="status" aria-label={t`Loading readings…`}>
          <Skeleton className="h-48 w-full rounded-3xl" />
          <Skeleton className="h-24 w-full rounded-3xl" />
        </div>
      ) : history.isError || !data ? (
        <ErrorState
          title={<Trans>Could not load this marker's readings.</Trans>}
          action={
            <Button variant="outline" onClick={() => void history.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <p className="text-ink-3">
          <Trans>No readings yet.</Trans>
        </p>
      ) : (
        <>
          {series.length > 1 ? (
            <ChartContainer
              config={config}
              className="aspect-auto h-48 w-full"
              role="img"
              aria-label={t`${marker.displayName} over time`}
            >
              <AreaChart data={series} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="lab-history-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--tone-water)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--tone-water)" stopOpacity={0} />
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
                  width={44}
                  domain={["auto", "auto"]}
                  tickFormatter={(value: number) => formatLabValue(value, null)}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) =>
                        friendlyDate(i18n, String(payload?.[0]?.payload?.date ?? ""))
                      }
                      formatter={(value) => formatLabValue(Number(value), unit)}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="var(--color-value)"
                  strokeWidth={3}
                  fill="url(#lab-history-fill)"
                  dot={{ r: 3, fill: "var(--tone-water)", strokeWidth: 0 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ChartContainer>
          ) : null}
          <ul className="grid divide-y divide-rule rounded-2xl border border-rule px-4">
            {[...rows].reverse().map((row) => {
              const flag =
                row.position === "above"
                  ? t`Above range`
                  : row.position === "below"
                    ? t`Below range`
                    : null;
              return (
                <li
                  key={row.sampledAt}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 py-3"
                >
                  <time
                    dateTime={row.sampledAt}
                    title={formatLabDate(row.sampledAt, settings)}
                    className="text-sm text-ink-2"
                  >
                    {friendlyDate(i18n, row.sampledAt)}
                  </time>
                  <span className="num justify-self-end font-display text-lg font-medium text-ink">
                    {formatLabValue(row.value, null)}
                    {row.unit && row.unit !== unit ? (
                      <span className="ml-1 font-body text-sm text-ink-3">{row.unit}</span>
                    ) : null}
                  </span>
                  <span className="num text-sm text-ink-3">
                    {row.range ? formatLabRangeShort(i18n, row.range, row.unit) : null}
                  </span>
                  <span className="justify-self-end">
                    {flag ? <StatusPill tone="warn">{flag}</StatusPill> : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {data.truncated ? (
            <p className="text-sm text-ink-3">
              <Trans>Showing the latest 500 readings.</Trans>
            </p>
          ) : null}
        </>
      )}
    </FormDialog>
  );
}
