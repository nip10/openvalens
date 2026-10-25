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

import { EmptyState, ErrorState, Page, PageHeader, Section } from "@/components/page";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { ProductSettingsStatus } from "@/components/product-settings-status";
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
    <Section title={<Trans>Add reading</Trans>} className="well px-5 pt-4 pb-5">
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
        <div className="sheet grid gap-3 px-5 py-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
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

  return (
    <Page>
      {header}

      <ProductSettingsStatus />

      {list.length === 0 ? (
        <EmptyState
          title={<Trans>No lab markers yet</Trans>}
          description={
            <Trans>
              Markers appear here once a lab reading is recorded for your account. Importing lab
              reports is not available yet.
            </Trans>
          }
        />
      ) : (
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
          <div className="sheet min-w-0 px-2 pt-2 pb-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Trans>Name</Trans>
                  </TableHead>
                  <TableHead className="num">
                    <Trans>Value</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Unit</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Date</Trans>
                  </TableHead>
                  <TableHead className="num">
                    <Trans>Samples</Trans>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((marker) => {
                  const display = shown(marker);
                  return (
                    <TableRow key={marker.code}>
                      <TableCell className="font-display font-medium whitespace-normal text-ink">
                        {marker.displayName}
                      </TableCell>
                      <TableCell className="num text-base text-ink">
                        {formatLabValue(display.value, null)}
                      </TableCell>
                      <TableCell className="whitespace-normal text-ink-3">
                        {display.unit ?? ""}
                        {display.converted ? (
                          <span className="block text-xs">
                            {t({
                              message: `Converted from ${marker.unit ?? ""}`,
                              comment: "safety",
                            })}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-ink-3">
                        {marker.latestValue === null
                          ? t`No readings yet`
                          : formatLabDate(marker.latestSampledAt, settings)}
                      </TableCell>
                      <TableCell className="num text-ink-2">{marker.sampleCount}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <AddReadingForm markerCode={list[0]?.code ?? ""} onSaved={() => void markers.refetch()} />
        </div>
      )}
    </Page>
  );
}
