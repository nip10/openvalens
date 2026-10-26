import { useLingui } from "@lingui/react/macro";
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
import { useQuery } from "@tanstack/react-query";
import { Button, Card, cn } from "heroui-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { G, Path } from "react-native-svg";

import { ErrorState } from "@/components/bloom";
import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { client } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

/**
 * Body map (#94) on mobile: measured DEXA values by region, or this week's
 * logged sets by muscle group. Same shared presenter as the web page, so the
 * same scan gives the same colours and values.
 */

type Layer = "composition" | "training";

/**
 * The male figure for everyone for now: the member's consented sex lives in
 * the wellness profile, which this screen does not load.
 */
const ARTWORK = bodyMapArtwork("male");

function localToday(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function Chips<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      className="flex-row flex-wrap gap-2"
    >
      {options.map((option) => (
        <Pressable
          key={String(option.value)}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === option.value }}
          onPress={() => onChange(option.value)}
          className={cn(
            "min-h-11 justify-center rounded-full border px-4 active:opacity-70",
            value === option.value ? "border-signal bg-sidebar-accent" : "border-rule-2 bg-paper-2",
          )}
        >
          <Text
            className={cn(
              "font-sans text-sm",
              value === option.value
                ? "font-semibold text-sidebar-accent-foreground"
                : "font-medium text-ink-2",
            )}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Legend({ steps }: { steps: LegendStep[] }) {
  const { t } = useLingui();
  return (
    <View className="gap-1" accessibilityLabel={t`Legend`}>
      {steps.map((step) => (
        <View key={step.label} className="flex-row items-center gap-2">
          <View
            className="h-4 w-4 rounded-sm border border-rule"
            style={{ backgroundColor: step.colour }}
          />
          <Text className="text-sm text-ink-2">{step.label}</Text>
        </View>
      ))}
    </View>
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
  const regions = ARTWORK.regions.filter((region) => region.view === view);
  const { t, i18n } = useLingui();
  // The figure keeps its own light palette in both themes, so its edges stay
  // a fixed grey; the selected region is ringed in the signal colour.
  const edge = "#71717a";
  const selectedEdge = useThemeColor("signal");
  return (
    <View className="items-center">
      <Svg width={180} height={360} viewBox={BODY_MAP_VIEWBOX} accessible={false}>
        <G fill={BODY_MAP_BASE} stroke={edge} strokeWidth={0.8}>
          <Path d={ARTWORK.outline[view]} />
          <Path d={ARTWORK.base[view]} strokeOpacity={0.5} />
        </G>
        {regions.map((region) => (
          <Path
            key={region.id}
            d={region.path}
            fill={fills[region.id]!.colour}
            stroke={selected === region.id ? selectedEdge : edge}
            strokeWidth={selected === region.id ? 2.2 : 0.8}
            strokeLinejoin="round"
            onPress={() => onSelect(region.id)}
          />
        ))}
      </Svg>
      {/* Screen readers get the regions as a list of buttons with their values. */}
      <View className="mt-2 w-full gap-1">
        {regions.map((region) => {
          const fill = fills[region.id]!;
          if (!fill.valueText) return null;
          const label = i18n._(region.label);
          const value = fill.valueText;
          return (
            <Pressable
              key={region.id}
              accessibilityRole="button"
              accessibilityLabel={t`${label}: ${value}`}
              accessibilityState={{ selected: selected === region.id }}
              onPress={() => onSelect(region.id)}
              className="min-h-11 flex-row items-center justify-between gap-2 border-b border-rule px-1"
            >
              <Text className="flex-1 text-sm text-ink-2">{label}</Text>
              <Text className="text-sm text-ink-2">{fill.valueText}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function BodyMapScreen() {
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
  const recentScans = (scans.data ?? []).slice(0, 6);

  return (
    <Container className="p-4">
      <View className="gap-6">
        <View className="gap-2">
          <Text
            accessibilityRole="header"
            className="font-display text-[30px] font-semibold leading-[36px] text-ink"
          >
            {t`Body map`}
          </Text>
          <Text className="text-sm text-ink-3">{i18n._(BODY_MAP_COPY.intro)}</Text>
        </View>

        <Chips
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
        <Chips
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

        {layer === "composition" ? (
          <CardStack title={t`Scan`}>
            <Card variant="secondary" className="gap-3 p-4">
              <Text className="text-sm text-ink-3">
                {i18n._(compareScanId ? BODY_MAP_COPY.compare : BODY_MAP_COPY.composition)}
              </Text>
              {scans.isPending ? (
                <Text className="text-sm text-ink-2">{t`Loading scans…`}</Text>
              ) : scans.isError ? (
                <Text className="text-sm text-ink-2">{t`Could not load your scans.`}</Text>
              ) : !recentScans.length ? (
                <Text className="text-sm text-ink-2">
                  {t`No DEXA scans yet. Import a scan to see measured regions here.`}
                </Text>
              ) : (
                <>
                  <Text className="text-sm font-medium text-ink-2">{t`Scan`}</Text>
                  <Chips
                    label={t`Scan`}
                    value={activeScanId}
                    onChange={(value) => {
                      setScanId(value);
                      setCompareScanId(null);
                    }}
                    options={recentScans.map((scan) => ({ value: scan.id, label: scan.date }))}
                  />
                  {recentScans.length > 1 ? (
                    <>
                      <Text className="text-sm font-medium text-ink-2">{t`Compare with`}</Text>
                      <Chips
                        label={t`Compare with`}
                        value={compareScanId ?? 0}
                        onChange={(value) => setCompareScanId(value === 0 ? null : value)}
                        options={[
                          { value: 0, label: t`No comparison` },
                          ...recentScans
                            .filter((scan) => scan.id !== activeScanId)
                            .map((scan) => ({ value: scan.id, label: scan.date })),
                        ]}
                      />
                    </>
                  ) : null}
                  {types.length > 1 ? (
                    <>
                      <Text className="text-sm font-medium text-ink-2">{t`Measurement`}</Text>
                      <Chips
                        label={t`Measurement`}
                        value={activeType ?? null}
                        onChange={setMeasurementType}
                        options={types.map((type) => ({
                          value: type,
                          label: typeLabel(type),
                        }))}
                      />
                    </>
                  ) : null}
                </>
              )}
              {composition.isError ? (
                <ErrorState
                  title={t`Could not load this scan.`}
                  action={
                    <Button variant="outline" size="sm" onPress={() => void composition.refetch()}>
                      <Button.Label>{t`Retry`}</Button.Label>
                    </Button>
                  }
                />
              ) : null}
              {composition.data ? (
                <Text className="text-sm text-ink-2">
                  {compareDate
                    ? t`${scanSource}, ${scanDate}, compared with ${compareDate}`
                    : `${scanSource}, ${scanDate}`}
                </Text>
              ) : null}
              {composition.data && !types.length ? (
                <Text className="text-sm text-ink-2">{t`This scan has no regional values.`}</Text>
              ) : null}
            </Card>
          </CardStack>
        ) : (
          <CardStack title={t`Sets from ${trainingFrom} to ${trainingTo}`}>
            <Card variant="secondary" className="gap-2 p-4">
              <Text className="text-sm text-ink-3">{i18n._(BODY_MAP_COPY.training)}</Text>
              {training.isError ? (
                <Text className="text-sm text-ink-2">{t`Could not load your workouts.`}</Text>
              ) : null}
            </Card>
          </CardStack>
        )}

        {result ? (
          <View className="gap-4">
            <BodyFigure
              view={view}
              fills={result.fills}
              selected={selected}
              onSelect={setSelected}
            />
            <View
              accessibilityLiveRegion="polite"
              className="gap-1 rounded-lg border border-rule p-3"
            >
              {selectedRegion && selectedFill ? (
                <>
                  <Text className="text-sm font-medium text-ink-2">
                    {i18n._(selectedRegion.label)}
                  </Text>
                  <Text className="text-sm text-ink-2">
                    {selectedFill.valueText ?? t`No value`}
                  </Text>
                  {selectedFill.sourceText ? (
                    <Text className="text-sm text-ink-3">{selectedFill.sourceText}</Text>
                  ) : null}
                  {layer === "composition" && composition.data ? (
                    <Text className="text-sm text-ink-3">{t`Scan ${scanDate}`}</Text>
                  ) : null}
                </>
              ) : (
                <Text className="text-sm text-ink-3">{t`Tap a region to see its value.`}</Text>
              )}
            </View>
            <Legend steps={result.legend} />
          </View>
        ) : null}

        {layer === "training" && trainingResult && training.data ? (
          <CardStack title={t`By muscle group`}>
            <Card variant="secondary" className="gap-2 p-4">
              {TRAINING_GROUPS.map((group) => {
                const count = formatSets(trainingResult.setsByGroup[group]);
                return (
                  <View key={group} className="flex-row justify-between gap-2">
                    <Text className="text-sm text-ink-2">
                      {i18n._(TRAINING_GROUP_LABELS[group])}
                    </Text>
                    <Text className="text-sm text-ink-2">{t`${count} sets`}</Text>
                  </View>
                );
              })}
              {training.data.unmapped.length ? (
                <View className="mt-2 gap-1">
                  <Text className="text-sm font-medium text-ink-2">
                    {t`Not counted (no catalog muscles)`}
                  </Text>
                  {training.data.unmapped.map((item) => {
                    const name = item.name;
                    const count = item.sets;
                    return (
                      <Text key={name} className="text-sm text-ink-2">
                        {t`${name}: ${count} sets`}
                      </Text>
                    );
                  })}
                </View>
              ) : null}
              {trainingResult.unmappedMuscles.length ? (
                <Text className="text-sm text-ink-3">
                  {t`Muscles not shown on the map: ${trainingResult.unmappedMuscles.join(", ")}`}
                </Text>
              ) : null}
            </Card>
          </CardStack>
        ) : null}
      </View>
    </Container>
  );
}
