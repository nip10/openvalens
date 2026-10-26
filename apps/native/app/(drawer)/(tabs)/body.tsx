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
import { Button } from "heroui-native";
import { CalendarDays, Plus, Scale, TrendingDown, TrendingUp } from "lucide-react-native";
import { RefreshControl, Text, TextInput, View } from "react-native";
import { useState } from "react";

import {
  Details,
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  Section,
  Sheet,
  StatTile,
  TileRow,
} from "@/components/bloom";
import { TrendChart } from "@/components/chart";
import { Container } from "@/components/container";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { enqueueMetricSample, useCacheFirst } from "@/lib/offline/sync";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

const SERIES_DAYS = 90;

const INPUT_CLASS =
  "min-h-11 rounded-xl border border-rule-2 bg-sheet px-3 font-sans text-base text-ink";

function AddWeightForm({ onSaved }: { onSaved: () => void }) {
  const field = MANUAL_ENTRY_FIELDS.weight;
  const { t, i18n } = useLingui();
  const placeholder = useThemeColor("ink-3");
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
    <Section icon={Plus} tone="weight" title={t`Add weight`} sheet>
      <View className="flex-row gap-3">
        <View className="flex-1 gap-2">
          <Text className="font-sans text-sm font-medium text-ink-2">{t`Weight (${unit})`}</Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={`${field.min}–${field.max}`}
            keyboardType="numeric"
            className={INPUT_CLASS}
            placeholderTextColor={placeholder}
          />
        </View>
        <View className="flex-1 gap-2">
          <Text className="font-sans text-sm font-medium text-ink-2">{t`Observed at`}</Text>
          <TextInput
            value={observedAt}
            onChangeText={setObservedAt}
            placeholder="YYYY-MM-DDTHH:MM"
            className={INPUT_CLASS}
            placeholderTextColor={placeholder}
          />
        </View>
      </View>
      <View className="flex-row flex-wrap items-center gap-3">
        <Button onPress={submit} isDisabled={numeric === null || save.isPending}>
          {save.isPending ? t`Saving…` : t`Save`}
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
    </Section>
  );
}

export default function BodyScreen() {
  const foreground = useThemeColor("foreground");
  const { t, i18n } = useLingui();

  const daily = useCacheFirst(
    "body.dailyWeights",
    orpc.body.dailyWeights.queryOptions({ input: { limit: SERIES_DAYS } }),
  );
  const summary = summarizeDailyWeights(daily.data ?? []);
  const refetch = () => void daily.refetch();

  const weights = summary.series.map((point) => point.weightKg);
  const recent = [...summary.series].reverse().slice(0, 14);

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={daily.isRefetching}
            onRefresh={refetch}
            tintColor={foreground}
          />
        ),
      }}
    >
      <Page>
        <PageHeader title={t`Body`} actions={<SyncStatusBadge />} />

        {daily.isPending ? (
          <View className="gap-3">
            <Sheet className="h-36" />
            <Sheet className="h-56" />
          </View>
        ) : daily.isError ? (
          <ErrorState
            title={t`Could not load weight.`}
            action={
              <Button variant="outline" size="sm" onPress={refetch}>
                {t`Retry`}
              </Button>
            }
          />
        ) : !summary.latest ? (
          <EmptyState
            icon={Scale}
            tone="weight"
            title={t`No weight yet`}
            description={t`Sync a scale through Health Connect or Apple Health, or add a weight.`}
          />
        ) : (
          <>
            <View className="gap-3">
              <StatTile
                icon={Scale}
                tone="weight"
                label={t`Weight`}
                value={formatKg(summary.latest.weightKg)}
                note={friendlyDate(i18n, summary.latest.date)}
              />
              <TileRow>
                <StatTile
                  icon={CalendarDays}
                  tone="weight"
                  label={t`7 days`}
                  value={summary.change7d === null ? "—" : formatKgDelta(i18n, summary.change7d)}
                />
                <StatTile
                  icon={TrendingDown}
                  tone="weight"
                  label={t`30 days`}
                  value={summary.change30d === null ? "—" : formatKgDelta(i18n, summary.change30d)}
                />
              </TileRow>
            </View>

            <Section icon={TrendingUp} tone="weight" title={t`Last 90 days`}>
              <Sheet>
                <TrendChart
                  tone="weight"
                  data={summary.series.map((point) => ({
                    value: point.weightKg,
                    label: friendlyDate(i18n, point.date),
                  }))}
                  minValue={Math.floor(Math.min(...weights) - 1)}
                  maxValue={Math.ceil(Math.max(...weights) + 1)}
                  formatYLabel={(label) => String(Math.round(Number(label)))}
                />
              </Sheet>
            </Section>
          </>
        )}

        {daily.isError ? null : <AddWeightForm onSaved={refetch} />}

        {recent.length > 0 ? (
          <Details summary={t`All readings`}>
            <Sheet className="px-4 py-1">
              {recent.map((point, index) => {
                const source = daily.data?.find((row) => row.date === point.date)?.source ?? "";
                return (
                  <View
                    key={point.date}
                    className={`flex-row items-center justify-between gap-3 py-3 ${
                      index < recent.length - 1 ? "border-b border-rule" : ""
                    }`}
                  >
                    <View className="min-w-0 flex-1 gap-0.5">
                      <Text className="font-sans text-base font-medium text-ink">
                        {friendlyDate(i18n, point.date)}
                      </Text>
                      <Text className="font-sans text-sm text-ink-3">
                        {i18n._(weightSourceLabel(source))}
                      </Text>
                    </View>
                    <Text
                      className="font-sans text-base font-semibold text-ink"
                      style={{ fontVariant: ["tabular-nums"] }}
                    >
                      {formatKg(point.weightKg)}
                    </Text>
                  </View>
                );
              })}
            </Sheet>
          </Details>
        ) : null}
      </Page>
    </Container>
  );
}
