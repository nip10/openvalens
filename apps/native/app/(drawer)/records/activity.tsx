import {
  formatDistanceMeters,
  formatKcalories,
  formatSteps,
  stepsSeries,
  summarizeDailyActivity,
} from "@openhealth/api/presenters/activity";
import { useQuery } from "@tanstack/react-query";
import { Card, Spinner } from "heroui-native";
import { useMemo } from "react";
import { Pressable, RefreshControl, Text, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { BarChart } from "@/components/chart";
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

export default function ActivityScreen() {
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const chart1 = useThemeColor("chart-1");

  const totals = useQuery(
    orpc.activity.dailyTotals.queryOptions({ input: { days: TREND_WINDOW_DAYS } }),
  );

  const summary = useMemo(
    () => (totals.data ? summarizeDailyActivity(totals.data) : null),
    [totals.data],
  );
  const series = useMemo(() => (summary ? stepsSeries(summary.days) : []), [summary]);

  if (totals.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );

  if (totals.isError || !summary)
    return (
      <Container className="items-center justify-center gap-3 p-6" isScrollable={false}>
        <Text className="text-base text-foreground">Could not load activity.</Text>
        <Pressable
          onPress={() => void totals.refetch()}
          className="min-h-11 justify-center px-4"
          accessibilityRole="button"
        >
          <Text className="font-medium text-foreground underline">Retry</Text>
        </Pressable>
      </Container>
    );

  const today = summary.today;
  const maxSteps = Math.max(1000, ...series.map((p) => p.steps));
  const recent = [...summary.days].reverse().slice(0, 14);

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={totals.isRefetching}
            onRefresh={() => void totals.refetch()}
            tintColor={foreground}
          />
        ),
      }}
    >
      <View className="gap-6 p-4">
        <View>
          <Text className="text-sm text-muted-foreground">Activity</Text>
          <Text className="font-mono text-3xl text-foreground">Last 30 days</Text>
        </View>

        {!today ? (
          <Card variant="secondary" className="items-center gap-1 p-8">
            <Text className="font-medium text-foreground">No activity yet</Text>
            <Text className="text-center text-sm text-muted-foreground">
              Sync Health Connect or Apple Health from the mobile app, or add an entry.
            </Text>
          </Card>
        ) : (
          <>
            <CardStack>
              <Card variant="secondary" className="gap-2 p-4">
                <View className="flex-row items-center justify-between">
                  <Text className="text-lg font-medium text-foreground">Today</Text>
                  <Text className="text-sm text-muted-foreground">{today.date}</Text>
                </View>
                <View className="flex-row gap-4">
                  <Stat label="Steps" value={formatSteps(today.steps)} />
                  <Stat label="Calories" value={formatKcalories(today.activeCaloriesKcal)} />
                  <Stat label="Distance" value={formatDistanceMeters(today.distanceMeters)} />
                </View>
              </Card>
            </CardStack>

            <CardStack title={`Last ${TREND_WINDOW_DAYS} days`}>
              <Card variant="secondary" className="p-4">
                <BarChart
                  data={series.map((point) => ({
                    value: point.steps,
                    label: point.label,
                    frontColor: chart1,
                  }))}
                  barWidth={Math.max(6, Math.min(14, 280 / Math.max(1, series.length)))}
                  spacing={Math.max(4, 280 / Math.max(1, series.length))}
                  initialSpacing={4}
                  xAxisColor={muted}
                  yAxisColor={muted}
                  rulesColor={muted}
                  hideRules
                  height={160}
                  yAxisTextStyle={{ color: foreground, fontSize: 10 }}
                  xAxisLabelTextStyle={{ color: foreground, fontSize: 9 }}
                  noOfSections={4}
                  maxValue={Math.ceil(maxSteps / 1000) * 1000}
                  yAxisLabelSuffix=""
                />
                <Text className="mt-2 text-xs text-muted-foreground">Bars: steps per day</Text>
              </Card>
            </CardStack>

            <CardStack title="This week">
              <Card variant="secondary" className="p-4">
                <View className="flex-row gap-4">
                  <Stat
                    label="Steps / active day"
                    value={formatSteps(summary.sevenDayAverageSteps)}
                  />
                  <Stat
                    label="Calories / day"
                    value={formatKcalories(summary.sevenDayAverageCalories)}
                  />
                  <Stat
                    label="Distance / day"
                    value={formatDistanceMeters(summary.sevenDayAverageDistance)}
                  />
                </View>
              </Card>
            </CardStack>

            <CardStack title="Recent">
              <Card variant="secondary" className="p-0">
                {recent.map((day, index) => (
                  <View
                    key={day.date}
                    className={`flex-row items-center justify-between px-4 py-3 ${
                      index < recent.length - 1 ? "border-b border-border" : ""
                    }`}
                  >
                    <Text className="font-mono text-sm text-muted-foreground">{day.date}</Text>
                    <View className="flex-row items-center gap-4">
                      <Text className="font-mono text-sm text-foreground">
                        {formatSteps(day.steps)} steps
                      </Text>
                      <Text className="font-mono text-xs text-muted-foreground">
                        {formatKcalories(day.activeCaloriesKcal)}
                      </Text>
                      <Text className="font-mono text-xs text-muted-foreground">
                        {formatDistanceMeters(day.distanceMeters)}
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
