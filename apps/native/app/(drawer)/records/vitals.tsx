import {
  formatBpm,
  formatBpmRange,
  heartRateSeries,
  summarizeVitals,
  vitalsSourceLabel,
} from "@openhealth/api/presenters/vitals";
import { useQuery } from "@tanstack/react-query";
import { Card, Spinner } from "heroui-native";
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

export default function VitalsScreen() {
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const chart1 = useThemeColor("chart-1");

  const daily = useQuery(orpc.vitals.daily.queryOptions({ input: { days: TREND_WINDOW_DAYS } }));
  const samples = useQuery(orpc.vitals.recentSamples.queryOptions({ input: { limit: 20 } }));

  const summary = useMemo(
    () => (daily.data && samples.data ? summarizeVitals(daily.data, samples.data) : null),
    [daily.data, samples.data],
  );

  if (daily.isPending || samples.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );

  if (daily.isError || !daily.data || samples.isError || !summary)
    return (
      <Container className="items-center justify-center gap-3 p-6" isScrollable={false}>
        <Text className="text-base text-foreground">Could not load vitals.</Text>
        <Pressable
          onPress={() => {
            void daily.refetch();
            void samples.refetch();
          }}
          className="min-h-11 justify-center px-4"
          accessibilityRole="button"
        >
          <Text className="font-medium text-foreground underline">Retry</Text>
        </Pressable>
      </Container>
    );

  const series = heartRateSeries(summary.days);
  const maxBpm = Math.max(80, ...series.filter((p) => p.avgBpm !== null).map((p) => p.avgBpm ?? 0));

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={daily.isRefetching || samples.isRefetching}
            onRefresh={() => {
              void daily.refetch();
              void samples.refetch();
            }}
            tintColor={foreground}
          />
        ),
      }}
    >
      <View className="gap-6 p-4">
        <View>
          <Text className="text-sm text-muted-foreground">Vitals</Text>
          <Text className="font-mono text-3xl text-foreground">Last 30 days</Text>
        </View>

        {!summary.today ? (
          <Card variant="secondary" className="items-center gap-1 p-8">
            <Text className="font-medium text-foreground">No vitals yet</Text>
            <Text className="text-center text-sm text-muted-foreground">
              Sync Health Connect or Apple Health from the mobile app, or add a reading.
            </Text>
          </Card>
        ) : (
          <>
            <CardStack>
              <Card variant="secondary" className="gap-2 p-4">
                <View className="flex-row items-center justify-between">
                  <Text className="text-lg font-medium text-foreground">Today</Text>
                  <Text className="text-sm text-muted-foreground">{summary.today.date}</Text>
                </View>
                <View className="flex-row gap-4">
                  <Stat label="Avg" value={formatBpm(summary.today.heartRate.avgBpm)} />
                  <Stat
                    label="Range"
                    value={formatBpmRange(
                      summary.today.heartRate.avgBpm,
                      summary.today.heartRate.minBpm,
                      summary.today.heartRate.maxBpm,
                    )}
                  />
                  <Stat label="Samples" value={summary.today.heartRate.sampleCount.toString()} />
                </View>
              </Card>
            </CardStack>

            <CardStack title={`Last ${TREND_WINDOW_DAYS} days`}>
              <Card variant="secondary" className="p-4">
                <LineChart
                  data={series.map((point) => ({
                    value: point.avgBpm ?? 0,
                    label: point.label,
                    dataPointText: point.avgBpm !== null ? String(Math.round(point.avgBpm)) : "",
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
                  maxValue={Math.ceil(maxBpm + 5)}
                  yAxisTextStyle={{ color: foreground, fontSize: 10 }}
                  xAxisLabelTextStyle={{ color: foreground, fontSize: 9 }}
                  roundToDigits={0}
                />
                <Text className="mt-2 text-xs text-muted-foreground">Y-axis: avg bpm</Text>
              </Card>
            </CardStack>

            <CardStack title="This week">
              <Card variant="secondary" className="p-4">
                <View className="flex-row gap-4">
                  <Stat label="7-day avg" value={formatBpm(summary.sevenDayAverageBpm)} />
                  <Stat
                    label="Latest"
                    value={formatBpm(summary.latestSample?.heartRateBpm ?? null)}
                  />
                  <Stat
                    label="Source"
                    value={vitalsSourceLabel(summary.latestSample?.source ?? null)}
                  />
                </View>
              </Card>
            </CardStack>

            <CardStack title="Recent samples">
              <Card variant="secondary" className="p-0">
                {(samples.data ?? []).map((sample, index, arr) => (
                  <View
                    key={sample.sampledAt}
                    className={`flex-row items-center justify-between px-4 py-3 ${
                      index < arr.length - 1 ? "border-b border-border" : ""
                    }`}
                  >
                    <Text className="font-mono text-sm text-muted-foreground">
                      {new Date(sample.sampledAt).toISOString().slice(0, 16).replace("T", " ")}
                    </Text>
                    <View className="flex-row items-center gap-3">
                      <Text className="font-mono text-sm text-foreground">
                        {formatBpm(sample.heartRateBpm)}
                      </Text>
                      <Text className="text-xs text-muted-foreground">
                        {vitalsSourceLabel(sample.source)}
                      </Text>
                    </View>
                  </View>
                ))}
              </Card>
            </CardStack>
          </>
        )}
      </View>
    </Container>
  );
}
