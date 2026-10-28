import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "heroui-native";
import { Alert, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useWorkoutSession } from "@/lib/workouts/sync";
import type { WorkoutDetail } from "@/lib/workouts/model";
import { weightFromKg } from "@/lib/workouts/model";
import { SaveWorkoutAsRoutine } from "@/components/workout-routines";

export function WorkoutSessionDetail({
  workout,
  onClose,
  units,
}: {
  workout: WorkoutDetail | null;
  onClose: () => void;
  units: "metric" | "imperial";
}) {
  const { t } = useLingui();
  const session = useWorkoutSession();
  const editable = !!workout?.canEdit && workout.ownership !== "legacy";
  const edit = () => {
    if (session.draft) {
      Alert.alert(
        t`Active workout in progress`,
        t`Save or discard your active workout before editing another session.`,
        [
          { text: t`Cancel`, style: "cancel" },
          {
            text: t`Discard and continue`,
            style: "destructive",
            onPress: () => {
              if (session.discardDraft() && workout && session.openWorkout(workout)) onClose();
            },
          },
        ],
      );
      return;
    }
    if (workout && !session.openWorkout(workout))
      Alert.alert(
        t`Could not edit workout`,
        t`This workout could not be opened. Please try again.`,
      );
    else onClose();
  };
  const remove = () => {
    if (!workout) return;
    Alert.alert(t`Delete workout?`, t`This session will be removed.`, [
      { text: t`Cancel`, style: "cancel" },
      {
        text: t`Delete`,
        style: "destructive",
        onPress: () => {
          if (session.deleteWorkout(workout)) onClose();
          else
            Alert.alert(
              t`Could not delete workout`,
              t`This workout could not be deleted. Please try again.`,
            );
        },
      },
    ]);
  };
  return (
    <Modal visible={!!workout} animationType="slide" onRequestClose={onClose}>
      <ScrollView className="flex-1 bg-paper px-5 py-8" contentContainerClassName="gap-5">
        <View className="flex-row items-center justify-between">
          <Text accessibilityRole="header" className="font-display text-2xl font-semibold text-ink">
            <Trans>Workout details</Trans>
          </Text>
          <Pressable accessibilityRole="button" onPress={onClose} className="p-3">
            <Text className="text-ink">
              <Trans>Close</Trans>
            </Text>
          </Pressable>
        </View>
        {workout ? (
          <>
            <Text className="font-sans text-ink-2">
              {workout.date} · {workout.duration ?? "—"} min
            </Text>
            {!editable ? (
              <Text className="font-sans text-sm text-ink-3">
                <Trans>Legacy session · read only</Trans>
              </Text>
            ) : null}
            {workout.notes ? <Text className="font-sans text-ink-2">{workout.notes}</Text> : null}
            {workout.exercises.map((exercise, ei) => (
              <View
                key={`${ei}-${exercise.name}`}
                className="gap-2 rounded-2xl border border-rule bg-sheet p-4"
              >
                <Text className="font-sans text-lg font-semibold text-ink">{exercise.name}</Text>
                {exercise.notes ? (
                  <Text className="font-sans text-sm text-ink-2">{exercise.notes}</Text>
                ) : null}
                {exercise.sets.map((set, si) => (
                  <Text key={set.id ?? si} className="font-sans text-sm text-ink-2">
                    {si + 1}.{" "}
                    {set.weightKg == null
                      ? "—"
                      : Number(weightFromKg(set.weightKg, units).toFixed(1))}{" "}
                    {units === "imperial" ? "lb" : "kg"} × {set.reps}
                    {set.rpe == null ? "" : ` · RPE ${set.rpe}`}
                    {set.notes ? ` · ${set.notes}` : ""}
                  </Text>
                ))}
              </View>
            ))}
            {editable ? (
              <View className="flex-row gap-3">
                <Button onPress={edit}>
                  <Button.Label>{t`Edit workout`}</Button.Label>
                </Button>
                <Button variant="outline" onPress={remove}>
                  <Button.Label>{t`Delete`}</Button.Label>
                </Button>
              </View>
            ) : null}
            {workout.duration != null && workout.exercises.length ? (
              <SaveWorkoutAsRoutine workout={workout} />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Modal>
  );
}
