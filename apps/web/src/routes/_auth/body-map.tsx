import { Trans, useLingui } from "@lingui/react/macro";
import {
  BODY_MAP_BASE,
  BODY_MAP_COPY,
  BODY_MAP_REGIONS,
  BODY_MAP_VIEWBOX,
  bodyMapArtwork,
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
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Dumbbell, MousePointerClick, PersonStanding, ScanLine } from "lucide-react";

import { Details, ErrorState, Page, PageHeader, Section, ToneIcon } from "@/components/page";
import { client } from "@/utils/orpc";
import { ModuleHiddenNote } from "@/components/module-hidden-note";

export const Route = createFileRoute("/_auth/body-map")({ component: BodyMapPage });

/**
 * Body map (#94): measured DEXA values by region, or this week's logged sets
 * by muscle group. Two separate layers, never blended. Colours and values
 * come from the shared presenter, so mobile draws the same map.
 */

type Layer = "composition" | "training";

/**
 * The male figure for everyone for now: the member's consented sex lives in
 * the wellness profile, which this page does not load.
 */
const ARTWORK = bodyMapArtwork("male");

const NATIVE_SELECT =
  "h-9 rounded-md border border-input bg-card px-3 text-ink hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55";

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
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap gap-1 rounded-full bg-paper-2 p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`h-8 cursor-pointer rounded-full px-3.5 text-sm font-medium transition-colors duration-[var(--dur-short)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:bg-paper-3 ${value === option.value ? "bg-card text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}
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
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-ink-2" aria-label={t`Legend`}>
      {steps.map((step) => (
        <li key={step.label} className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block size-3.5 rounded-full border border-rule"
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
      className="mx-auto h-[34rem] w-auto max-w-full text-ink"
      role="group"
      aria-label={view === "front" ? t`Body map, front view` : t`Body map, back view`}
    >
      <g aria-hidden fill={BODY_MAP_BASE} stroke="var(--ink-3)" strokeWidth={0.75}>
        <path d={ARTWORK.outline[view]} vectorEffect="non-scaling-stroke" />
        <path d={ARTWORK.base[view]} strokeOpacity={0.5} vectorEffect="non-scaling-stroke" />
      </g>
      {ARTWORK.regions
        .filter((region) => region.view === view)
        .map((region) => {
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
              strokeWidth={selected === region.id ? 2 : 0.75}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
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

export function BodyMapPage() {
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
      <ModuleHiddenNote module="body" />
      <PageHeader
        title={<Trans>Body map</Trans>}
        info={i18n._(BODY_MAP_COPY.intro)}
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

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {result || figurePending ? (
          <div className="sheet grid min-h-[36rem] place-items-center gap-5 px-5 py-6">
            {result ? (
              <BodyFigure
                view={view}
                fills={result.fills}
                selected={selected}
                onSelect={setSelected}
              />
            ) : (
              <Skeleton className="h-[34rem] w-full max-w-64" />
            )}
          </div>
        ) : null}

        <div className="grid min-w-0 content-start gap-8">
          {layer === "composition" ? (
            <Section
              icon={ScanLine}
              tone="weight"
              title={<Trans>Scan</Trans>}
              info={i18n._(compareScanId ? BODY_MAP_COPY.compare : BODY_MAP_COPY.composition)}
              sheet
            >
              <div className="grid gap-3 text-sm">
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
                        className={NATIVE_SELECT}
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
                        className={NATIVE_SELECT}
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
                          className={NATIVE_SELECT}
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
                {composition.isError ? (
                  <ErrorState
                    title={<Trans>Could not load this scan.</Trans>}
                    action={
                      <Button variant="outline" onClick={() => void composition.refetch()}>
                        <Trans>Retry</Trans>
                      </Button>
                    }
                  />
                ) : null}
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
              icon={Dumbbell}
              tone="weight"
              title={
                <Trans>
                  Sets from {trainingFrom} to {trainingTo}
                </Trans>
              }
              info={i18n._(BODY_MAP_COPY.training)}
            >
              {training.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  <Trans>Could not load your workouts.</Trans>
                </p>
              ) : null}
            </Section>
          )}

          {result ? (
            <>
              <div
                role="status"
                aria-live="polite"
                className="sheet flex items-start gap-3 p-5 text-sm"
              >
                <ToneIcon
                  icon={selectedRegion && selectedFill ? PersonStanding : MousePointerClick}
                  tone="weight"
                />
                <div className="grid min-w-0 gap-0.5">
                  {selectedRegion && selectedFill ? (
                    <>
                      <p className="font-semibold text-ink-2">{i18n._(selectedRegion.label)}</p>
                      <p className="num font-display text-[1.75rem] leading-tight font-medium text-ink">
                        {selectedFill.valueText ?? t`No value`}
                      </p>
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
                    <p className="pt-2 text-ink-3">
                      <Trans>Select a region to see its value.</Trans>
                    </p>
                  )}
                </div>
              </div>
              <Legend steps={result.legend} />
            </>
          ) : null}
        </div>
      </div>

      {layer === "training" && trainingResult && training.data ? (
        <Section icon={Dumbbell} tone="weight" title={<Trans>By muscle group</Trans>}>
          <div className="grid gap-4 text-sm">
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {TRAINING_GROUPS.map((group) => {
                const count = formatSets(trainingResult.setsByGroup[group]);
                return (
                  <li
                    key={group}
                    className="sheet flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="font-semibold text-ink-2">
                      {i18n._(TRAINING_GROUP_LABELS[group])}
                    </span>
                    <span className="num shrink-0 rounded-full bg-weight-soft px-2.5 py-1 font-semibold text-ink">
                      {t`${count} sets`}
                    </span>
                  </li>
                );
              })}
            </ul>
            {training.data.unmapped.length ? (
              <Details summary={<Trans>Not counted (no catalog muscles)</Trans>}>
                <ul className="sheet grid gap-1 p-5 text-ink-2">
                  {training.data.unmapped.map((item) => {
                    const name = item.name;
                    const count = item.sets;
                    return <li key={name}>{t`${name}: ${count} sets`}</li>;
                  })}
                </ul>
              </Details>
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
