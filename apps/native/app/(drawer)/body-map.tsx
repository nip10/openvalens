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
import { useQuery } from "@tanstack/react-query";
import { Card } from "heroui-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { client } from "@/utils/orpc";

/**
 * Body map (#94) on mobile: measured DEXA values by region, or this week's
 * logged sets by muscle group. Same shared presenter as the web page, so the
 * same scan gives the same colours and values.
 */

type Layer = "composition" | "training";

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
          className={`min-h-11 justify-center rounded-lg border px-3 ${value === option.value ? "bg-accent" : "border-border"}`}
        >
          <Text className="text-sm text-foreground">{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Legend({ steps }: { steps: LegendStep[] }) {
  return (
    <View className="gap-1" accessibilityLabel="Legend">
      {steps.map((step) => (
        <View key={step.label} className="flex-row items-center gap-2">
          <View
            className="h-4 w-4 rounded-sm border border-border"
            style={{ backgroundColor: step.colour }}
          />
          <Text className="text-sm text-foreground">{step.label}</Text>
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
  const regions = BODY_MAP_REGIONS.filter((region) => region.view === view);
  return (
    <View className="items-center">
      <Svg width={180} height={360} viewBox={BODY_MAP_VIEWBOX} accessible={false}>
        {regions.map((region) => (
          <Path
            key={region.id}
            d={region.path}
            fill={fills[region.id]!.colour}
            stroke={selected === region.id ? "#18181b" : "#71717a"}
            strokeWidth={selected === region.id ? 2.5 : 1}
            onPress={() => onSelect(region.id)}
          />
        ))}
      </Svg>
      {/* Screen readers get the regions as a list of buttons with their values. */}
      <View className="mt-2 w-full gap-1">
        {regions.map((region) => {
          const fill = fills[region.id]!;
          if (!fill.valueText) return null;
          return (
            <Pressable
              key={region.id}
              accessibilityRole="button"
              accessibilityLabel={`${region.label}: ${fill.valueText}`}
              accessibilityState={{ selected: selected === region.id }}
              onPress={() => onSelect(region.id)}
              className="min-h-11 flex-row items-center justify-between gap-2 border-b border-border px-1"
            >
              <Text className="flex-1 text-sm text-foreground">{region.label}</Text>
              <Text className="text-sm text-foreground">{fill.valueText}</Text>
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
  const recentScans = (scans.data ?? []).slice(0, 6);

  return (
    <Container className="p-4">
      <View className="gap-6">
        <View className="gap-2">
          <Text accessibilityRole="header" className="font-mono text-3xl text-foreground">
            Body map
          </Text>
          <Text className="text-sm text-muted-foreground">{BODY_MAP_COPY.intro}</Text>
        </View>

        <Chips
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
        <Chips
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

        {layer === "composition" ? (
          <CardStack title="Scan">
            <Card variant="secondary" className="gap-3 p-4">
              <Text className="text-sm text-muted-foreground">
                {compareScanId ? BODY_MAP_COPY.compare : BODY_MAP_COPY.composition}
              </Text>
              {scans.isPending ? (
                <Text className="text-sm text-foreground">Loading scans…</Text>
              ) : scans.isError ? (
                <Text className="text-sm text-foreground">Could not load your scans.</Text>
              ) : !recentScans.length ? (
                <Text className="text-sm text-foreground">
                  No DEXA scans yet. Import a scan to see measured regions here.
                </Text>
              ) : (
                <>
                  <Text className="text-sm font-medium text-foreground">Scan</Text>
                  <Chips
                    label="Scan"
                    value={activeScanId}
                    onChange={(value) => {
                      setScanId(value);
                      setCompareScanId(null);
                    }}
                    options={recentScans.map((scan) => ({ value: scan.id, label: scan.date }))}
                  />
                  {recentScans.length > 1 ? (
                    <>
                      <Text className="text-sm font-medium text-foreground">Compare with</Text>
                      <Chips
                        label="Compare with"
                        value={compareScanId ?? 0}
                        onChange={(value) => setCompareScanId(value === 0 ? null : value)}
                        options={[
                          { value: 0, label: "No comparison" },
                          ...recentScans
                            .filter((scan) => scan.id !== activeScanId)
                            .map((scan) => ({ value: scan.id, label: scan.date })),
                        ]}
                      />
                    </>
                  ) : null}
                  {types.length > 1 ? (
                    <>
                      <Text className="text-sm font-medium text-foreground">Measurement</Text>
                      <Chips
                        label="Measurement"
                        value={activeType ?? null}
                        onChange={setMeasurementType}
                        options={types.map((type) => ({
                          value: type,
                          label: DEXA_MEASUREMENT_LABELS[type]?.label ?? type,
                        }))}
                      />
                    </>
                  ) : null}
                </>
              )}
              {composition.data ? (
                <Text className="text-sm text-foreground">
                  {composition.data.scan.source}, {composition.data.scan.date}
                  {composition.data.compare
                    ? `, compared with ${composition.data.compare.scan.date}`
                    : ""}
                </Text>
              ) : null}
              {composition.data && !types.length ? (
                <Text className="text-sm text-foreground">This scan has no regional values.</Text>
              ) : null}
            </Card>
          </CardStack>
        ) : (
          <CardStack
            title={`Sets from ${training.data?.from ?? "…"} to ${training.data?.to ?? today}`}
          >
            <Card variant="secondary" className="gap-2 p-4">
              <Text className="text-sm text-muted-foreground">{BODY_MAP_COPY.training}</Text>
              {training.isError ? (
                <Text className="text-sm text-foreground">Could not load your workouts.</Text>
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
              className="gap-1 rounded-lg border border-border p-3"
            >
              {selectedRegion && selectedFill ? (
                <>
                  <Text className="text-sm font-medium text-foreground">
                    {selectedRegion.label}
                  </Text>
                  <Text className="text-sm text-foreground">
                    {selectedFill.valueText ?? "No value"}
                  </Text>
                  {selectedFill.sourceText ? (
                    <Text className="text-sm text-muted-foreground">{selectedFill.sourceText}</Text>
                  ) : null}
                  {layer === "composition" && composition.data ? (
                    <Text className="text-sm text-muted-foreground">
                      Scan {composition.data.scan.date}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text className="text-sm text-muted-foreground">
                  Tap a region to see its value.
                </Text>
              )}
            </View>
            <Legend steps={result.legend} />
          </View>
        ) : null}

        {layer === "training" && trainingResult && training.data ? (
          <CardStack title="By muscle group">
            <Card variant="secondary" className="gap-2 p-4">
              {TRAINING_GROUPS.map((group) => (
                <View key={group} className="flex-row justify-between gap-2">
                  <Text className="text-sm text-foreground">{TRAINING_GROUP_LABELS[group]}</Text>
                  <Text className="text-sm text-foreground">
                    {formatSets(trainingResult.setsByGroup[group])} sets
                  </Text>
                </View>
              ))}
              {training.data.unmapped.length ? (
                <View className="mt-2 gap-1">
                  <Text className="text-sm font-medium text-foreground">
                    Not counted (no catalog muscles)
                  </Text>
                  {training.data.unmapped.map((item) => (
                    <Text key={item.name} className="text-sm text-foreground">
                      {item.name}: {item.sets} sets
                    </Text>
                  ))}
                </View>
              ) : null}
              {trainingResult.unmappedMuscles.length ? (
                <Text className="text-sm text-muted-foreground">
                  Muscles not shown on the map: {trainingResult.unmappedMuscles.join(", ")}
                </Text>
              ) : null}
            </Card>
          </CardStack>
        ) : null}
      </View>
    </Container>
  );
}
