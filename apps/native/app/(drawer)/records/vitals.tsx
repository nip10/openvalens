import {
  defaultObservedAt,
  MANUAL_ENTRY_FIELDS,
  makeManualEntryHash,
  parseManualEntryValue,
  type ManualEntryMetric,
} from "@openvalens/api/presenters/manual-entry";
import {
  formatBpm,
  formatMs,
  formatBpmRange,
  heartRateSeries,
  summarizeVitals,
  vitalsSourceLabel,
} from "@openvalens/api/presenters/vitals";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Spinner } from "heroui-native";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { LineChart } from "@/components/chart";
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

const MANUAL_METRICS: ManualEntryMetric[] = ["heart_rate", "resting_heart_rate"];

function AddReadingForm({ onSaved }: { onSaved: () => void }) {
  const [metric, setMetric] = useState<ManualEntryMetric>("heart_rate");
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
      <Card variant="secondary" className="gap-4 p-4">
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

export default function VitalsScreen() {
  const queryClient = useQueryClient();
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const chart1 = useThemeColor("chart-1");

  const daily = useCacheFirst(
    "vitals.daily",
    orpc.vitals.daily.queryOptions({ input: { days: TREND_WINDOW_DAYS } }),
  );
  const { t, i18n } = useLingui();
  const windowDays = TREND_WINDOW_DAYS;
  const samples = useCacheFirst(
    "vitals.recentSamples",
    orpc.vitals.recentSamples.queryOptions({ input: { limit: 20 } }),
  );

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
        <SyncStatusBadge />
        <Text className="text-base text-foreground">{t`Could not load vitals.`}</Text>
        <Pressable
          onPress={() => {
            void daily.refetch();
            void samples.refetch();
          }}
          className="min-h-11 justify-center px-4"
          accessibilityRole="button"
        >
          <Text className="font-medium text-foreground underline">{t`Retry`}</Text>
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
        <View className="flex-row items-start justify-between gap-3">
          <View>
            <Text className="text-sm text-muted-foreground">{t`Vitals`}</Text>
            <Text className="font-mono text-3xl text-foreground">{t`Last 30 days`}</Text>
          </View>
          <SyncStatusBadge />
        </View>

        <AddReadingForm
          onSaved={() => {
            void daily.refetch();
            void samples.refetch();
            void queryClient.invalidateQueries({ queryKey: orpc.vitals.key() });
          }}
        />

        {!summary.today ? (
          <Card variant="secondary" className="items-center gap-1 p-8">
            <Text className="font-medium text-foreground">{t`No vitals yet`}</Text>
            <Text className="text-center text-sm text-muted-foreground">
              {t`Sync Health Connect or Apple Health from the mobile app, or add a reading.`}
            </Text>
          </Card>
        ) : (
          <>
            <CardStack>
              <Card variant="secondary" className="gap-2 p-4">
                <View className="flex-row items-center justify-between">
                  <Text className="text-lg font-medium text-foreground">{t`Today`}</Text>
                  <Text className="text-sm text-muted-foreground">{summary.today.date}</Text>
                </View>
                <View className="flex-row gap-4">
                  <Stat label={t`Avg`} value={formatBpm(summary.today.heartRate.avgBpm)} />
                  <Stat
                    label={t`Range`}
                    value={formatBpmRange(
                      summary.today.heartRate.avgBpm,
                      summary.today.heartRate.minBpm,
                      summary.today.heartRate.maxBpm,
                    )}
                  />
                  <Stat label={t`Samples`} value={summary.today.heartRate.sampleCount.toString()} />
                </View>
              </Card>
            </CardStack>

            <CardStack title={t`Last ${windowDays} days`}>
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
                <Text className="mt-2 text-xs text-muted-foreground">{t`Y-axis: avg bpm`}</Text>
              </Card>
            </CardStack>

            <CardStack title={t`This week`}>
              <Card variant="secondary" className="p-4">
                <View className="flex-row gap-4">
                  <Stat label={t`7-day avg`} value={formatBpm(summary.sevenDayAverageBpm)} />
                  <Stat
                    label={t`Latest`}
                    value={formatBpm(summary.latestSample?.heartRateBpm ?? null)}
                  />
                  <Stat
                    label={t`Source`}
                    value={vitalsSourceLabel(summary.latestSample?.source ?? null, i18n)}
                  />
                </View>
                {summary.latestHrv ? (
                  <View className="mt-4 flex-row gap-4">
                    <Stat
                      label={t`Overnight HRV · ${summary.latestHrv.date}`}
                      value={formatMs(summary.latestHrv.avgMs)}
                    />
                  </View>
                ) : null}
              </Card>
            </CardStack>

            <CardStack title={t`Recent samples`}>
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
                        {vitalsSourceLabel(sample.source, i18n)}
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
