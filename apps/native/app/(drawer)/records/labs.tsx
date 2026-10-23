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
import { Button, Card, Spinner } from "heroui-native";
import { useState } from "react";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { useDisplayPreferences } from "@/lib/display-preferences";
import { enqueueMetricSample, useCacheFirst } from "@/lib/offline/sync";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

function AddReadingForm({ markerCode, onSaved }: { markerCode: string; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const { t } = useLingui();
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
    <CardStack title={t`Add reading`}>
      <Card variant="secondary" className="gap-3 p-4">
        <View className="flex-row gap-3">
          <View className="flex-1 gap-2">
            <Text className="text-sm font-medium text-foreground">{t`Value`}</Text>
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder="0–100000"
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
            <Text className="text-sm text-destructive">0–100000</Text>
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

  if (markers.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );

  if (markers.isError || !markers.data)
    return (
      <Container className="items-center justify-center gap-3 p-6" isScrollable={false}>
        <SyncStatusBadge />
        <Text className="text-base text-foreground">{t`Could not load labs.`}</Text>
        <Pressable
          onPress={() => void markers.refetch()}
          className="min-h-11 justify-center px-4"
          accessibilityRole="button"
        >
          <Text className="font-medium text-foreground underline">{t`Retry`}</Text>
        </Pressable>
      </Container>
    );

  const list = markers.data;

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
      <View className="gap-6 p-4">
        <View className="flex-row items-start justify-between gap-3">
          <View>
            <Text className="text-sm text-muted-foreground">{t`Labs`}</Text>
            <Text className="font-mono text-3xl text-foreground">{t`Latest markers`}</Text>
          </View>
          <SyncStatusBadge />
        </View>

        {list.length === 0 ? (
          <Card variant="secondary" className="items-center gap-1 p-8">
            <Text className="font-medium text-foreground">{t`No lab markers yet`}</Text>
            <Text className="text-center text-sm text-muted-foreground">
              {t`Import a lab PDF to add markers.`}
            </Text>
          </Card>
        ) : (
          <>
            <AddReadingForm
              markerCode={list[0]?.code ?? ""}
              onSaved={() => void markers.refetch()}
            />
            <CardStack>
              <Card variant="secondary" className="p-0">
                {list.map((marker, index) => (
                  <View
                    key={marker.code}
                    className={`flex-row items-center justify-between gap-3 px-4 py-3 ${
                      index < list.length - 1 ? "border-b border-border" : ""
                    }`}
                  >
                    <View className="min-w-0 flex-1">
                      <Text className="text-base text-foreground">{marker.displayName}</Text>
                      <Text className="text-xs text-muted-foreground">
                        {marker.latestValue === null
                          ? t`No readings yet`
                          : t`${formatLabDate(marker.latestSampledAt, dateSettings)} · ${plural(marker.sampleCount, { one: "# reading", other: "# readings" })}`}
                      </Text>
                    </View>
                    <View className="shrink-0 items-end">
                      <Text className="font-mono text-base text-foreground">
                        {formatLabValue(shown(marker).value, shown(marker).unit)}
                      </Text>
                      {marker.unit ? (
                        <Text className="text-xs text-muted-foreground">
                          {shown(marker).converted
                            ? t({ message: `Converted from ${marker.unit}`, comment: "safety" })
                            : marker.unit}
                        </Text>
                      ) : null}
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
