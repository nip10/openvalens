import { Trans, useLingui } from "@lingui/react/macro";
import { displayLabValue } from "@openvalens/api/presenters/clinical-units";
import {
  displayLabRange,
  formatLabDate,
  formatLabRange,
  formatLabValue,
  labRangeLine,
  type LabRangeDisplay,
} from "@openvalens/api/presenters/labs";
import {
  defaultObservedAt,
  makeManualEntryHash,
  parseManualEntryValue,
} from "@openvalens/api/presenters/manual-entry";
import { Button } from "@openvalens/ui/components/button";
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
import { FlaskConical, TestTube } from "lucide-react";

import { DecimalHint } from "@/components/decimal-hint";
import { LogDialog } from "@/components/log-dialog";
import { EmptyState, ErrorState, Page, PageHeader, Section } from "@/components/page";
import { useLogDialog } from "@/components/quick-log/log-launcher";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { ProductSettingsStatus } from "@/components/product-settings-status";
import { friendlyDate } from "@/utils/friendly";
import { client, orpc } from "@/utils/orpc";
import { useDisplayPreferences } from "@/lib/display-preferences";
import { useProductSettings } from "@/utils/product-settings";
import { enqueueMetricSample, useCacheFirst } from "@/utils/sync-engine";
import { ModuleHiddenNote } from "@/components/module-hidden-note";
import { AiAppLabDrafts } from "@/components/ai-app-drafts";

export const Route = createFileRoute("/_auth/records/labs")({
  component: LabsPage,
});

type MarkerRow = {
  code: string;
  displayName: string;
  unit: string | null;
  latestValue: number | null;
  latestSampledAt: string | null;
  sampleCount: number;
  recentValues: { sampledAt: string; value: number }[];
  referenceRange?: Parameters<typeof displayLabRange>[1];
};

/**
 * A lab result typed in by hand: the marker, the value in the marker's unit
 * and when it was taken. There is no default marker: a reading saved to the
 * wrong marker reads as a real result.
 */
