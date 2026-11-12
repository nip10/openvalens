import { useLingui } from "@lingui/react/macro";
import {
  bloodPressureSamples,
  defaultObservedAt,
  MANUAL_ENTRY_FIELDS,
  parseBloodPressure,
} from "@openvalens/api/presenters/manual-entry";
import {
  BLOOD_PRESSURE_DUPLICATE_NOTE,
  bloodPressureSourceLabel,
  formatBloodPressure,
  formatBpm,
} from "@openvalens/api/presenters/vitals";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { Gauge } from "lucide-react-native";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { Section, Sheet, StatusPill } from "@/components/bloom";
import { enqueueMetricSample } from "@/lib/offline/sync";
import { friendlyDate } from "@/utils/friendly";
import { client, orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

const INPUT_CLASS =
  "min-h-11 rounded-xl border border-rule-2 bg-paper-2 px-3 font-sans text-base text-ink";

/**
 * Manual blood pressure (#440): systolic, diastolic and an optional pulse,
 * written through `healthRecord.ingestMetricSample` with the codes a Bluetooth
 * monitor writes, and queued offline like other readings. Device and typed-in
 * readings are listed side by side; nothing is merged.
 */
export function BloodPressureSection() {
  const { t, i18n } = useLingui();
  const placeholderColor = useThemeColor("ink-3");
  const readings = useQuery(
    orpc.vitals.bloodPressureReadings.queryOptions({ input: { limit: 10 } }),
  );
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [pulse, setPulse] = useState("");
  const [observedAt, setObservedAt] = useState(defaultObservedAt());

  const parsed = parseBloodPressure({ systolic, diastolic, pulse });
  const touched = systolic.length > 0 && diastolic.length > 0;
  const errors = parsed.ok ? [] : parsed.errors;

  const save = useMutation({
    mutationFn: async () => {
      if (!parsed.ok) return;
      const samples = bloodPressureSamples(parsed.reading, observedAt);
      const results = await Promise.allSettled(
        samples.map((sample) => client.healthRecord.ingestMetricSample(sample)),
      );
      let failure: unknown = null;
      results.forEach((result, index) => {
        if (result.status === "fulfilled") return;
        enqueueMetricSample(samples[index]!, result.reason);
        failure ??= result.reason;
      });
      if (failure) throw failure;
    },
    onSuccess: () => {
      setSystolic("");
      setDiastolic("");
      setPulse("");
      setObservedAt(defaultObservedAt());
    },
    onSettled: () => void readings.refetch(),
  });

  const { min: systolicMin, max: systolicMax } = MANUAL_ENTRY_FIELDS.blood_pressure_systolic;
  const { min: diastolicMin, max: diastolicMax } = MANUAL_ENTRY_FIELDS.blood_pressure_diastolic;
  const { min: pulseMin, max: pulseMax } = MANUAL_ENTRY_FIELDS.heart_rate;

  const field = (
    label: string,
    value: string,
    onChange: (next: string) => void,
    placeholder: string,
    testID: string,
  ) => (
    <View className="flex-1 gap-2">
      <Text className="font-sans text-sm text-ink-3">{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        keyboardType="numeric"
        className={INPUT_CLASS}
        placeholderTextColor={placeholderColor}
      />
    </View>
  );

  return (
    <Section icon={Gauge} tone="heart" title={t`Blood pressure`}>
      <Sheet className="gap-4">
        <View className="flex-row gap-3">
          {field(t`Systolic (mmHg)`, systolic, setSystolic, "120", "bp-systolic-input")}
          {field(t`Diastolic (mmHg)`, diastolic, setDiastolic, "80", "bp-diastolic-input")}
          {field(t`Pulse (bpm)`, pulse, setPulse, t`Optional`, "bp-pulse-input")}
        </View>
        <View className="gap-2">
          <Text className="font-sans text-sm text-ink-3">{t`Observed at`}</Text>
          <TextInput
            accessibilityLabel={t`Observed at`}
            value={observedAt}
            onChangeText={setObservedAt}
            placeholder="YYYY-MM-DDTHH:MM"
            className={INPUT_CLASS}
            placeholderTextColor={placeholderColor}
          />
        </View>
        <View className="flex-row flex-wrap items-center gap-3">
          <Button
            testID="bp-save"
            onPress={() => save.mutate()}
            isDisabled={!parsed.ok || save.isPending}
          >
            <Button.Label>{save.isPending ? t`Saving…` : t`Save`}</Button.Label>
          </Button>
          {touched && errors.includes("order") ? (
            <Text className="font-sans text-sm text-destructive">
              {t`Systolic must be higher than diastolic.`}
            </Text>
          ) : touched && errors.length > 0 ? (
            <Text className="font-sans text-sm text-destructive">
              {t`Systolic ${systolicMin}–${systolicMax}, diastolic ${diastolicMin}–${diastolicMax}, pulse ${pulseMin}–${pulseMax}.`}
            </Text>
          ) : save.isSuccess ? (
            <Text className="font-sans text-sm text-success">{t`Saved`}</Text>
          ) : save.isError ? (
            <Text className="font-sans text-sm text-destructive">{t`Could not save.`}</Text>
          ) : null}
        </View>

        {readings.data && readings.data.length > 0 ? (
          <View className="gap-3 border-t border-rule pt-4">
            {readings.data.map((reading) => (
              <View
                key={`${reading.observedAt}-${reading.source ?? ""}`}
                className="flex-row flex-wrap items-center justify-between gap-2"
              >
                <View className="gap-0.5">
                  <Text
                    className="font-sans text-base font-semibold text-ink"
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    {formatBloodPressure(reading)}
                    {reading.pulse !== null ? `  ${formatBpm(reading.pulse)}` : ""}
                  </Text>
                  <Text className="font-sans text-sm text-ink-3">
                    {`${friendlyDate(i18n, reading.observedAt)} ${new Date(
                      reading.observedAt,
                    ).toLocaleTimeString(i18n.locale, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })} · ${bloodPressureSourceLabel(reading, i18n)}`}
                  </Text>
                </View>
                {reading.possibleDuplicate ? (
                  <StatusPill tone="warn">{t`Possible duplicate`}</StatusPill>
                ) : null}
              </View>
            ))}
            {readings.data.some((reading) => reading.possibleDuplicate) ? (
              <Text className="font-sans text-sm text-ink-3">
                {i18n._(BLOOD_PRESSURE_DUPLICATE_NOTE)}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </Section>
  );
}
