import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { formatLabDate, formatLabValue } from "@openvalens/api/presenters/labs";
import {
  defaultObservedAt,
  makeManualEntryHash,
  parseManualEntryValue,
} from "@openvalens/api/presenters/manual-entry";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { SyncStatusBadge } from "@/components/sync-status-badge";
import { ProductSettingsStatus } from "@/components/product-settings-status";
import { client, orpc } from "@/utils/orpc";
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
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Add reading</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
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
        <div className="flex items-center gap-3 sm:col-span-2">
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
      </CardContent>
    </Card>
  );
}

function LabsPage() {
  const markers = useCacheFirst("labs.latest", () => client.labs.latest({ recentLimit: 10 }));
  const settingsQuery = useProductSettings();
  const settings = settingsQuery.data;
  const { t } = useLingui();

  if (markers.isPending) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">
            <Trans>Labs</Trans>
          </h1>
          <SyncStatusBadge />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (markers.isError || !markers.data) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">
            <Trans>Labs</Trans>
          </h1>
          <SyncStatusBadge />
        </div>
        <p className="text-sm text-muted-foreground">
          <Trans>Could not load labs.</Trans>{" "}
          <button className="underline" onClick={() => void markers.refetch()}>
            <Trans>Retry</Trans>
          </button>
        </p>
      </div>
    );
  }

  const list = markers.data;

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          <Trans>Labs</Trans>
        </h1>
        <SyncStatusBadge />
      </div>

      <ProductSettingsStatus />

      {list.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">
              <Trans>No lab markers yet</Trans>
            </p>
            <p className="text-sm text-muted-foreground">
              <Trans>Import a lab PDF to add markers.</Trans>
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <AddReadingForm markerCode={list[0]?.code ?? ""} onSaved={() => void markers.refetch()} />
          <Card className="py-0">
            <ul className="divide-y divide-border">
              {list.map((marker) => (
                <li key={marker.code} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{marker.displayName}</div>
                    <div className="text-sm text-muted-foreground">
                      {marker.latestValue === null
                        ? t`No readings yet`
                        : t`${formatLabDate(marker.latestSampledAt, settings)} · ${plural(marker.sampleCount, { one: "# reading", other: "# readings" })}`}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-lg">
                      {formatLabValue(marker.latestValue, marker.unit)}
                    </div>
                    <div className="text-xs text-muted-foreground">{marker.unit ?? ""}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
