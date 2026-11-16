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
  dexaRegionLabel,
  dexaRegionRows,
  formatDexaValue,
  formatSets,
  normalizeDexaRegion,
  painLayer,
  painRegionLabel,
  trainingLayer,
  TRAINING_GROUP_LABELS,
  TRAINING_GROUPS,
  type BodyMapView,
  type LegendStep,
  type PainSpot,
  type RegionFill,
} from "@openvalens/api/presenters/body-map";
import { PAIN_COPY } from "@openvalens/api/presenters/pain";
import { browserTimeZone } from "@openvalens/api/presenters/tracker-draft";
import { isPainRegion, type PainMapWindow } from "@openvalens/pain/model";
import { Button } from "@openvalens/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openvalens/ui/components/select";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarRange, Dumbbell, MousePointerClick, PersonStanding, ScanLine } from "lucide-react";

import { Details, ErrorState, Page, PageHeader, Section, ToneIcon } from "@/components/page";
import { SectionTabs } from "@/components/section-tabs";
import { friendlyDate } from "@/utils/friendly";
import { client } from "@/utils/orpc";
import { ModuleHiddenNote } from "@/components/module-hidden-note";
import {
  PAIN_KEYS,
  PainHistory,
  PainLogForm,
  PainNotice,
  PainOff,
  PainSettings,
} from "@/components/pain/pain-panel";

type BodyMapSearch = { layer?: "pain"; region?: string };

export const Route = createFileRoute("/_auth/body-map")({
  component: BodyMapRoute,
  // The quick log palette (#440) opens the pain layer, with a region when one was typed.
  validateSearch: (search: Record<string, unknown>): BodyMapSearch =>
    search.layer === "pain"
      ? {
          layer: "pain",
          ...(typeof search.region === "string" && isPainRegion(search.region)
            ? { region: search.region }
            : {}),
        }
      : {},
});

function BodyMapRoute() {
  const search = Route.useSearch();
  return (
    <BodyMapPage
      key={`${search.layer ?? ""}:${search.region ?? ""}`}
      initialLayer={search.layer}
      initialRegion={search.region}
    />
  );
}

/**
 * Body map (#94): measured DEXA values by region, this week's logged sets by
 * muscle group, or the pain the member rated (#442). Separate layers, never
 * blended. Colours and values come from the shared presenter, so mobile draws
 * the same map. The pain-only joint spots appear on the pain layer only.
 */

type Layer = "composition" | "training" | "pain";

/**
 * The male figure for everyone for now: the member's consented sex lives in
 * the wellness profile, which this page does not load.
 */
