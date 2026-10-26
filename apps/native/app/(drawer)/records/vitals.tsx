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
import { Button } from "heroui-native";
import { Activity, HeartPulse, Plus, Waves } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";

import {
  Details,
  EmptyState,
  ErrorState,
  Figure,
  Page,
  PageHeader,
  Section,
  Sheet,
  StatTile,
  TileRow,
  ToneChip,
} from "@/components/bloom";
import { TrendChart } from "@/components/chart";
import { Container } from "@/components/container";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { enqueueMetricSample, useCacheFirst } from "@/lib/offline/sync";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

const TREND_WINDOW_DAYS = 30;

const INPUT_CLASS =
  "min-h-11 rounded-xl border border-rule-2 bg-paper-2 px-3 font-sans text-base text-ink";

const MANUAL_METRICS: ManualEntryMetric[] = ["heart_rate", "resting_heart_rate"];

function AddReadingForm({ onSaved }: { onSaved: () => void }) {
  const [metric, setMetric] = useState<ManualEntryMetric>("heart_rate");
  const field = MANUAL_ENTRY_FIELDS[metric];
  const { t, i18n } = useLingui();
  const placeholderColor = useThemeColor("ink-3");
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
    <Section icon={Plus} tone="heart" title={t`Add reading`}>
      <Sheet className="gap-4">
        <View className="gap-2">
          <Text className="font-sans text-sm text-ink-3">{t`Metric`}</Text>
          <View className="flex-row flex-wrap gap-2">
            {MANUAL_METRICS.map((code) => {
              const selected = code === metric;
              return (
                <Pressable
                  key={code}
                  onPress={() => setMetric(code)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  className={`min-h-9 justify-center rounded-full border px-3.5 active:opacity-70 ${
                    selected ? "border-heart bg-heart-soft" : "border-rule-2 bg-paper-2"
                  }`}
                >
                  <Text
                    className={`font-sans text-sm ${
                      selected ? "font-semibold text-ink" : "text-ink-2"
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
            <Text className="font-sans text-sm text-ink-3">{t`Value (${unit})`}</Text>
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder={`${field.min}–${field.max}`}
              keyboardType="numeric"
              className={INPUT_CLASS}
              placeholderTextColor={placeholderColor}
            />
          </View>
          <View className="flex-1 gap-2">
            <Text className="font-sans text-sm text-ink-3">{t`Observed at`}</Text>
            <TextInput
              value={observedAt}
              onChangeText={setObservedAt}
              placeholder="YYYY-MM-DDTHH:MM"
              className={INPUT_CLASS}
              placeholderTextColor={placeholderColor}
            />
          </View>
        </View>
        <View className="flex-row flex-wrap items-center gap-3">
          <Button onPress={submit} isDisabled={numeric === null || save.isPending}>
            <Button.Label>{save.isPending ? t`Saving…` : t`Save`}</Button.Label>
          </Button>
          {numeric === null && value.length > 0 ? (
            <Text className="font-sans text-sm text-destructive">
              {field.min}–{field.max} {unit}
            </Text>
          ) : save.isSuccess ? (
            <Text className="font-sans text-sm text-success">{t`Saved`}</Text>
          ) : save.isError ? (
            <Text className="font-sans text-sm text-destructive">{t`Could not save.`}</Text>
          ) : null}
        </View>
      </Sheet>
    </Section>
  );
}

export default function VitalsScreen() {
  const queryClient = useQueryClient();
  const foreground = useThemeColor("foreground");
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

  const header = <PageHeader title={t`Vitals`} actions={<SyncStatusBadge />} />;

  if (daily.isPending || samples.isPending)
    return (
      <Container>
        <Page>
          {header}
          <TileRow>
            <Sheet className="h-36" />
            <Sheet className="h-36" />
          </TileRow>
          <Sheet className="h-56" />
        </Page>
      </Container>
    );

  if (daily.isError || !daily.data || samples.isError || !summary)
    return (
      <Container>
        <Page>
          {header}
          <ErrorState
            title={t`Could not load vitals.`}
            action={
              <Button
                variant="outline"
                size="sm"
                onPress={() => {
                  void daily.refetch();
                  void samples.refetch();
                }}
              >
                <Button.Label>{t`Retry`}</Button.Label>
              </Button>
            }
          />
        </Page>
      </Container>
    );

  const today = summary.today;
  const series = heartRateSeries(summary.days).filter(
    (p): p is typeof p & { avgBpm: number } => p.avgBpm !== null,
  );
  const bpms = series.map((p) => p.avgBpm);
  const minBpm = bpms.length ? Math.floor(Math.min(...bpms) - 5) : 40;
  const maxBpm = Math.ceil(Math.max(80, ...bpms) + 5);

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
      <Page>
        {header}

        {!today ? (
          <EmptyState
            icon={HeartPulse}
            tone="heart"
            title={t`No vitals yet`}
            description={t`Sync Health Connect or Apple Health from the mobile app, or add a reading.`}
          />
        ) : (
          <>
            <View className="gap-3" accessibilityLabel={t`Today`}>
              <TileRow>
                <StatTile
                  icon={HeartPulse}
                  tone="heart"
                  label={t`Avg heart rate`}
                  value={formatBpm(today.heartRate.avgBpm)}
                  note={t`Your usual: ${formatBpm(summary.sevenDayAverageBpm)}`}
                />
                <StatTile
                  icon={Activity}
                  tone="heart"
                  label={i18n._(MANUAL_ENTRY_FIELDS.resting_heart_rate.label)}
                  value={formatBpm(today.restingHeartRate.avgBpm)}
                />
              </TileRow>
              {summary.latestHrv ? (
                <TileRow>
                  <StatTile
                    icon={Waves}
                    tone="heart"
                    label={t`Overnight HRV`}
                    value={formatMs(summary.latestHrv.avgMs)}
                    note={friendlyDate(i18n, summary.latestHrv.date)}
                  />
                  <View />
                </TileRow>
              ) : null}
            </View>

            {series.length > 0 ? (
              <Section
                icon={HeartPulse}
                tone="heart"
                title={t`Last ${windowDays} days`}
                info={t`Y-axis: avg bpm`}
              >
                <Sheet>
                  <TrendChart
                    tone="heart"
                    data={series.map((point) => ({
                      value: point.avgBpm,
                      label: friendlyDate(i18n, point.date),
                    }))}
                    minValue={Math.max(0, minBpm)}
                    maxValue={maxBpm}
                    formatYLabel={(label) => String(Math.round(Number(label)))}
                    height={170}
                  />
                </Sheet>
              </Section>
            ) : null}
          </>
        )}

        <AddReadingForm
          onSaved={() => {
            void daily.refetch();
            void samples.refetch();
            void queryClient.invalidateQueries({ queryKey: orpc.vitals.key() });
          }}
        />

        {today ? (
          <Details summary={t`Recent samples`}>
            <View className="gap-3">
              <Sheet className="gap-3 p-4">
                <Text className="font-display text-base font-medium text-ink">{t`Today`}</Text>
                <View className="flex-row">
                  <Figure
                    className="flex-1 pr-2"
                    label={t`Avg`}
                    value={formatBpm(today.heartRate.avgBpm)}
                  />
                  <Figure
                    className="flex-1 border-l border-rule px-2"
                    label={t`Range`}
                    value={formatBpmRange(
                      today.heartRate.avgBpm,
                      today.heartRate.minBpm,
                      today.heartRate.maxBpm,
                    )}
                  />
                  <Figure
                    className="flex-1 border-l border-rule pl-2"
                    label={t`Samples`}
                    value={today.heartRate.sampleCount.toString()}
                  />
                </View>
              </Sheet>
              <Sheet className="gap-3 p-4">
                <Text className="font-display text-base font-medium text-ink">{t`This week`}</Text>
                <View className="flex-row">
                  <Figure
                    className="flex-1 pr-2"
                    label={t`7-day avg`}
                    value={formatBpm(summary.sevenDayAverageBpm)}
                  />
                  <Figure
                    className="flex-1 border-l border-rule px-2"
                    label={t`Latest`}
                    value={formatBpm(summary.latestSample?.heartRateBpm ?? null)}
                  />
                  <Figure
                    className="flex-1 border-l border-rule pl-2"
                    label={t`Source`}
                    value={vitalsSourceLabel(summary.latestSample?.source ?? null, i18n)}
                  />
                </View>
              </Sheet>
              <Sheet className="p-0">
                {(samples.data ?? []).map((sample, index, arr) => (
                  <View
                    key={sample.sampledAt}
                    className={`flex-row items-center justify-between gap-3 px-4 py-3 ${
                      index < arr.length - 1 ? "border-b border-rule" : ""
                    }`}
                  >
                    <Text
                      className="font-sans text-sm text-ink-3"
                      style={{ fontVariant: ["tabular-nums"] }}
                    >
                      {new Date(sample.sampledAt).toISOString().slice(0, 16).replace("T", " ")}
                    </Text>
                    <View className="flex-row items-center gap-3">
                      <ToneChip tone="heart">{formatBpm(sample.heartRateBpm)}</ToneChip>
                      <Text className="font-sans text-xs text-ink-3">
                        {vitalsSourceLabel(sample.source, i18n)}
                      </Text>
                    </View>
                  </View>
                ))}
              </Sheet>
            </View>
          </Details>
        ) : null}
      </Page>
    </Container>
  );
}
