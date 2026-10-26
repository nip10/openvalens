import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { displayLabValue } from "@openvalens/api/presenters/clinical-units";
import { formatLabDate, formatLabValue } from "@openvalens/api/presenters/labs";
import {
  defaultObservedAt,
  makeManualEntryHash,
  parseManualEntryValue,
} from "@openvalens/api/presenters/manual-entry";
import { useMutation } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { FlaskConical, Plus, TestTube } from "lucide-react-native";
import { useState } from "react";
import { RefreshControl, Text, TextInput, View } from "react-native";

import {
  EmptyState,
  ErrorState,
  ListCard,
  Page,
  PageHeader,
  Section,
  Sheet,
} from "@/components/bloom";
import { Container } from "@/components/container";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { useDisplayPreferences } from "@/lib/display-preferences";
import { enqueueMetricSample, useCacheFirst } from "@/lib/offline/sync";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

function AddReadingForm({ markerCode, onSaved }: { markerCode: string; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const { t } = useLingui();
  const placeholderColor = useThemeColor("ink-3");
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

  const field = { min: 0, max: 100_000 } as const;
  const numeric = parseManualEntryValue(field, value);

  const submit = () => {
    if (numeric === null) return;
    save.mutate({
      metricCode: markerCode as never,
      observedAt,
      valueNumeric: numeric,
      dedupeHash: makeManualEntryHash(markerCode as never, observedAt, numeric),
    });
  };

  return (
    <Section icon={Plus} tone="water" title={t`Add reading`}>
      <Sheet className="gap-4">
        <View className="flex-row gap-3">
          <View className="flex-1 gap-2">
            <Text className="font-sans text-sm text-ink-3">{t`Value`}</Text>
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder="0–100000"
              keyboardType="numeric"
              className="min-h-11 rounded-xl border border-rule-2 bg-paper-2 px-3 font-sans text-base text-ink"
              placeholderTextColor={placeholderColor}
            />
          </View>
          <View className="flex-1 gap-2">
            <Text className="font-sans text-sm text-ink-3">{t`Observed at`}</Text>
            <TextInput
              value={observedAt}
              onChangeText={setObservedAt}
              placeholder="YYYY-MM-DDTHH:MM"
              className="min-h-11 rounded-xl border border-rule-2 bg-paper-2 px-3 font-sans text-base text-ink"
              placeholderTextColor={placeholderColor}
            />
          </View>
        </View>
        <View className="flex-row flex-wrap items-center gap-3">
          <Button onPress={submit} isDisabled={numeric === null || save.isPending}>
            <Button.Label>{save.isPending ? t`Saving…` : t`Save`}</Button.Label>
          </Button>
          {numeric === null && value.length > 0 ? (
            <Text className="font-sans text-sm text-destructive">0–100000</Text>
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

export default function LabsScreen() {
  const foreground = useThemeColor("foreground");
  const { t } = useLingui();
  const { formatLocale, labUnits } = useDisplayPreferences();
  const dateSettings = formatLocale
    ? { units: "metric" as const, locale: formatLocale }
    : undefined;
  // Display only (#67): the stored reading and its reported unit never change.
  const shown = (marker: { code: string; unit: string | null; latestValue: number | null }) =>
    marker.latestValue === null
      ? { value: null, unit: marker.unit, converted: false }
      : displayLabValue(marker, marker.latestValue, labUnits);
  const markers = useCacheFirst(
    "labs.latest",
    orpc.labs.latest.queryOptions({ input: { recentLimit: 10 } }),
  );

  const header = (
    <PageHeader title={t`Labs`} description={t`Latest markers`} actions={<SyncStatusBadge />} />
  );

  if (markers.isPending)
    return (
      <Container>
        <Page>
          {header}
          <View className="gap-3">
            <Sheet className="h-24" />
            <Sheet className="h-24" />
            <Sheet className="h-24" />
          </View>
        </Page>
      </Container>
    );

  if (markers.isError || !markers.data)
    return (
      <Container>
        <Page>
          {header}
          <ErrorState
            title={t`Could not load labs.`}
            action={
              <Button variant="outline" size="sm" onPress={() => void markers.refetch()}>
                <Button.Label>{t`Retry`}</Button.Label>
              </Button>
            }
          />
        </Page>
      </Container>
    );

  const list = markers.data;
  const withResults = list.filter((marker) => marker.latestValue !== null);
  const waiting = list.filter((marker) => marker.latestValue === null);

  const markerCard = (marker: (typeof list)[number]) => {
    const display = shown(marker);
    return (
      <ListCard
        key={marker.code}
        icon={TestTube}
        tone="water"
        title={marker.displayName}
        chip={marker.latestValue === null ? undefined : formatLabValue(display.value, display.unit)}
        subtitle={
          marker.latestValue === null
            ? t`No readings yet`
            : t`${formatLabDate(marker.latestSampledAt, dateSettings)}, ${plural(marker.sampleCount, { one: "# reading", other: "# readings" })}`
        }
      >
        {marker.unit && display.converted ? (
          <Text className="font-sans text-xs text-ink-3">
            {t({ message: `Converted from ${marker.unit}`, comment: "safety" })}
          </Text>
        ) : null}
      </ListCard>
    );
  };

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={markers.isRefetching}
            onRefresh={() => void markers.refetch()}
            tintColor={foreground}
          />
        ),
      }}
    >
      <Page>
        {header}

        {list.length === 0 ? (
          <EmptyState
            icon={FlaskConical}
            tone="water"
            title={t`No lab markers yet`}
            description={t`Markers appear here once a lab reading is recorded for your account. Importing lab reports is not available yet.`}
          />
        ) : (
          <>
            {withResults.length > 0 ? (
              <Section icon={FlaskConical} tone="water" title={t`Your results`}>
                <View className="gap-3">{withResults.map(markerCard)}</View>
              </Section>
            ) : null}
            {waiting.length > 0 ? (
              <Section
                icon={TestTube}
                tone="water"
                title={t`No readings yet`}
                info={t`Markers appear here once a lab reading is recorded for your account. Importing lab reports is not available yet.`}
              >
                <View className="gap-3">{waiting.map(markerCard)}</View>
              </Section>
            ) : null}
            <AddReadingForm
              markerCode={list[0]?.code ?? ""}
              onSaved={() => void markers.refetch()}
            />
          </>
        )}
      </Page>
    </Container>
  );
}