const ARTWORK = bodyMapArtwork("male");

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
  spots = [],
  selected,
  highlighted,
  onSelect,
}: {
  view: BodyMapView;
  fills: Record<string, RegionFill>;
  /** Pain-only joint spots (#442), drawn above the regions. */
  spots?: readonly PainSpot[];
  selected: string | null;
  /** Regions to outline, e.g. while a row of the regional table is hovered. */
  highlighted?: ReadonlySet<string>;
  onSelect: (id: string) => void;
}) {
  const { t, i18n } = useLingui();
  const shapes = [
    ...ARTWORK.regions.filter((region) => region.view === view),
    ...spots.filter((spot) => spot.view === view),
  ];
  return (
    <svg
      viewBox={BODY_MAP_VIEWBOX}
      className="mx-auto h-[24rem] w-auto max-w-full text-ink sm:h-[34rem]"
      role="group"
      aria-label={view === "front" ? t`Body map, front view` : t`Body map, back view`}
    >
      <g aria-hidden fill={BODY_MAP_BASE} stroke="var(--ink-3)" strokeWidth={0.75}>
        <path d={ARTWORK.outline[view]} vectorEffect="non-scaling-stroke" />
        <path d={ARTWORK.base[view]} strokeOpacity={0.5} vectorEffect="non-scaling-stroke" />
      </g>
      {shapes.map((region) => {
        const fill = fills[region.id]!;
        const label = i18n._(region.label);
        const value = fill.valueText ?? t`no value`;
        const description = t`${label}: ${value}`;
        return (
          <path
            key={`${region.view}:${region.id}`}
            d={region.path}
            fill={fill.colour}
            stroke={
              selected === region.id || highlighted?.has(region.id) ? "var(--ink)" : "var(--ink-3)"
            }
            strokeWidth={selected === region.id || highlighted?.has(region.id) ? 2 : 0.75}
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

const LAYER_KEY = "openvalens.bodyMap.layer";

/** The layer the member looked at last, on this browser only. */
function rememberedLayer(): Layer | null {
  try {
    const value = window.localStorage.getItem(LAYER_KEY);
    return value === "composition" || value === "training" || value === "pain" ? value : null;
  } catch {
    return null;
  }
}

function rememberLayer(layer: Layer) {
  try {
    window.localStorage.setItem(LAYER_KEY, layer);
  } catch {
    // Storage can be off (private window); the page works without it.
  }
}

/** The shared picker in a labelled column. */
function Picker({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <div className="grid min-w-0 gap-1.5 text-ink-3">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue>{options.find((option) => option.value === value)?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function BodyMapPage({
  initialLayer,
  initialRegion,
}: { initialLayer?: Layer; initialRegion?: string } = {}) {
  const [layer, setLayerState] = useState<Layer>(
    () =>
      initialLayer ?? (typeof window === "undefined" ? null : rememberedLayer()) ?? "composition",
  );
  const setLayer = (next: Layer) => {
    setLayerState(next);
    rememberLayer(next);
  };
  // A back region (back.lower_back_left) shows the back view.
  const [view, setView] = useState<BodyMapView>(
    initialRegion?.startsWith("back.") ? "back" : "front",
  );
  const [selected, setSelected] = useState<string | null>(
    initialLayer === "pain" ? (initialRegion ?? null) : null,
  );
  const [hovered, setHovered] = useState<readonly string[]>([]);
  const [scanId, setScanId] = useState<number | null>(null);
  // Undefined: the default, which compares with the scan before when there is one.
  const [compareChoice, setCompareChoice] = useState<number | null | undefined>(undefined);
  const [measurementType, setMeasurementType] = useState<string | null>(null);
  const [painDays, setPainDays] = useState<PainMapWindow>(7);
  const today = localToday();
  const { t, i18n } = useLingui();
  const qc = useQueryClient();
  const typeLabel = (type: string) => {
    const known = DEXA_MEASUREMENT_LABELS[type];
    return known ? i18n._(known.label) : type;
  };

  const scans = useQuery({
    queryKey: ["bodyMap", "scans"],
    queryFn: async () =>
      (
        (await client.body.listDexaScans({})) as {
          id: number;
          date: string;
          bodyFatPct?: unknown;
        }[]
      )
        .map((scan) => ({
          id: scan.id,
          date: scan.date,
          bodyFatPct: typeof scan.bodyFatPct === "number" ? scan.bodyFatPct : null,
        }))
        .sort((a, b) => b.date.localeCompare(a.date)),
    enabled: layer === "composition",
  });
  const activeScan = scans.data?.find((scan) => scan.id === scanId) ?? scans.data?.[0] ?? null;
  const activeScanId = activeScan?.id ?? null;
  const earlierScans = (scans.data ?? []).filter(
    (scan) => activeScan && scan.id !== activeScan.id && scan.date <= activeScan.date,
  );
  const compareScanId = compareChoice === undefined ? (earlierScans[0]?.id ?? null) : compareChoice;
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
  const painPreference = useQuery({
    queryKey: PAIN_KEYS.preference,
    queryFn: () => client.pain.preference({}),
    enabled: layer === "pain",
  });
  const painOn = painPreference.data?.enabled === true;
  const painMap = useQuery({
    queryKey: PAIN_KEYS.map(painDays),
    queryFn: () => client.pain.map({ days: painDays, timeZone: browserTimeZone() }),
    enabled: layer === "pain" && painOn,
  });
  const setPainPreference = useMutation({
    mutationFn: (change: { enabled?: boolean; aiVisible?: boolean }) =>
      client.pain.setPreference(change),
    onSuccess: () => void qc.invalidateQueries({ queryKey: PAIN_KEYS.all }),
  });

  const types = composition.data ? dexaMeasurementTypes(composition.data.values) : [];
  const activeType =
    measurementType && types.includes(measurementType) ? measurementType : types[0];
  const compareValues = composition.data?.compare?.values;
  const compositionResult =
    composition.data && activeType
      ? compositionLayer(
          {
            measurementType: activeType,
            values: composition.data.values,
            ...(compareValues ? { compareValues } : {}),
          },
          i18n,
        )
      : null;
  const regionRows =
    composition.data && activeType
      ? dexaRegionRows({
          measurementType: activeType,
          values: composition.data.values,
          ...(compareValues ? { compareValues } : {}),
        })
      : [];
  const trainingResult = training.data ? trainingLayer(training.data.exercises, i18n) : null;
  const painResult =
    painOn && painMap.data ? painLayer(painMap.data.regions, painDays, i18n) : null;
  const scanSource = composition.data?.scan.source ?? "";
  const scanDate = composition.data?.scan.date
    ? friendlyDate(i18n, composition.data.scan.date)
    : "";
  const compareDate = composition.data?.compare?.scan.date
    ? friendlyDate(i18n, composition.data.compare.scan.date)
    : null;
  // The caption says something the pickers do not: the scan's total body fat.
  const totalFat =
    composition.data?.values.find(
      (row) =>
        row.measurementType === "fat_pct" &&
        ["total", "whole_body"].includes(normalizeDexaRegion(row.region)),
    )?.value ??
    activeScan?.bodyFatPct ??
    null;
  const trainingFrom = training.data?.from ?? "…";
  const trainingTo = training.data?.to ?? today;
  const result =
    layer === "composition"
      ? compositionResult
      : layer === "training"
        ? trainingResult
        : painResult;
  const selectedLabel =
    layer === "pain"
      ? selected
        ? painRegionLabel(selected)
        : null
      : (BODY_MAP_REGIONS.find((region) => region.id === selected)?.label ?? null);
  const selectedFill =
    selected && selectedLabel && result ? (result.fills[selected] ?? null) : null;

  const figurePending =
    layer === "composition"
      ? scans.isPending || (activeScanId !== null && composition.isPending)
      : layer === "training"
        ? training.isPending
        : painPreference.isPending || (painOn && painMap.isPending);
  const selectedRow = regionRows.find((row) => selected && row.mapRegionIds.includes(selected));

  return (
    <Page>
      <SectionTabs parent="/body" />
      <ModuleHiddenNote module="body" />
      <PageHeader
        title={<Trans>Body map</Trans>}
        info={i18n._(BODY_MAP_COPY.intro)}
        actions={
          <Toggle
            label={t`Layer`}
            value={layer}
            onChange={(value) => {
              setLayer(value);
              setSelected(null);
            }}
            options={[
              { value: "composition", label: t`Composition` },
              { value: "training", label: t`Training` },
              { value: "pain", label: t`Pain` },
            ]}
          />
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-8">
        {/* Pickers and layer controls: above the figure on phones, beside it on desktop. */}
        <div className="grid min-w-0 content-start gap-6 lg:col-start-2 lg:row-start-1">
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
                  <div className="grid grid-cols-2 gap-3">
                    <Picker
                      label={t`Scan`}
                      value={String(activeScanId ?? "")}
                      onChange={(value) => {
                        setScanId(Number(value));
                        setCompareChoice(undefined);
                      }}
                      options={scans.data.map((scan) => ({
                        value: String(scan.id),
                        label: friendlyDate(i18n, scan.date),
                      }))}
                    />
                    <Picker
                      label={t`Compare with`}
                      value={String(compareScanId ?? "none")}
                      onChange={(value) =>
                        setCompareChoice(value === "none" ? null : Number(value))
                      }
                      options={[
                        { value: "none", label: t`No comparison` },
                        ...earlierScans.map((scan) => ({
                          value: String(scan.id),
                          label: friendlyDate(i18n, scan.date),
                        })),
                      ]}
                    />
                    {types.length > 1 ? (
                      <div className="col-span-2">
                        <Picker
                          label={t`Measurement`}
                          value={activeType ?? ""}
                          onChange={setMeasurementType}
                          options={types.map((type) => ({ value: type, label: typeLabel(type) }))}
                        />
                      </div>
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
                    {totalFat !== null ? (
                      <span className="num block text-ink-3">
                        {t`Total body fat ${formatDexaValue(totalFat, "fat_pct")}`}
                      </span>
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
          ) : layer === "pain" ? (
            <>
              <PainNotice />
              {painPreference.isError ? (
                <ErrorState
                  title={<Trans>Could not check whether the pain log is on.</Trans>}
                  action={
                    <Button variant="outline" onClick={() => void painPreference.refetch()}>
                      <Trans>Retry</Trans>
                    </Button>
                  }
                />
              ) : painPreference.data && !painOn ? (
                <PainOff
                  onTurnOn={() => setPainPreference.mutate({ enabled: true })}
                  saving={setPainPreference.isPending}
                  failed={setPainPreference.isError}
                />
              ) : painOn ? (
                <Section
                  icon={CalendarRange}
                  tone="weight"
                  title={
                    painMap.data ? (
                      <Trans>
                        Highest rating from {painMap.data.from} to {painMap.data.to}
                      </Trans>
                    ) : (
                      <Trans>Highest rating</Trans>
                    )
                  }
                  info={i18n._(PAIN_COPY.layer)}
                >
                  <Toggle
                    label={t`Days`}
                    value={String(painDays) as "7" | "30"}
                    onChange={(value) => setPainDays(Number(value) as PainMapWindow)}
                    options={[
                      { value: "7", label: t`Last 7 days` },
                      { value: "30", label: t`Last 30 days` },
                    ]}
                  />
                  {painMap.isError ? (
                    <p role="alert" className="text-sm text-destructive">
                      <Trans>Could not load your pain log.</Trans>
                    </p>
                  ) : null}
                </Section>
              ) : null}
            </>
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
        </div>

        {result || figurePending ? (
          <div className="sheet relative grid place-items-center gap-5 px-5 pt-14 pb-6 sm:min-h-[36rem] lg:col-start-1 lg:row-span-2 lg:row-start-1">
            {/* Front and back belong to the figure, so they sit on its card. */}
            <div className="absolute top-4 right-4">
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
            {result ? (
              <BodyFigure
                view={view}
                fills={result.fills}
                spots={layer === "pain" ? ARTWORK.painSpots : []}
                selected={selected}
                highlighted={new Set(hovered)}
                onSelect={setSelected}
              />
            ) : (
              <Skeleton className="h-[24rem] w-full max-w-64 sm:h-[34rem]" />
            )}
          </div>
        ) : null}

        <div className="grid min-w-0 content-start gap-6 lg:col-start-2 lg:row-start-2">
          {layer === "composition" && result && regionRows.length > 0 ? (
            <div className="sheet min-w-0 px-2 pt-2 pb-1">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  {activeType ? typeLabel(activeType) : <Trans>Regions</Trans>}
                </caption>
                <thead>
                  <tr className="text-left text-ink-3">
                    <th scope="col" className="px-3 py-2 font-medium">
                      <Trans>Region</Trans>
                    </th>
                    <th scope="col" className="num px-3 py-2 text-right font-medium">
                      {activeType ? typeLabel(activeType) : null}
                    </th>
                    {compareValues ? (
                      <th scope="col" className="num px-3 py-2 text-right font-medium">
                        <Trans>Change</Trans>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {regionRows.map((row) => {
                    const active = row === selectedRow;
                    return (
                      <tr
                        key={row.region}
                        className={`border-t border-rule transition-colors duration-[var(--dur-short)] hover:bg-paper-2 ${active ? "bg-paper-2" : ""} ${row.region === "total" ? "font-semibold" : ""}`}
                        onMouseEnter={() => setHovered(row.mapRegionIds)}
                        onMouseLeave={() => setHovered([])}
                      >
                        <th scope="row" className="px-3 py-2 text-left font-medium text-ink-2">
                          {dexaRegionLabel(row, i18n)}
                        </th>
                        <td className="num px-3 py-2 text-right text-ink">
                          {formatDexaValue(row.value, activeType!)}
                        </td>
                        {compareValues ? (
                          <td className="num px-3 py-2 text-right text-ink-2">
                            {row.change === null
                              ? "—"
                              : formatDexaValue(row.change, activeType!, true)}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {result && layer !== "composition" ? (
            <div
              role="status"
              aria-live="polite"
              className="sheet flex items-start gap-3 p-5 text-sm"
            >
              <ToneIcon
                icon={selectedLabel && selectedFill ? PersonStanding : MousePointerClick}
                tone="weight"
              />
              <div className="grid min-w-0 gap-0.5">
                {selectedLabel && selectedFill ? (
                  <>
                    <p className="font-semibold text-ink-2">{i18n._(selectedLabel)}</p>
                    <p className="num font-display text-[1.75rem] leading-tight font-medium text-ink">
                      {selectedFill.valueText ?? t`No value`}
                    </p>
                    {selectedFill.sourceText ? (
                      <p className="text-ink-3">{selectedFill.sourceText}</p>
                    ) : null}
                  </>
                ) : (
                  <p className="pt-2 text-ink-3">
                    <Trans>Select a region to see its value.</Trans>
                  </p>
                )}
              </div>
            </div>
          ) : null}
          {result ? <Legend steps={result.legend} /> : null}

          {layer === "pain" && painOn && painPreference.data ? (
            <>
              <PainLogForm key={selected ?? "none"} selected={selected} />
              {selected ? <PainHistory region={selected} /> : null}
              <PainSettings
                preference={painPreference.data}
                saving={setPainPreference.isPending}
                onChange={(change) => setPainPreference.mutate(change)}
              />
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
