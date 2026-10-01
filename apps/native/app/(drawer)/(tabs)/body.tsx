import { Ionicons } from "@expo/vector-icons";
import {
  formatKg,
  formatKgDelta,
  summarizeDailyWeights,
  weightSourceLabel,
} from "@openhealth/api/presenters/body";
import { useQuery } from "@tanstack/react-query";
import { Card, Spinner } from "heroui-native";
import { Pressable, RefreshControl, Text, View } from "react-native";

import { CardStack, ListRow } from "@/components/list-row";
import { Container } from "@/components/container";
import { LineChart } from "@/components/chart";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

const SERIES_DAYS = 90;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 gap-1">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="font-mono text-lg text-foreground">{value}</Text>
    </View>
  );
}

export default function BodyScreen() {
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const chart1 = useThemeColor("chart-1");

  const daily = useQuery(orpc.body.dailyWeights.queryOptions({ input: { limit: SERIES_DAYS } }));
  const summary = summarizeDailyWeights(daily.data ?? []);

  if (daily.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );

  if (daily.isError)
    return (
      <Container className="items-center justify-center gap-3 p-6" isScrollable={false}>
        <Text className="text-base text-foreground">Could not load weight.</Text>
        <Pressable
          onPress={() => void daily.refetch()}
          className="min-h-11 justify-center px-4"
          accessibilityRole="button"
        >
          <Text className="font-medium text-foreground underline">Retry</Text>
        </Pressable>
      </Container>
    );

  if (!summary.latest)
    return (
      <Container
        scrollViewProps={{
          refreshControl: (
            <RefreshControl
              refreshing={daily.isRefetching}
              onRefresh={() => void daily.refetch()}
              tintColor={foreground}
            />
          ),
        }}
      >
        <View className="gap-6 p-4">
          <View>
            <Text className="text-sm text-muted-foreground">Today</Text>
            <Text className="font-mono text-3xl text-foreground">Body</Text>
          </View>
          <Card variant="secondary" className="items-center gap-1 p-8">
            <Text className="font-medium text-foreground">No weight yet</Text>
            <Text className="text-center text-sm text-muted-foreground">
              Sync a scale through Health Connect or Apple Health, or add a weight.
            </Text>
          </Card>
        </View>
      </Container>
    );

  const series = summary.series.map((point) => ({
    value: point.weightKg,
    label: point.date.slice(5),
    dataPointText: point.weightKg.toFixed(1),
  }));

  const recent = [...summary.series].reverse().slice(0, 14);

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={daily.isRefetching}
            onRefresh={() => void daily.refetch()}
            tintColor={foreground}
          />
        ),
      }}
    >
      <View className="gap-6 p-4">
        <View>
          <Text className="text-sm text-muted-foreground">Body</Text>
          <Text className="font-mono text-3xl text-foreground">Weight</Text>
        </View>

        <CardStack>
          <Card variant="secondary" className="p-4">
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-lg font-medium text-foreground">Latest</Text>
              <Text className="text-sm text-muted-foreground">{summary.latest.date}</Text>
            </View>
            <View className="flex-row gap-4">
              <Stat label="Weight" value={formatKg(summary.latest.weightKg)} />
              <Stat
                label="7 days"
                value={summary.change7d === null ? "—" : formatKgDelta(summary.change7d)}
              />
              <Stat
                label="30 days"
                value={summary.change30d === null ? "—" : formatKgDelta(summary.change30d)}
              />
            </View>
          </Card>
        </CardStack>

        <CardStack>
          <Card variant="secondary" className="p-4">
            <Text className="mb-3 text-lg font-medium text-foreground">Last 90 days</Text>
            <LineChart
              data={series}
              color={chart1}
              dataPointsColor={chart1}
              xAxisColor={muted}
              yAxisColor={muted}
              rulesColor={muted}
              height={180}
              spacing={Math.max(20, 280 / Math.max(1, series.length))}
              initialSpacing={8}
              thickness={2}
              hideRules={false}
              yAxisLabelSuffix=" kg"
              yAxisTextStyle={{ color: foreground }}
              xAxisLabelTextStyle={{ color: foreground, fontSize: 10 }}
              noOfSections={4}
              maxValue={Math.ceil(Math.max(...series.map((s) => s.value)) + 1)}
            />
          </Card>
        </CardStack>

        <CardStack title="Recent">
          <Card variant="secondary" className="overflow-hidden p-0">
            {recent.map((point, index) => {
              const source = daily.data?.find((row) => row.date === point.date)?.source ?? "";
              return (
                <ListRow
                  key={point.date}
                  icon={<Ionicons name="barbell-outline" size={20} color={foreground} />}
                  title={point.date}
                  subtitle={weightSourceLabel(source)}
                  trailing={
                    <Text className="font-mono text-base text-foreground">
                      {formatKg(point.weightKg)}
                    </Text>
                  }
                  showDivider={index < recent.length - 1}
                />
              );
            })}
          </Card>
        </CardStack>
      </View>
    </Container>
  );
}
