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
  return (
    <ul className="grid gap-1 text-sm" aria-label="Legend">
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
  return (
    <svg
      viewBox={BODY_MAP_VIEWBOX}
      className="mx-auto h-96 w-auto"
      role="group"
      aria-label={`Body map, ${view} view`}
    >
      {BODY_MAP_REGIONS.filter((region) => region.view === view).map((region) => {
        const fill = fills[region.id]!;
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
            aria-label={`${region.label}: ${fill.valueText ?? "no value"}`}
            className="cursor-pointer outline-none focus-visible:stroke-[3]"
            onClick={() => onSelect(region.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(region.id);
              }
            }}
          >
            <title>{`${region.label}: ${fill.valueText ?? "no value"}`}</title>
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
      ? compositionLayer({
          measurementType: activeType,
          values: composition.data.values,
          ...(composition.data.compare ? { compareValues: composition.data.compare.values } : {}),
        })
      : null;
  const trainingResult = training.data ? trainingLayer(training.data.exercises) : null;
  const result = layer === "composition" ? compositionResult : trainingResult;
  const selectedRegion = BODY_MAP_REGIONS.find((region) => region.id === selected) ?? null;
  const selectedFill = selectedRegion && result ? result.fills[selectedRegion.id] : null;

  return (
    <main className="container mx-auto grid max-w-4xl gap-6 px-4 py-6">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold">Body map</h1>
        <p className="text-sm text-muted-foreground">{BODY_MAP_COPY.intro}</p>
      </header>

      <div className="flex flex-wrap gap-4">
        <Toggle
          label="Layer"
          value={layer}
          onChange={(value) => {
            setLayer(value);
            setSelected(null);
          }}
          options={[
            { value: "composition", label: "Measured composition" },
            { value: "training", label: "Training this week" },
          ]}
        />
        <Toggle
          label="Side"
          value={view}
          onChange={(value) => {
            setView(value);
            setSelected(null);
          }}
          options={[
            { value: "front", label: "Front" },
            { value: "back", label: "Back" },
          ]}
        />
      </div>

      {layer === "composition" ? (
        <Card>
          <CardHeader>
            <CardTitle>Scan</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p className="text-muted-foreground">
              {compareScanId ? BODY_MAP_COPY.compare : BODY_MAP_COPY.composition}
            </p>
            {scans.isPending ? (
              <p role="status">Loading scans…</p>
            ) : scans.isError ? (
              <p role="alert">Could not load your scans.</p>
            ) : !scans.data?.length ? (
              <p>No DEXA scans yet. Import a scan to see measured regions here.</p>
            ) : (
              <div className="flex flex-wrap gap-4">
                <label className="grid gap-1">
                  Scan
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
                  Compare with
                  <select
                    className="min-h-9 rounded-md border bg-background px-2"
                    value={compareScanId ?? ""}
                    onChange={(event) =>
                      setCompareScanId(event.target.value ? Number(event.target.value) : null)
                    }
                  >
                    <option value="">No comparison</option>
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
                    Measurement
                    <select
                      className="min-h-9 rounded-md border bg-background px-2"
                      value={activeType}
                      onChange={(event) => setMeasurementType(event.target.value)}
                    >
                      {types.map((type) => (
                        <option key={type} value={type}>
                          {DEXA_MEASUREMENT_LABELS[type]?.label ?? type}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            )}
            {composition.data ? (
              <p>
                {composition.data.scan.source}, {composition.data.scan.date}
                {composition.data.compare
                  ? `, compared with ${composition.data.compare.scan.date}`
                  : ""}
                {activeType ? ` · ${DEXA_MEASUREMENT_LABELS[activeType]?.label ?? activeType}` : ""}
              </p>
            ) : null}
            {composition.data && !types.length ? <p>This scan has no regional values.</p> : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              Sets from {training.data?.from ?? "…"} to {training.data?.to ?? today}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p className="text-muted-foreground">{BODY_MAP_COPY.training}</p>
            {training.isError ? <p role="alert">Could not load your workouts.</p> : null}
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
                  <p className="font-medium">{selectedRegion.label}</p>
                  <p>{selectedFill.valueText ?? "No value"}</p>
                  {selectedFill.sourceText ? (
                    <p className="text-muted-foreground">{selectedFill.sourceText}</p>
                  ) : null}
                  {layer === "composition" && composition.data ? (
                    <p className="text-muted-foreground">Scan {composition.data.scan.date}</p>
                  ) : null}
                </>
              ) : (
                <p className="text-muted-foreground">Select a region to see its value.</p>
              )}
            </div>
            <Legend steps={result.legend} />
          </div>
        </div>
      ) : null}

      {layer === "training" && trainingResult && training.data ? (
        <Card>
          <CardHeader>
            <CardTitle>By muscle group</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <ul className="grid gap-1 sm:grid-cols-2">
              {TRAINING_GROUPS.map((group) => (
                <li key={group} className="flex justify-between gap-2">
                  <span>{TRAINING_GROUP_LABELS[group]}</span>
                  <span>{formatSets(trainingResult.setsByGroup[group])} sets</span>
                </li>
              ))}
            </ul>
            {training.data.unmapped.length ? (
              <div>
                <p className="font-medium">Not counted (no catalog muscles)</p>
                <ul className="list-disc pl-5">
                  {training.data.unmapped.map((item) => (
                    <li key={item.name}>
                      {item.name}: {item.sets} sets
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {trainingResult.unmappedMuscles.length ? (
              <p className="text-muted-foreground">
                Muscles not shown on the map: {trainingResult.unmappedMuscles.join(", ")}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
