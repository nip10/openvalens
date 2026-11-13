import { useLingui } from "@lingui/react/macro";
import {
  defaultManualSleepWindow,
  MANUAL_SLEEP_DUPLICATE_NOTE,
  MANUAL_SLEEP_ERROR_MESSAGES,
  parseManualSleepForm,
  SLEEP_QUALITY_LABELS,
  SLEEP_QUALITY_VALUES,
} from "@openvalens/api/presenters/manual-sleep";
import { formatClockTime, formatSleepDuration } from "@openvalens/api/presenters/sleep";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { BedDouble, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Section, Sheet, StatusPill } from "@/components/bloom";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

const INPUT_CLASS =
  "min-h-11 rounded-xl border border-rule-2 bg-paper-2 px-3 font-sans text-base text-ink";

/**
 * Manual sleep (#440): bedtime, wake time and an optional quality from 1 to 5.
 * A typed-in night is kept apart from device sleep: when they overlap it is
 * marked "Possible duplicate" and the device night counts in the totals.
 */
export function ManualSleepSection() {
  const { t, i18n } = useLingui();
  const queryClient = useQueryClient();
  const placeholderColor = useThemeColor("ink-3");
  const iconColor = useThemeColor("ink-3");
  const sessions = useQuery(orpc.sleep.manualSessions.queryOptions({ input: { days: 30 } }));
  const [initial] = useState(() => defaultManualSleepWindow());
  const [bedtime, setBedtime] = useState(initial.bedtime);
  const [wakeAt, setWakeAt] = useState(initial.wakeAt);
  const [quality, setQuality] = useState<number | null>(null);

  const parsed = parseManualSleepForm(bedtime, wakeAt);
  const duration = parsed.ok ? formatSleepDuration(parsed.window.minutes) : "";
  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.sleep.key() });

  const save = useMutation(
    orpc.sleep.logManualSession.mutationOptions({
      onSuccess: () => {
        setQuality(null);
        refresh();
      },
    }),
  );
  const remove = useMutation(
    orpc.sleep.deleteManualSession.mutationOptions({ onSuccess: refresh }),
  );

  return (
    <Section icon={BedDouble} tone="sleep" title={t`Add a night`}>
      <Sheet className="gap-4">
        <View className="flex-row gap-3">
          <View className="flex-1 gap-2">
            <Text className="font-sans text-sm text-ink-3">{t`Bedtime`}</Text>
            <TextInput
              testID="sleep-bedtime-input"
              accessibilityLabel={t`Bedtime`}
              value={bedtime}
              onChangeText={setBedtime}
              placeholder="YYYY-MM-DDTHH:MM"
              className={INPUT_CLASS}
              placeholderTextColor={placeholderColor}
            />
          </View>
          <View className="flex-1 gap-2">
            <Text className="font-sans text-sm text-ink-3">{t`Wake time`}</Text>
            <TextInput
              testID="sleep-wake-input"
              accessibilityLabel={t`Wake time`}
              value={wakeAt}
              onChangeText={setWakeAt}
              placeholder="YYYY-MM-DDTHH:MM"
              className={INPUT_CLASS}
              placeholderTextColor={placeholderColor}
            />
          </View>
        </View>
        <View className="gap-2">
          <Text className="font-sans text-sm text-ink-3">{t`How did it feel? (optional)`}</Text>
          <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
            {SLEEP_QUALITY_VALUES.map((value) => {
              const selected = quality === value;
              const label = i18n._(SLEEP_QUALITY_LABELS[value]!);
              return (
                <Pressable
                  key={value}
                  onPress={() => setQuality(selected ? null : value)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`${value} · ${label}`}
                  className={`min-h-9 justify-center rounded-full border px-3.5 active:opacity-70 ${
                    selected ? "border-sleep bg-sleep-soft" : "border-rule-2 bg-paper-2"
                  }`}
                >
                  <Text
                    className={`font-sans text-sm ${
                      selected ? "font-semibold text-ink" : "text-ink-2"
                    }`}
                  >
                    {`${value} · ${label}`}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View className="flex-row flex-wrap items-center gap-3">
          <Button
            testID="sleep-save"
            onPress={() => {
              if (!parsed.ok) return;
              save.mutate({
                startAt: parsed.window.startAt,
                endAt: parsed.window.endAt,
                quality,
              });
            }}
            isDisabled={!parsed.ok || save.isPending}
          >
            <Button.Label>{save.isPending ? t`Saving…` : t`Save`}</Button.Label>
          </Button>
          <View className="min-w-0 flex-1">
            {!parsed.ok ? (
              <Text className="font-sans text-sm text-destructive">
                {i18n._(MANUAL_SLEEP_ERROR_MESSAGES[parsed.error])}
              </Text>
            ) : save.isSuccess && save.data.possibleDuplicate ? (
              <Text className="font-sans text-sm text-warning">
                {i18n._(MANUAL_SLEEP_DUPLICATE_NOTE)}
              </Text>
            ) : save.isSuccess ? (
              <Text className="font-sans text-sm text-success">{t`Saved · ${duration}`}</Text>
            ) : save.isError ? (
              <Text className="font-sans text-sm text-destructive">{t`Could not save.`}</Text>
            ) : (
              <Text className="font-sans text-sm text-ink-3">{duration}</Text>
            )}
          </View>
        </View>

        {sessions.data && sessions.data.length > 0 ? (
          <View className="gap-3 border-t border-rule pt-4">
            <Text className="font-sans text-sm font-semibold text-ink-2">
              {t`Nights you added`}
            </Text>
            {sessions.data.map((session) => {
              const minutes = Math.round(
                (Date.parse(session.endAt) - Date.parse(session.startAt)) / 60_000,
              );
              const day = friendlyDate(i18n, session.endAt);
              const qualityLabel =
                session.quality !== null && SLEEP_QUALITY_LABELS[session.quality]
                  ? ` · ${i18n._(SLEEP_QUALITY_LABELS[session.quality]!)}`
                  : "";
              return (
                <View key={session.id} className="flex-row items-center justify-between gap-2">
                  <View className="min-w-0 flex-1 gap-0.5">
                    <Text
                      className="font-sans text-base font-semibold text-ink"
                      style={{ fontVariant: ["tabular-nums"] }}
                    >
                      {formatSleepDuration(minutes)}
                    </Text>
                    <Text className="font-sans text-sm text-ink-3">
                      {`${day} · ${formatClockTime(session.startAt)} – ${formatClockTime(session.endAt)}${qualityLabel}`}
                    </Text>
                    {session.possibleDuplicate ? (
                      <StatusPill tone="warn">{t`Possible duplicate`}</StatusPill>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => remove.mutate({ id: session.id })}
                    disabled={remove.isPending}
                    accessibilityRole="button"
                    accessibilityLabel={t`Remove the night of ${day}`}
                    hitSlop={8}
                    className="min-h-11 min-w-11 items-center justify-center active:opacity-70"
                  >
                    <Trash2 size={18} color={iconColor} />
                  </Pressable>
                </View>
              );
            })}
            {sessions.data.some((session) => session.possibleDuplicate) ? (
              <Text className="font-sans text-sm text-ink-3">
                {i18n._(MANUAL_SLEEP_DUPLICATE_NOTE)}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </Section>
  );
}