export function AddReadingForm({
  markers,
  onSaved,
}: {
  markers: ReadonlyArray<Pick<MarkerRow, "code" | "displayName" | "unit">>;
  onSaved: () => void;
}) {
  const { t, i18n } = useLingui();
  const [markerCode, setMarkerCode] = useState("");
  const marker = markers.find((option) => option.code === markerCode);
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

  const field = { min: 0, max: 100_000 } as const;
  const numeric = parseManualEntryValue(field, value, i18n.locale);

  const submit = () => {
    if (numeric === null || !marker) return;
    save.mutate({
      metricCode: marker.code as never,
      observedAt,
      valueNumeric: numeric,
      dedupeHash: makeManualEntryHash(marker.code as never, observedAt, numeric),
    });
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-2">
        <Label className="text-sm font-medium">
          <Trans>Marker</Trans>
        </Label>
        <Select value={markerCode} onValueChange={setMarkerCode}>
          <SelectTrigger className="w-full" aria-label={t`Marker`}>
            <SelectValue placeholder={t`Choose a marker`}>{marker?.displayName}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {markers.map((option) => (
              <SelectItem key={option.code} value={option.code}>
                {option.displayName}
                {option.unit ? <span className="text-ink-3"> · {option.unit}</span> : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="lab-value" className="text-sm font-medium">
            <Trans>Value</Trans>
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="lab-value"
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            {marker?.unit ? (
              <span className="num shrink-0 text-sm text-ink-3">
                <span className="sr-only">
                  <Trans>Unit</Trans>:{" "}
                </span>
                {marker.unit}
              </span>
            ) : null}
          </div>
          <DecimalHint value={value} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="lab-observed-at" className="text-sm font-medium">
            <Trans>Observed at</Trans>
          </Label>
          <Input
            id="lab-observed-at"
            type="datetime-local"
            value={observedAt}
            onChange={(event) => setObservedAt(event.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={numeric === null || !marker || save.isPending}>
          {save.isPending ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
        </Button>
        {numeric === null && value.length > 0 ? (
          <span className="text-sm text-destructive">
            <Trans>Value must be between 0 and 100,000.</Trans>
          </span>
        ) : save.isError ? (
          <span className="text-sm text-destructive">
            <Trans>Could not save.</Trans>
          </span>
        ) : null}
      </div>
    </form>
  );
}

/** The form in a dialog, opened from the "+" (`useLogDialog`). */
function LabResultDialog({
  markers,
  open,
  onOpenChange,
  onSaved,
}: {
  markers: readonly MarkerRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <LogDialog open={open} onOpenChange={onOpenChange} title={<Trans>Log a lab result</Trans>}>
      <AddReadingForm
        markers={markers}
        onSaved={() => {
          onSaved();
          onOpenChange(false);
        }}
      />
    </LogDialog>
  );
}

/**
 * One marker as one row: its name, then a line with the lab's printed range
 * shaded and its limits labelled, the latest reading as a dot with its
 * number, and earlier readings as faint dots. Placement only, in the labs
 * tone throughout: the row never calls a reading high, low or abnormal
 * (Legal and clinical gate decisions, never-add item 1).
 */
function MarkerRangeRow({
  marker,
  range,
  settings,
  showDate,
}: {
  marker: MarkerRow;
  range: LabRangeDisplay | null;
  settings: Parameters<typeof formatLabDate>[1];
  showDate: boolean;
}) {
  const { t, i18n } = useLingui();
  const { labUnits } = useDisplayPreferences();
  const shown = marker.recentValues.map((point) => ({
    sampledAt: point.sampledAt,
    ...displayLabValue(marker, point.value, labUnits),
  }));
  const latest = shown.at(-1) ?? null;
  const previous = shown.length > 1 ? shown.at(-2)! : null;
  const unit = latest?.unit ?? marker.unit;
  // A printed text range ("< 100") that came with numeric bounds is drawn from
  // the bounds; the text itself is still shown as recorded.
  const numericRange =
    range?.kind === "text" &&
    marker.referenceRange &&
    (marker.referenceRange.low !== null || marker.referenceRange.high !== null)
      ? displayLabRange(marker, { ...marker.referenceRange, text: null }, labUnits)
      : range;
  const line = labRangeLine(
    shown.map((point) => point.value),
    unit,
    numericRange,
  );
  const rangeText = range ? formatLabRange(i18n, range) : null;
  const latestText = latest ? formatLabValue(latest.value, null) : "—";
  const previousValue = previous ? formatLabValue(previous.value, null) : "";
  const previousDate = previous ? friendlyDate(i18n, previous.sampledAt) : "";
  const latestPoint = line?.points.at(-1) ?? null;

  return (
    <li className="grid gap-x-6 gap-y-2 py-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:items-center">
      <div className="grid min-w-0 gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2 font-semibold break-words text-ink">
          {marker.displayName}
          {unit ? <span className="text-sm font-normal text-ink-3">{unit}</span> : null}
        </span>
        <span className="text-sm text-ink-3">
          {previous ? (
            <Trans>
              was {previousValue} on {previousDate}
            </Trans>
          ) : null}
          {showDate && marker.latestSampledAt ? (
            <>
              {previous ? " · " : null}
              <time
                dateTime={marker.latestSampledAt}
                title={formatLabDate(marker.latestSampledAt, settings)}
              >
                {friendlyDate(i18n, marker.latestSampledAt)}
              </time>
            </>
          ) : null}
        </span>
        {latest?.converted ? (
          <span className="text-sm text-ink-3">
            {t({ message: `Converted from ${marker.unit ?? ""}`, comment: "safety" })}
          </span>
        ) : null}
      </div>

      <div className="grid min-w-0 gap-1">
        <span className="sr-only">
          {[
            t`Latest ${latestText}`,
            previous ? t`was ${previousValue} on ${previousDate}` : null,
            rangeText,
          ]
            .filter(Boolean)
            .join(". ")}
        </span>
        {line && latestPoint !== null ? (
          <div className="relative mx-3 h-14" aria-hidden="true">
            {/* The latest figure above its dot. */}
            <span
              className="num absolute top-0 -translate-x-1/2 font-display text-lg leading-none font-medium whitespace-nowrap text-ink"
              style={{ left: `${latestPoint}%` }}
            >
              {latestText}
            </span>
            <div className="absolute inset-x-0 top-8 h-2 rounded-full bg-paper-2">
              {line.band ? (
                <div
                  className="absolute inset-y-0 rounded-full bg-water-soft"
                  style={{
                    left: `${line.band.start}%`,
                    width: `${Math.max(line.band.end - line.band.start, 1)}%`,
                  }}
                />
              ) : null}
            </div>
            {line.points.slice(0, -1).map((point, index) => (
              <span
                key={shown[index]?.sampledAt ?? index}
                className="absolute top-8 size-2.5 -translate-x-1/2 -translate-y-[1px] rounded-full bg-water opacity-30"
                style={{ left: `${point}%` }}
              />
            ))}
            <span
              className="absolute top-8 size-4 -translate-x-1/2 -translate-y-1 rounded-full border-2 border-[var(--sheet)] bg-water"
              style={{ left: `${latestPoint}%` }}
            />
            {line.band?.low ? (
              <span
                className="num absolute top-11 -translate-x-1/2 text-xs text-ink-3"
                style={{ left: `${line.band.start}%` }}
              >
                {line.band.low}
              </span>
            ) : null}
            {line.band?.high ? (
              <span
                className="num absolute top-11 -translate-x-1/2 text-xs text-ink-3"
                style={{ left: `${line.band.end}%` }}
              >
                {line.band.high}
              </span>
            ) : null}
          </div>
        ) : (
          <span className="num font-display text-lg font-medium text-ink" aria-hidden="true">
            {latestText}
          </span>
        )}
        {rangeText && (!line?.band || range?.kind === "text") ? (
          <span className="num text-sm text-ink-3" aria-hidden="true">
            {rangeText}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/** Local calendar date of a reading, for grouping by draw. */
function drawDay(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function LabsPage() {
  const markers = useCacheFirst("labs.latest", () => client.labs.latest({ recentLimit: 10 }));
  const settingsQuery = useProductSettings();
  const settings = settingsQuery.data;
  const { labUnits } = useDisplayPreferences();
  const { t, i18n } = useLingui();
  const [logOpen, setLogOpen] = useState(false);
  const list = (markers.data ?? []) as MarkerRow[];
  // The "+" opens the lab result form while there is a marker to log to.
  useLogDialog("lab_result", list.length > 0 ? () => setLogOpen(true) : null);
  // The lab's own range stored with the latest reading, shown as recorded.
  const rangeOf = (marker: MarkerRow) =>
    marker.latestValue === null ? null : displayLabRange(marker, marker.referenceRange, labUnits);

  const header = <PageHeader title={<Trans>Labs</Trans>} actions={<SyncStatusBadge />} />;

  if (markers.isPending) {
    return (
      <Page>
        <ModuleHiddenNote module="labs" />
        {header}
        <div className="grid gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-3xl" />
          ))}
        </div>
      </Page>
    );
  }

  if (markers.isError || !markers.data) {
    return (
      <Page>
        <ModuleHiddenNote module="labs" />
        {header}
        <ErrorState
          title={<Trans>Could not load labs.</Trans>}
          action={
            <Button variant="outline" onClick={() => void markers.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      </Page>
    );
  }

  const withResults = list.filter((marker) => marker.latestValue !== null);
  const waiting = list.filter((marker) => marker.latestValue === null);
  // Markers grouped by the day of their latest reading, newest draw first.
  const draws = new Map<string, MarkerRow[]>();
  for (const marker of withResults) {
    const day = drawDay(marker.latestSampledAt);
    draws.set(day, [...(draws.get(day) ?? []), marker]);
  }
  const groups = [...draws.entries()].sort(([a], [b]) => b.localeCompare(a));

  return (
    <Page>
      <ModuleHiddenNote module="labs" />
      {header}

      <ProductSettingsStatus />

      {/* Lab results a connected AI app sent, waiting for the member (#439, M2c). */}
      <AiAppLabDrafts onSaved={() => void markers.refetch()} />

      {list.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title={<Trans>No lab markers yet</Trans>}
          description={
            <Trans>
              Markers appear here once a lab reading is recorded for your account. Importing lab
              reports is not available yet.
            </Trans>
          }
        />
      ) : (
        <>
          {groups.map(([day, rows], index) => {
            const when = day ? friendlyDate(i18n, day) : "";
            return (
              <Section
                key={day || "undated"}
                icon={FlaskConical}
                tone="water"
                title={
                  index === 0 ? <Trans>Latest draw · {when}</Trans> : <Trans>Drawn {when}</Trans>
                }
                info={
                  index === 0 ? (
                    <Trans comment="safety">
                      The shaded band is the range your lab printed with the result. Faint dots are
                      your earlier readings. OpenValens shows where a value sits and does not judge
                      it.
                    </Trans>
                  ) : undefined
                }
              >
                <ul className="sheet grid divide-y divide-rule px-5 py-1">
                  {rows.map((marker) => (
                    <MarkerRangeRow
                      key={marker.code}
                      marker={marker}
                      range={rangeOf(marker)}
                      settings={settings}
                      showDate={false}
                    />
                  ))}
                </ul>
              </Section>
            );
          })}
          {waiting.length > 0 ? (
            <Section
              icon={TestTube}
              tone="water"
              title={t`No readings yet`}
              info={
                <Trans>
                  Markers appear here once a lab reading is recorded for your account. Importing lab
                  reports is not available yet.
                </Trans>
              }
            >
              <ul className="sheet grid divide-y divide-rule px-5 py-1">
                {waiting.map((marker) => (
                  <li key={marker.code} className="flex items-baseline justify-between gap-4 py-3">
                    <span className="font-semibold text-ink">{marker.displayName}</span>
                    {marker.unit ? <span className="text-sm text-ink-3">{marker.unit}</span> : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </>
      )}

      {list.length > 0 ? (
        <LabResultDialog
          markers={list}
          open={logOpen}
          onOpenChange={setLogOpen}
          onSaved={() => void markers.refetch()}
        />
      ) : null}
    </Page>
  );
}
