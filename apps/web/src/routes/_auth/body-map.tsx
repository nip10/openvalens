import { Trans, useLingui } from "@lingui/react/macro";
import {
  BODY_MAP_COPY,
  BODY_MAP_REGIONS,
  BODY_MAP_VIEWBOX,
  DEXA_MEASUREMENT_LABELS,
  compositionLayer,
  dexaMeasurementTypes,
  formatSets,
  trainingLayer,
  TRAINING_GROUP_LABELS,
  TRAINING_GROUPS,
  type BodyMapView,
  type LegendStep,
  type RegionFill,
} from "@openvalens/api/presenters/body-map";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { client } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/body-map")({ component: BodyMapPage });

/**
 * Body map (#94): measured DEXA values by region, or this week's logged sets
 * by muscle group. Two separate layers, never blended. Colours and values
 * come from the shared presenter, so mobile draws the same map.
 */

type Layer = "composition" | "training";

function localToday(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function Toggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`min-h-9 rounded-md border px-3 text-sm ${value === option.value ? "bg-accent font-medium" : ""}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Legend({ steps }: { steps: LegendStep[] }) {
  const { t } = useLingui();
  return (
    <ul className="grid gap-1 text-sm" aria-label={t`Legend`}>
      {steps.map((step) => (
        <li key={step.label} className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block size-4 rounded-sm border"
            style={{ backgroundColor: step.colour }}
          />
          {step.label}
        </li>
      ))}
    </ul>
  );
}

function BodyFigure({
  view,
  fills,
  selected,
  onSelect,
}: {
  view: BodyMapView;
  fills: Record<string, RegionFill>;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { t, i18n } = useLingui();
  return (
    <svg
      viewBox={BODY_MAP_VIEWBOX}
      className="mx-auto h-96 w-auto"
      role="group"
      aria-label={view === "front" ? t`Body map, front view` : t`Body map, back view`}
    >
      {BODY_MAP_REGIONS.filter((region) => region.view === view).map((region) => {
        const fill = fills[region.id]!;
        const label = i18n._(region.label);
        const value = fill.valueText ?? t`no value`;
        const description = t`${label}: ${value}`;
        return (
          <path
            key={region.id}
            d={region.path}
            fill={fill.colour}
            stroke={selected === region.id ? "currentColor" : "#71717a"}
            strokeWidth={selected === region.id ? 2.5 : 1}
            tabIndex={0}
            role="button"
            aria-pressed={selected === region.id}
            aria-label={description}
            className="cursor-pointer outline-none focus-visible:stroke-[3]"
            onClick={() => onSelect(region.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(region.id);
              }
            }}
          >
            <title>{description}</title>
          </path>
        );
      })}
    </svg>
  );
}

function BodyMapPage() {
  const [layer, setLayer] = useState<Layer>("composition");
  const [view, setView] = useState<BodyMapView>("front");
  const [selected, setSelected] = useState<string | null>(null);
  const [scanId, setScanId] = useState<number | null>(null);
  const [compareScanId, setCompareScanId] = useState<number | null>(null);
  const [measurementType, setMeasurementType] = useState<string | null>(null);
  const today = localToday();
  const { t, i18n } = useLingui();
  const typeLabel = (type: string) => {
    const known = DEXA_MEASUREMENT_LABELS[type];
    return known ? i18n._(known.label) : type;
  };

  const scans = useQuery({
    queryKey: ["bodyMap", "scans"],
    queryFn: async () =>
      ((await client.body.listDexaScans({})) as { id: number; date: string }[])
        .map((scan) => ({ id: scan.id, date: scan.date }))
        .sort((a, b) => b.date.localeCompare(a.date)),
    enabled: layer === "composition",
  });
  const activeScanId = scanId ?? scans.data?.[0]?.id ?? null;
  const composition = useQuery({
    queryKey: ["bodyMap", "composition", activeScanId, compareScanId],
    queryFn: () =>
      client.bodyMap.composition({
        scanId: activeScanId!,
        ...(compareScanId ? { compareScanId } : {}),
      }),
    enabled: layer === "composition" && activeScanId !== null,
  });
  const training = useQuery({
    queryKey: ["bodyMap", "training", today],
    queryFn: () => client.bodyMap.training({ today }),
    enabled: layer === "training",
  });

  const types = composition.data ? dexaMeasurementTypes(composition.data.values) : [];
  const activeType =
    measurementType && types.includes(measurementType) ? measurementType : types[0];
  const compositionResult =
    composition.data && activeType
      ? compositionLayer(
          {
            measurementType: activeType,
            values: composition.data.values,
            ...(composition.data.compare ? { compareValues: composition.data.compare.values } : {}),
          },
          i18n,
        )
      : null;
  const trainingResult = training.data ? trainingLayer(training.data.exercises, i18n) : null;
  const scanSource = composition.data?.scan.source ?? "";
  const scanDate = composition.data?.scan.date ?? "";
  const compareDate = composition.data?.compare?.scan.date ?? null;
  const trainingFrom = training.data?.from ?? "…";
  const trainingTo = training.data?.to ?? today;
  const result = layer === "composition" ? compositionResult : trainingResult;
  const selectedRegion = BODY_MAP_REGIONS.find((region) => region.id === selected) ?? null;
  const selectedFill = selectedRegion && result ? result.fills[selectedRegion.id] : null;

  return (
    <main className="container mx-auto grid max-w-4xl gap-6 px-4 py-6">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold">
          <Trans>Body map</Trans>
        </h1>
        <p className="text-sm text-muted-foreground">{i18n._(BODY_MAP_COPY.intro)}</p>
      </header>

      <div className="flex flex-wrap gap-4">
        <Toggle
          label={t`Layer`}
          value={layer}
          onChange={(value) => {
            setLayer(value);
            setSelected(null);
          }}
          options={[
            { value: "composition", label: t`Measured composition` },
            { value: "training", label: t`Training this week` },
          ]}
        />
        <Toggle
          label={t`Side`}
          value={view}
          onChange={(value) => {
            setView(value);
            setSelected(null);
          }}
          options={[
            { value: "front", label: t`Front` },
            { value: "back", label: t`Back` },
          ]}
        />
      </div>

      {layer === "composition" ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Scan</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p className="text-muted-foreground">
              {i18n._(compareScanId ? BODY_MAP_COPY.compare : BODY_MAP_COPY.composition)}
            </p>
            {scans.isPending ? (
              <p role="status">
                <Trans>Loading scans…</Trans>
              </p>
            ) : scans.isError ? (
              <p role="alert">
                <Trans>Could not load your scans.</Trans>
              </p>
            ) : !scans.data?.length ? (
              <p>
                <Trans>No DEXA scans yet. Import a scan to see measured regions here.</Trans>
              </p>
            ) : (
              <div className="flex flex-wrap gap-4">
                <label className="grid gap-1">
                  <Trans>Scan</Trans>
                  <select
                    className="min-h-9 rounded-md border bg-background px-2"
                    value={activeScanId ?? ""}
                    onChange={(event) => {
                      setScanId(Number(event.target.value));
                      setCompareScanId(null);
                    }}
                  >
                    {scans.data.map((scan) => (
                      <option key={scan.id} value={scan.id}>
                        {scan.date}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <Trans>Compare with</Trans>
                  <select
                    className="min-h-9 rounded-md border bg-background px-2"
                    value={compareScanId ?? ""}
                    onChange={(event) =>
                      setCompareScanId(event.target.value ? Number(event.target.value) : null)
                    }
                  >
                    <option value="">{t`No comparison`}</option>
                    {scans.data
                      .filter((scan) => scan.id !== activeScanId)
                      .map((scan) => (
                        <option key={scan.id} value={scan.id}>
                          {scan.date}
                        </option>
                      ))}
                  </select>
                </label>
                {types.length > 1 ? (
                  <label className="grid gap-1">
                    <Trans>Measurement</Trans>
                    <select
                      className="min-h-9 rounded-md border bg-background px-2"
                      value={activeType}
                      onChange={(event) => setMeasurementType(event.target.value)}
                    >
                      {types.map((type) => (
                        <option key={type} value={type}>
                          {typeLabel(type)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            )}
            {composition.data ? (
              <p>
                {compareDate
                  ? t`${scanSource}, ${scanDate}, compared with ${compareDate}`
                  : `${scanSource}, ${scanDate}`}
                {activeType ? ` · ${typeLabel(activeType)}` : ""}
              </p>
            ) : null}
            {composition.data && !types.length ? (
              <p>
                <Trans>This scan has no regional values.</Trans>
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>
                Sets from {trainingFrom} to {trainingTo}
              </Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p className="text-muted-foreground">{i18n._(BODY_MAP_COPY.training)}</p>
            {training.isError ? (
              <p role="alert">
                <Trans>Could not load your workouts.</Trans>
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}

      {result ? (
        <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
          <BodyFigure view={view} fills={result.fills} selected={selected} onSelect={setSelected} />
          <div className="grid content-start gap-4">
            <div role="status" aria-live="polite" className="rounded-md border p-3 text-sm">
              {selectedRegion && selectedFill ? (
                <>
                  <p className="font-medium">{i18n._(selectedRegion.label)}</p>
                  <p>{selectedFill.valueText ?? t`No value`}</p>
                  {selectedFill.sourceText ? (
                    <p className="text-muted-foreground">{selectedFill.sourceText}</p>
                  ) : null}
                  {layer === "composition" && composition.data ? (
                    <p className="text-muted-foreground">
                      <Trans>Scan {scanDate}</Trans>
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-muted-foreground">
                  <Trans>Select a region to see its value.</Trans>
                </p>
              )}
            </div>
            <Legend steps={result.legend} />
          </div>
        </div>
      ) : null}

      {layer === "training" && trainingResult && training.data ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>By muscle group</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <ul className="grid gap-1 sm:grid-cols-2">
              {TRAINING_GROUPS.map((group) => {
                const count = formatSets(trainingResult.setsByGroup[group]);
                return (
                  <li key={group} className="flex justify-between gap-2">
                    <span>{i18n._(TRAINING_GROUP_LABELS[group])}</span>
                    <span>{t`${count} sets`}</span>
                  </li>
                );
              })}
            </ul>
            {training.data.unmapped.length ? (
              <div>
                <p className="font-medium">
                  <Trans>Not counted (no catalog muscles)</Trans>
                </p>
                <ul className="list-disc pl-5">
                  {training.data.unmapped.map((item) => {
                    const name = item.name;
                    const count = item.sets;
                    return <li key={name}>{t`${name}: ${count} sets`}</li>;
                  })}
                </ul>
              </div>
            ) : null}
            {trainingResult.unmappedMuscles.length ? (
              <p className="text-muted-foreground">
                {t`Muscles not shown on the map: ${trainingResult.unmappedMuscles.join(", ")}`}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
