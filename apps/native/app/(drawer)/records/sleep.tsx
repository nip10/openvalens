import {
  formatClockTime,
  formatSleepDuration,
  formatSleepEfficiency,
  lastNightStages,
  sleepSeries,
  sleepStatusLabel,
  sleepStatusTone,
} from "@openhealth/api/presenters/sleep";
import { useQuery } from "@tanstack/react-query";
import { Card, Chip, Spinner } from "heroui-native";
import { useMemo } from "react";
import { Pressable, RefreshControl, Text, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { LineChart } from "@/components/chart";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

const TREND_WINDOW_DAYS = 30;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 gap-1">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="font-mono text-lg text-foreground">{value}</Text>
    </View>
  );
}

type ChipColor = "danger" | "warning" | "success" | "default";
function statusChipColor(status: Parameters<typeof sleepStatusTone>[0]): ChipColor {
  const tone = sleepStatusTone(status);
  if (tone === "destructive") return "danger";
  if (tone === "warning") return "warning";
  if (tone === "success") return "success";
  return "default";
}

function StageBars({ stages }: { stages: { stage: string; label: string; minutes: number }[] }) {
  const chart1 = useThemeColor("chart-1");
  const chart2 = useThemeColor("chart-2");
  const chart3 = useThemeColor("chart-3");
  const chart4 = useThemeColor("chart-4");
  const muted = useThemeColor("muted");
  const total = stages.reduce((sum, s) => sum + s.minutes, 0);

  const colorFor = (stage: string): string => {
    switch (stage) {
      case "awake":
        return chart4;
      case "light":
        return chart1;
      case "deep":
        return chart3;
      case "rem":
        return chart2;
      default:
        return muted;
    }
  };

  if (total === 0) {
    return <Text className="text-sm text-muted-foreground">No stage data.</Text>;
  }

  return (
    <View className="gap-3">
      <View className="flex-row h-3 overflow-hidden rounded-full bg-muted">
        {stages.map((entry) => (
          <View
            key={entry.stage}
            style={{
              backgroundColor: colorFor(entry.stage),
              width: `${(entry.minutes / total) * 100}%`,
            }}
          />
        ))}
      </View>
      <View className="gap-2">
        {stages.map((entry) => (
          <View key={entry.stage} className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <View
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: colorFor(entry.stage) }}
              />
              <Text className="text-sm text-muted-foreground">{entry.label}</Text>
            </View>
            <Text className="font-mono text-sm text-foreground">
              {formatSleepDuration(entry.minutes)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function SleepScreen() {
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const chart1 = useThemeColor("chart-1");

  const summary = useQuery(orpc.sleep.summary.queryOptions({ input: { days: TREND_WINDOW_DAYS } }));

  const series = useMemo(() => (summary.data ? sleepSeries(summary.data) : []), [summary.data]);

  if (summary.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );

  if (summary.isError || !summary.data)
    return (
      <Container className="items-center justify-center gap-3 p-6" isScrollable={false}>
        <Text className="text-base text-foreground">Could not load sleep.</Text>
        <Pressable
          onPress={() => void summary.refetch()}
          className="min-h-11 justify-center px-4"
          accessibilityRole="button"
        >
          <Text className="font-medium text-foreground underline">Retry</Text>
        </Pressable>
      </Container>
    );

  const last = summary.data.lastNight;
  const stages = lastNightStages(last);
  const maxAsleep = Math.max(60, ...series.map((p) => p.asleepMinutes));

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={summary.isRefetching}
            onRefresh={() => void summary.refetch()}
            tintColor={foreground}
          />
        ),
      }}
    >
      <View className="gap-6 p-4">
        <View>
          <Text className="text-sm text-muted-foreground">Sleep</Text>
          <Text className="font-mono text-3xl text-foreground">Last 30 days</Text>
        </View>

        {!last ? (
          <Card variant="secondary" className="items-center gap-1 p-8">
            <Text className="font-medium text-foreground">No sleep yet</Text>
            <Text className="text-center text-sm text-muted-foreground">
              Track sleep through Health Connect or Apple Health, or add a session.
            </Text>
          </Card>
        ) : (
          <>
            <CardStack>
              <Card variant="secondary" className="gap-3 p-4">
                <View className="flex-row items-center justify-between">
                  <Text className="text-lg font-medium text-foreground">Last night</Text>
                  <Chip size="sm" color={statusChipColor(last.status)}>
                    <Chip.Label>{sleepStatusLabel(last.status)}</Chip.Label>
                  </Chip>
                </View>
                <Text className="text-sm text-muted-foreground">{last.date}</Text>
                <View className="flex-row gap-4">
                  <Stat label="Asleep" value={formatSleepDuration(last.asleepMinutes)} />
                  <Stat label="In bed" value={formatSleepDuration(last.timeInBedMinutes)} />
                  <Stat label="Efficiency" value={formatSleepEfficiency(last.sleepEfficiencyPct)} />
                </View>
                <Text className="text-sm text-muted-foreground">
                  {formatClockTime(last.mainSleepStart)} → {formatClockTime(last.mainSleepEnd)}
                </Text>
              </Card>
            </CardStack>

            <CardStack title="Stages">
              <Card variant="secondary" className="p-4">
                <StageBars stages={stages} />
              </Card>
            </CardStack>

            <CardStack title={`Last ${TREND_WINDOW_DAYS} days`}>
              <Card variant="secondary" className="p-4">
                <LineChart
                  data={series.map((point) => ({
                    value: point.asleepMinutes,
                    label: point.label,
                    dataPointText: String(point.asleepMinutes),
                  }))}
                  color={chart1}
                  dataPointsColor={chart1}
                  xAxisColor={muted}
                  yAxisColor={muted}
                  rulesColor={muted}
                  height={160}
                  spacing={Math.max(14, 260 / Math.max(1, series.length))}
                  initialSpacing={8}
                  thickness={2}
                  hideRules={false}
                  noOfSections={4}
                  maxValue={Math.ceil(maxAsleep / 60) * 60}
                  yAxisTextStyle={{ color: foreground, fontSize: 10 }}
                  xAxisLabelTextStyle={{ color: foreground, fontSize: 9 }}
                  roundToDigits={0}
                />
                <Text className="mt-2 text-xs text-muted-foreground">Y-axis: minutes of sleep</Text>
              </Card>
            </CardStack>

            <CardStack title="This week">
              <Card variant="secondary" className="p-4">
                <View className="flex-row gap-4">
                  <Stat
                    label="7-day average"
                    value={formatSleepDuration(summary.data.sevenDayAverageMinutes)}
                  />
                  <Stat
                    label="Avg debt"
                    value={formatSleepDuration(summary.data.averageSleepDebtMinutes)}
                  />
                  <Stat label="Target" value={formatSleepDuration(last.targetMinutes)} />
                </View>
              </Card>
            </CardStack>
          </>
        )}
      </View>
    </Container>
  );
}
