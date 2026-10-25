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
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Page, PageHeader, Section } from "@/components/page";
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
    <div role="radiogroup" aria-label={label} className="flex flex-wrap">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`-ml-px h-9 border px-3 font-display text-sm font-medium transition-colors duration-[var(--dur-short)] first:ml-0 first:rounded-l-sm last:rounded-r-sm focus-visible:relative focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:bg-paper-3 ${value === option.value ? "relative border-primary bg-primary text-primary-foreground" : "border-rule-2 bg-sheet text-ink-2 hover:bg-muted"}`}
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
    <ul className="grid gap-1.5 text-sm text-ink-2" aria-label={t`Legend`}>
      {steps.map((step) => (
        <li key={step.label} className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block size-4 border border-rule-2"
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
      className="mx-auto h-[28rem] w-auto max-w-full text-ink"
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
            stroke={selected === region.id ? "var(--ink)" : "var(--ink-3)"}
            strokeWidth={selected === region.id ? 2.5 : 1}
            tabIndex={0}
            role="button"
            aria-pressed={selected === region.id}
            aria-label={description}
            className="cursor-pointer outline-none focus-visible:stroke-signal focus-visible:stroke-[3]"
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

  const figurePending =
    layer === "composition"
      ? scans.isPending || (activeScanId !== null && composition.isPending)
      : training.isPending;

  return (
    <Page>
      <PageHeader
        title={<Trans>Body map</Trans>}
        description={i18n._(BODY_MAP_COPY.intro)}
        actions={
          <>
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
          </>
        }
      />

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {result || figurePending ? (
          <div className="sheet grid min-h-[30rem] place-items-center px-5 py-6">
            {result ? (
              <BodyFigure
                view={view}
                fills={result.fills}
                selected={selected}
                onSelect={setSelected}
              />
            ) : (
              <Skeleton className="h-[28rem] w-full max-w-56" />
            )}
          </div>
        ) : null}

        <div className="grid min-w-0 content-start gap-8">
          {layer === "composition" ? (
            <Section title={<Trans>Scan</Trans>}>
              <div className="grid gap-3 border-t border-rule pt-4 text-sm">
                <p className="text-ink-3">
                  {i18n._(compareScanId ? BODY_MAP_COPY.compare : BODY_MAP_COPY.composition)}
                </p>
                {scans.isPending ? (
                  <p role="status" className="text-ink-3">
                    <Trans>Loading scans…</Trans>
                  </p>
                ) : scans.isError ? (
                  <p role="alert" className="text-destructive">
                    <Trans>Could not load your scans.</Trans>
                  </p>
                ) : !scans.data?.length ? (
                  <p className="text-ink-2">
                    <Trans>No DEXA scans yet. Import a scan to see measured regions here.</Trans>
                  </p>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-ink-3">
                      <Trans>Scan</Trans>
                      <select
                        className="h-9 rounded-sm border border-input bg-sheet px-2 text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
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
                    <label className="grid gap-1.5 text-ink-3">
                      <Trans>Compare with</Trans>
                      <select
                        className="h-9 rounded-sm border border-input bg-sheet px-2 text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
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
                      <label className="grid gap-1.5 text-ink-3 sm:col-span-2">
                        <Trans>Measurement</Trans>
                        <select
                          className="h-9 rounded-sm border border-input bg-sheet px-2 text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
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
                  <p className="text-ink-2">
                    {compareDate
                      ? t`${scanSource}, ${scanDate}, compared with ${compareDate}`
                      : `${scanSource}, ${scanDate}`}
                    {activeType ? (
                      <span className="block text-ink-3">{typeLabel(activeType)}</span>
                    ) : null}
                  </p>
                ) : null}
                {composition.data && !types.length ? (
                  <p className="text-ink-2">
                    <Trans>This scan has no regional values.</Trans>
                  </p>
                ) : null}
              </div>
            </Section>
          ) : (
            <Section
              title={
                <Trans>
                  Sets from {trainingFrom} to {trainingTo}
                </Trans>
              }
            >
              <div className="grid gap-2 border-t border-rule pt-4 text-sm">
                <p className="text-ink-3">{i18n._(BODY_MAP_COPY.training)}</p>
                {training.isError ? (
                  <p role="alert" className="text-destructive">
                    <Trans>Could not load your workouts.</Trans>
                  </p>
                ) : null}
              </div>
            </Section>
          )}

          {result ? (
            <>
              <div role="status" aria-live="polite" className="well px-5 py-4 text-sm">
                {selectedRegion && selectedFill ? (
                  <>
                    <p className="font-display text-base font-medium text-ink">
                      {i18n._(selectedRegion.label)}
                    </p>
                    <p className="num text-lg text-ink">{selectedFill.valueText ?? t`No value`}</p>
                    {selectedFill.sourceText ? (
                      <p className="text-ink-3">{selectedFill.sourceText}</p>
                    ) : null}
                    {layer === "composition" && composition.data ? (
                      <p className="text-ink-3">
                        <Trans>Scan {scanDate}</Trans>
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-ink-3">
                    <Trans>Select a region to see its value.</Trans>
                  </p>
                )}
              </div>
              <Legend steps={result.legend} />
            </>
          ) : null}
        </div>
      </div>

      {layer === "training" && trainingResult && training.data ? (
        <Section title={<Trans>By muscle group</Trans>}>
          <div className="grid gap-4 text-sm">
            <ul className="sheet grid divide-y divide-rule px-5 sm:grid-cols-2 sm:gap-x-10 sm:divide-y-0">
              {TRAINING_GROUPS.map((group) => {
                const count = formatSets(trainingResult.setsByGroup[group]);
                return (
                  <li
                    key={group}
                    className="flex items-baseline justify-between gap-2 py-2 sm:border-b sm:border-rule"
                  >
                    <span className="text-ink-2">{i18n._(TRAINING_GROUP_LABELS[group])}</span>
                    <span className="num text-ink">{t`${count} sets`}</span>
                  </li>
                );
              })}
            </ul>
            {training.data.unmapped.length ? (
              <div className="grid gap-1">
                <p className="font-display font-medium text-ink">
                  <Trans>Not counted (no catalog muscles)</Trans>
                </p>
                <ul className="grid gap-0.5 text-ink-2">
                  {training.data.unmapped.map((item) => {
                    const name = item.name;
                    const count = item.sets;
                    return <li key={name}>{t`${name}: ${count} sets`}</li>;
                  })}
                </ul>
              </div>
            ) : null}
            {trainingResult.unmappedMuscles.length ? (
              <p className="text-ink-3">
                {t`Muscles not shown on the map: ${trainingResult.unmappedMuscles.join(", ")}`}
              </p>
            ) : null}
          </div>
        </Section>
      ) : null}
    </Page>
  );
}
