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
import { Button } from "heroui-native";
import { BarChart3, Flame, Footprints, Plus, Route } from "lucide-react-native";
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

const MANUAL_METRICS: ManualEntryMetric[] = ["steps", "active_calories", "distance"];

function AddReadingForm({ onSaved }: { onSaved: () => void }) {
  const [metric, setMetric] = useState<ManualEntryMetric>("steps");
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
    <Section icon={Plus} tone="steps" title={t`Add reading`}>
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
                    selected ? "border-steps bg-steps-soft" : "border-rule-2 bg-paper-2"
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

export default function ActivityScreen() {
  const foreground = useThemeColor("foreground");
  const { t, i18n } = useLingui();
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

  const header = <PageHeader title={t`Activity`} actions={<SyncStatusBadge />} />;

  if (totals.isPending)
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

  if (totals.isError || !summary)
    return (
      <Container>
        <Page>
          {header}
          <ErrorState
            title={t`Could not load activity.`}
            action={
              <Button variant="outline" size="sm" onPress={() => void totals.refetch()}>
                <Button.Label>{t`Retry`}</Button.Label>
              </Button>
            }
          />
        </Page>
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
      <Page>
        {header}

        {!today ? (
          <EmptyState
            icon={Footprints}
            tone="steps"
            title={t`No activity yet`}
            description={t`Sync Health Connect or Apple Health from the mobile app, or add an entry.`}
          />
        ) : (
          <>
            <View className="gap-3" accessibilityLabel={t`Today`}>
              <TileRow>
                <StatTile
                  icon={Footprints}
                  tone="steps"
                  label={t`Steps`}
                  value={formatSteps(today.steps)}
                  meter={
                    summary.sevenDayAverageSteps
                      ? { value: today.steps / summary.sevenDayAverageSteps }
                      : undefined
                  }
                  note={t`Your usual: ${formatSteps(summary.sevenDayAverageSteps)}`}
                />
                <StatTile
                  icon={Flame}
                  tone="food"
                  label={t`Calories`}
                  value={formatKcalories(today.activeCaloriesKcal)}
                  note={t`Your usual: ${formatKcalories(summary.sevenDayAverageCalories)}`}
                />
              </TileRow>
              <TileRow>
                <StatTile
                  icon={Route}
                  tone="water"
                  label={t`Distance`}
                  value={formatDistanceMeters(today.distanceMeters)}
                  note={t`Your usual: ${formatDistanceMeters(summary.sevenDayAverageDistance)}`}
                />
                <View />
              </TileRow>
            </View>

            <Section
              icon={BarChart3}
              tone="steps"
              title={t`Last ${windowDays} days`}
              info={t`Bars: steps per day`}
            >
              <Sheet>
                <TrendChart
                  bars
                  tone="steps"
                  data={series.map((point) => ({
                    value: point.steps,
                    label: friendlyDate(i18n, point.date),
                  }))}
                  minValue={0}
                  maxValue={Math.ceil(maxSteps / 1000) * 1000}
                  formatYLabel={(label) => formatSteps(Number(label))}
                  height={170}
                />
              </Sheet>
            </Section>
          </>
        )}

        <AddReadingForm onSaved={() => void totals.refetch()} />

        {today ? (
          <Details summary={t`Recent days`}>
            <View className="gap-3">
              <Sheet className="gap-3 p-4">
                <Text className="font-display text-base font-medium text-ink">{t`This week`}</Text>
                <View className="flex-row">
                  <Figure
                    className="flex-1 pr-2"
                    label={t`Steps / active day`}
                    value={formatSteps(summary.sevenDayAverageSteps)}
                  />
                  <Figure
                    className="flex-1 border-l border-rule px-2"
                    label={t`Calories / day`}
                    value={formatKcalories(summary.sevenDayAverageCalories)}
                  />
                  <Figure
                    className="flex-1 border-l border-rule pl-2"
                    label={t`Distance / day`}
                    value={formatDistanceMeters(summary.sevenDayAverageDistance)}
                  />
                </View>
              </Sheet>
              <Sheet className="p-0">
                {recent.map((day, index) => (
                  <View
                    key={day.date}
                    className={`flex-row items-center justify-between gap-3 px-4 py-3 ${
                      index < recent.length - 1 ? "border-b border-rule" : ""
                    }`}
                  >
                    <Text className="font-sans text-sm text-ink-3">
                      {friendlyDate(i18n, day.date)}
                    </Text>
                    <View className="flex-row items-center gap-3">
                      <ToneChip tone="steps">
                        {t({ message: `${formatSteps(day.steps)} steps`, comment: "safety" })}
                      </ToneChip>
                      <Text
                        className="font-sans text-xs text-ink-3"
                        style={{ fontVariant: ["tabular-nums"] }}
                      >
                        {formatKcalories(day.activeCaloriesKcal)}
                      </Text>
                      <Text
                        className="font-sans text-xs text-ink-3"
                        style={{ fontVariant: ["tabular-nums"] }}
                      >
                        {formatDistanceMeters(day.distanceMeters)}
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
