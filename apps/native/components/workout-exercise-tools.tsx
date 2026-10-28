import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "heroui-native";
import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { progressionWhy } from "@openvalens/api/presenters/workout-progression";
import type { RoutineExerciseSnapshot } from "@/lib/workouts/model";
import type { WorkoutRestTimer } from "@/lib/workouts/rest-timer";

const input =
  "min-h-11 rounded-xl border border-rule-2 bg-paper-2 px-3 font-sans text-base text-ink";

export function WorkoutExerciseTools({
  exerciseKey,
  suggestion,
  prescription,
  units,
  rest,
  fallbackSeconds,
}: {
  exerciseKey: string;
  suggestion: unknown;
  prescription?: RoutineExerciseSnapshot;
  units: "metric" | "imperial";
  rest: WorkoutRestTimer;
  fallbackSeconds: number;
}) {
  const { t, i18n } = useLingui();
  const [value, setValue] = useState(String(rest.restSeconds(exerciseKey, fallbackSeconds)));
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    setValue(String(rest.restSeconds(exerciseKey, fallbackSeconds)));
  }, [exerciseKey, rest.ready, fallbackSeconds]);
  const why =
    prescription && isSuggestion(suggestion)
      ? progressionWhy(suggestion, prescription, units)
      : null;
  const apply = async () => {
    const seconds = Number(value);
    if (!/^\d+$/.test(value) || !Number.isInteger(seconds) || seconds < 0 || seconds > 3600) {
      setFeedback(t`Enter a whole number from 0 to 3600 seconds.`);
      return;
    }
    if (await rest.setRestSeconds(exerciseKey, seconds)) setFeedback(t`Rest preference saved.`);
    else setFeedback(t`Could not save rest preference. Your workout is unchanged.`);
  };
  return (
    <View className="gap-2 rounded-xl border border-rule bg-paper-2 p-3">
      {why ? <Text className="font-sans text-sm text-ink-2">{i18n._(why)}</Text> : null}
      <Text className="font-sans text-sm font-semibold text-ink">
        <Trans>Rest between sets</Trans>
      </Text>
      <View className="flex-row items-center gap-2">
        <TextInput
          accessibilityLabel={t`Rest duration in seconds`}
          keyboardType="number-pad"
          value={value}
          onChangeText={setValue}
          className={`${input} flex-1`}
        />
        <Button size="sm" variant="outline" onPress={() => void apply()}>
          <Button.Label>{t`Save`}</Button.Label>
        </Button>
      </View>
      {feedback ? (
        <Text accessibilityRole="alert" className="text-sm text-ink-2">
          {feedback}
        </Text>
      ) : null}
      <Text className="font-sans text-xs text-ink-3">
        <Trans>
          The in-app countdown works without permission. Background alerts depend on your phone
          settings and are best-effort.
        </Trans>
      </Text>
      <Button
        size="sm"
        variant="outline"
        onPress={async () => {
          const result = await rest.enableAlerts();
          setFeedback(
            result === "granted"
              ? t`Rest alerts enabled.`
              : result === "unsupported"
                ? t`Background alerts are not supported on this device.`
                : t`Rest alerts were not enabled. Check your phone settings.`,
          );
        }}
      >
        <Button.Label>{t`Enable rest alerts`}</Button.Label>
      </Button>
    </View>
  );
}

function isSuggestion(value: unknown): value is Parameters<typeof progressionWhy>[0] {
  return typeof value === "object" && value !== null && "kind" in value;
}
