import { Trans, useLingui } from "@lingui/react/macro";
import { displayLabValue } from "@openvalens/api/presenters/clinical-units";
import { formatLabDate, formatLabValue } from "@openvalens/api/presenters/labs";
import {
  defaultObservedAt,
  makeManualEntryHash,
  parseManualEntryValue,
} from "@openvalens/api/presenters/manual-entry";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FlaskConical, Plus, TestTube } from "lucide-react";

import {
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  Section,
  StatusPill,
  ToneIcon,
} from "@/components/page";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { ProductSettingsStatus } from "@/components/product-settings-status";
import { friendlyDate } from "@/utils/friendly";
import { client, orpc } from "@/utils/orpc";
import { useDisplayPreferences } from "@/lib/display-preferences";
import { useProductSettings } from "@/utils/product-settings";
import { enqueueMetricSample, useCacheFirst } from "@/utils/sync-engine";

export const Route = createFileRoute("/_auth/records/labs")({
  component: LabsPage,
});

function AddReadingForm({ markerCode, onSaved }: { markerCode: string; onSaved: () => void }) {
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
  const numeric = parseManualEntryValue(field, value);

  const submit = () => {
    if (numeric === null) return;
    save.mutate({
      metricCode: markerCode as never,
      observedAt,
      valueNumeric: numeric,
      dedupeHash: makeManualEntryHash(markerCode as never, observedAt, numeric),
    });
  };

  return (
    <Section icon={Plus} tone="water" title={<Trans>Add reading</Trans>} sheet>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <div className="grid gap-2">
          <Label className="text-sm font-medium">
            <Trans>Value</Trans>
          </Label>
          <Input
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="0–100000"
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
              <Trans>Value must be between 0 and 100,000.</Trans>
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

type MarkerRow = {
  code: string;
  displayName: string;
  unit: string | null;
  latestValue: number | null;
  latestSampledAt: string | null;
  sampleCount: number;
};

function MarkerCard({
  marker,
  display,
  settings,
}: {
  marker: MarkerRow;
  display: { value: number | null; unit: string | null; converted: boolean };
  settings: Parameters<typeof formatLabDate>[1];
}) {
  const { t, i18n } = useLingui();
  const hasValue = marker.latestValue !== null;
  return (
    <li className="sheet grid min-w-0 content-start gap-3 p-4">
      <div className="flex items-start gap-3">
        <ToneIcon icon={TestTube} tone="water" />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="font-semibold break-words text-ink">
            <span className="sr-only">
              <Trans>Name</Trans>:{" "}
            </span>
            {marker.displayName}
          </span>
          <span className="text-sm text-ink-3">
            <span className="sr-only">
              <Trans>Date</Trans>:{" "}
            </span>
            {hasValue && marker.latestSampledAt ? (
              <time
                dateTime={marker.latestSampledAt}
                title={formatLabDate(marker.latestSampledAt, settings)}
              >
                {friendlyDate(i18n, marker.latestSampledAt)}
              </time>
            ) : (
              t`No readings yet`
            )}
          </span>
        </div>
        {hasValue ? (
          <span className="num shrink-0 rounded-full bg-water-soft px-2.5 py-1 text-sm font-semibold text-ink">
            <span className="sr-only">
              <Trans>Value</Trans>:{" "}
            </span>
            {formatLabValue(display.value, null)}
            {display.unit ? (
              <span className="font-normal text-ink-2">
                <span className="sr-only">
                  {" "}
                  <Trans>Unit</Trans>:
                </span>{" "}
                {display.unit}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      {display.converted || marker.sampleCount > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {marker.sampleCount > 0 ? (
            <StatusPill tone="neutral">
              <Trans>Samples</Trans> <span className="num">{marker.sampleCount}</span>
            </StatusPill>
          ) : null}
          {display.converted ? (
            <span className="text-ink-3">
              {t({
                message: `Converted from ${marker.unit ?? ""}`,
                comment: "safety",
              })}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function LabsPage() {
  const markers = useCacheFirst("labs.latest", () => client.labs.latest({ recentLimit: 10 }));
  const settingsQuery = useProductSettings();
  const settings = settingsQuery.data;
  const { labUnits } = useDisplayPreferences();
  const { t } = useLingui();
  // Display only (#67): the stored reading and its reported unit never change.
  const shown = (marker: { code: string; unit: string | null; latestValue: number | null }) =>
    marker.latestValue === null
      ? { value: null, unit: marker.unit, converted: false }
      : displayLabValue(marker, marker.latestValue, labUnits);

  const header = <PageHeader title={<Trans>Labs</Trans>} actions={<SyncStatusBadge />} />;

  if (markers.isPending) {
    return (
      <Page>
        {header}
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-3xl" />
          ))}
        </div>
      </Page>
    );
  }

  if (markers.isError || !markers.data) {
    return (
      <Page>
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

  const list = markers.data;
  const withResults = list.filter((marker) => marker.latestValue !== null);
  const waiting = list.filter((marker) => marker.latestValue === null);

  return (
    <Page>
      {header}

      <ProductSettingsStatus />

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
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
          <div className="grid min-w-0 content-start gap-8">
            {withResults.length > 0 ? (
              <Section icon={FlaskConical} tone="water" title={<Trans>Your results</Trans>}>
                <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
                  {withResults.map((marker) => (
                    <MarkerCard
                      key={marker.code}
                      marker={marker}
                      display={shown(marker)}
                      settings={settings}
                    />
                  ))}
                </ul>
              </Section>
            ) : null}
            {waiting.length > 0 ? (
              <Section
                icon={TestTube}
                tone="water"
                title={t`No readings yet`}
                info={
                  <Trans>
                    Markers appear here once a lab reading is recorded for your account. Importing
                    lab reports is not available yet.
                  </Trans>
                }
              >
                <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
                  {waiting.map((marker) => (
                    <MarkerCard
                      key={marker.code}
                      marker={marker}
                      display={shown(marker)}
                      settings={settings}
                    />
                  ))}
                </ul>
              </Section>
            ) : null}
          </div>
          <AddReadingForm markerCode={list[0]?.code ?? ""} onSaved={() => void markers.refetch()} />
        </div>
      )}
    </Page>
  );
}
