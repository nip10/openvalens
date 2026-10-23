import { useLingui } from "@lingui/react/macro";
import {
  formatDistanceMeters,
  formatKcalories,
  formatSteps,
  stepsSeries,
  summarizeDailyActivity,
} from "@openvalens/api/presenters/activity";
import {
  defaultObservedAt,
  MANUAL_ENTRY_FIELDS,
  makeManualEntryHash,
  parseManualEntryValue,
  type ManualEntryMetric,
} from "@openvalens/api/presenters/manual-entry";
import { useMutation } from "@tanstack/react-query";
import { Button, Card, Spinner } from "heroui-native";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { BarChart } from "@/components/chart";
import { enqueueMetricSample, useCacheFirst } from "@/lib/offline/sync";
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

const MANUAL_METRICS: ManualEntryMetric[] = ["steps", "active_calories", "distance"];

function AddReadingForm({ onSaved }: { onSaved: () => void }) {
  const [metric, setMetric] = useState<ManualEntryMetric>("steps");
  const field = MANUAL_ENTRY_FIELDS[metric];
  const { t, i18n } = useLingui();
  const unit = i18n._(field.unit);
  const [value, setValue] = useState("");
  const [observedAt, setObservedAt] = useState(defaultObservedAt());

  const save = useMutation(
    orpc.healthRecord.ingestMetricSample.mutationOptions({
      onSuccess: () => {
        setValue("");
        setObservedAt(defaultObservedAt());
        onSaved();
      },
      onError: (error, variables) => enqueueMetricSample(variables, error),
    }),
  );

  const numeric = parseManualEntryValue(field, value);
  const submit = () => {
    if (numeric === null) return;
    save.mutate({
      metricCode: metric,
      observedAt,
      valueNumeric: numeric,
      dedupeHash: makeManualEntryHash(metric, observedAt, numeric),
    });
  };

  return (
    <CardStack title={t`Add reading`}>
      <Card variant="secondary" className="gap-3 p-4">
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">{t`Metric`}</Text>
          <View className="flex-row flex-wrap gap-2">
            {MANUAL_METRICS.map((code) => {
              const selected = code === metric;
              return (
                <Pressable
                  key={code}
                  onPress={() => setMetric(code)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  className={`rounded-full border px-3 py-1.5 active:opacity-70 ${
                    selected ? "border-primary bg-primary/15" : "border-border bg-card"
                  }`}
                >
                  <Text
                    className={`text-sm ${
                      selected ? "font-medium text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {i18n._(MANUAL_ENTRY_FIELDS[code].label)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View className="flex-row gap-3">
          <View className="flex-1 gap-2">
            <Text className="text-sm font-medium text-foreground">{t`Value (${unit})`}</Text>
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder={`${field.min}–${field.max}`}
              keyboardType="numeric"
              className="min-h-11 rounded-lg border border-border bg-card px-3 text-base text-foreground"
              placeholderTextColor="#9ca3af"
            />
          </View>
          <View className="flex-1 gap-2">
            <Text className="text-sm font-medium text-foreground">{t`Observed at`}</Text>
            <TextInput
              value={observedAt}
              onChangeText={setObservedAt}
              placeholder="YYYY-MM-DDTHH:MM"
              className="min-h-11 rounded-lg border border-border bg-card px-3 text-base text-foreground"
              placeholderTextColor="#9ca3af"
            />
          </View>
        </View>
        <View className="flex-row items-center gap-3">
          <Button onPress={submit} isDisabled={numeric === null || save.isPending}>
            {save.isPending ? t`Saving…` : t`Save`}
          </Button>
          {numeric === null && value.length > 0 ? (
            <Text className="text-sm text-destructive">
              {field.min}–{field.max} {unit}
            </Text>
          ) : save.isSuccess ? (
            <Text className="text-sm text-success">{t`Saved`}</Text>
          ) : save.isError ? (
            <Text className="text-sm text-destructive">{t`Could not save.`}</Text>
          ) : null}
        </View>
      </Card>
    </CardStack>
  );
}

export default function ActivityScreen() {
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const chart1 = useThemeColor("chart-1");
  const { t } = useLingui();
  const windowDays = TREND_WINDOW_DAYS;

  const totals = useCacheFirst(
    "activity.dailyTotals",
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
        <SyncStatusBadge />
        <Text className="text-base text-foreground">{t`Could not load activity.`}</Text>
        <Pressable
          onPress={() => void totals.refetch()}
          className="min-h-11 justify-center px-4"
          accessibilityRole="button"
        >
          <Text className="font-medium text-foreground underline">{t`Retry`}</Text>
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
        <View className="flex-row items-start justify-between gap-3">
          <View>
            <Text className="text-sm text-muted-foreground">{t`Activity`}</Text>
            <Text className="font-mono text-3xl text-foreground">{t`Last 30 days`}</Text>
          </View>
          <SyncStatusBadge />
        </View>

        <AddReadingForm onSaved={() => void totals.refetch()} />

        {!today ? (
          <Card variant="secondary" className="items-center gap-1 p-8">
            <Text className="font-medium text-foreground">{t`No activity yet`}</Text>
            <Text className="text-center text-sm text-muted-foreground">
              {t`Sync Health Connect or Apple Health from the mobile app, or add an entry.`}
            </Text>
          </Card>
        ) : (
          <>
            <CardStack>
              <Card variant="secondary" className="gap-2 p-4">
                <View className="flex-row items-center justify-between">
                  <Text className="text-lg font-medium text-foreground">{t`Today`}</Text>
                  <Text className="text-sm text-muted-foreground">{today.date}</Text>
                </View>
                <View className="flex-row gap-4">
                  <Stat label={t`Steps`} value={formatSteps(today.steps)} />
                  <Stat label={t`Calories`} value={formatKcalories(today.activeCaloriesKcal)} />
                  <Stat label={t`Distance`} value={formatDistanceMeters(today.distanceMeters)} />
                </View>
              </Card>
            </CardStack>

            <CardStack title={t`Last ${windowDays} days`}>
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
                <Text className="mt-2 text-xs text-muted-foreground">{t`Bars: steps per day`}</Text>
              </Card>
            </CardStack>

            <CardStack title={t`This week`}>
              <Card variant="secondary" className="p-4">
                <View className="flex-row gap-4">
                  <Stat
                    label={t`Steps / active day`}
                    value={formatSteps(summary.sevenDayAverageSteps)}
                  />
                  <Stat
                    label={t`Calories / day`}
                    value={formatKcalories(summary.sevenDayAverageCalories)}
                  />
                  <Stat
                    label={t`Distance / day`}
                    value={formatDistanceMeters(summary.sevenDayAverageDistance)}
                  />
                </View>
              </Card>
            </CardStack>

            <CardStack title={t`Recent`}>
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
                        {t({ message: `${formatSteps(day.steps)} steps`, comment: "safety" })}
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
