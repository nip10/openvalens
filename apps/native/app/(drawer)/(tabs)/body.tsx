import { Ionicons } from "@expo/vector-icons";
import { useLingui } from "@lingui/react/macro";
import {
  formatKg,
  formatKgDelta,
  summarizeDailyWeights,
  weightSourceLabel,
} from "@openvalens/api/presenters/body";
import {
  defaultObservedAt,
  MANUAL_ENTRY_FIELDS,
  makeManualEntryHash,
  parseManualEntryValue,
} from "@openvalens/api/presenters/manual-entry";
import { useMutation } from "@tanstack/react-query";
import { Button, Card, Spinner } from "heroui-native";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { useState } from "react";

import { CardStack, ListRow } from "@/components/list-row";
import { Container } from "@/components/container";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { LineChart } from "@/components/chart";
import { enqueueMetricSample, useCacheFirst } from "@/lib/offline/sync";
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

function AddWeightForm({ onSaved }: { onSaved: () => void }) {
  const field = MANUAL_ENTRY_FIELDS.weight;
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
      metricCode: "weight",
      observedAt,
      valueNumeric: numeric,
      dedupeHash: makeManualEntryHash("weight", observedAt, numeric),
    });
  };

  return (
    <CardStack title={t`Add weight`}>
      <Card variant="secondary" className="gap-3 p-4">
        <View className="flex-row gap-3">
          <View className="flex-1 gap-2">
            <Text className="text-sm font-medium text-foreground">{t`Weight (${unit})`}</Text>
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

export default function BodyScreen() {
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const chart1 = useThemeColor("chart-1");
  const { t } = useLingui();

  const daily = useCacheFirst(
    "body.dailyWeights",
    orpc.body.dailyWeights.queryOptions({ input: { limit: SERIES_DAYS } }),
  );
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
        <Text className="text-base text-foreground">{t`Could not load weight.`}</Text>
        <Pressable
          onPress={() => void daily.refetch()}
          className="min-h-11 justify-center px-4"
          accessibilityRole="button"
        >
          <Text className="font-medium text-foreground underline">{t`Retry`}</Text>
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
          <View className="flex-row items-start justify-between gap-3">
            <View>
              <Text className="text-sm text-muted-foreground">{t`Today`}</Text>
              <Text className="font-mono text-3xl text-foreground">{t`Body`}</Text>
            </View>
            <SyncStatusBadge />
          </View>
          <Card variant="secondary" className="items-center gap-1 p-8">
            <Text className="font-medium text-foreground">{t`No weight yet`}</Text>
            <Text className="text-center text-sm text-muted-foreground">
              {t`Sync a scale through Health Connect or Apple Health, or add a weight.`}
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
        <View className="flex-row items-start justify-between gap-3">
          <View>
            <Text className="text-sm text-muted-foreground">{t`Body`}</Text>
            <Text className="font-mono text-3xl text-foreground">{t`Weight`}</Text>
          </View>
          <SyncStatusBadge />
        </View>

        <AddWeightForm onSaved={() => void daily.refetch()} />

        <CardStack>
          <Card variant="secondary" className="p-4">
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-lg font-medium text-foreground">{t`Latest`}</Text>
              <Text className="text-sm text-muted-foreground">{summary.latest.date}</Text>
            </View>
            <View className="flex-row gap-4">
              <Stat label={t`Weight`} value={formatKg(summary.latest.weightKg)} />
              <Stat
                label={t`7 days`}
                value={summary.change7d === null ? "—" : formatKgDelta(summary.change7d)}
              />
              <Stat
                label={t`30 days`}
                value={summary.change30d === null ? "—" : formatKgDelta(summary.change30d)}
              />
            </View>
          </Card>
        </CardStack>

        <CardStack>
          <Card variant="secondary" className="p-4">
            <Text className="mb-3 text-lg font-medium text-foreground">{t`Last 90 days`}</Text>
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

        <CardStack title={t`Recent`}>
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
