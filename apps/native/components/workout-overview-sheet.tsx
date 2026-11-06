import { Trans, useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { Check, Plus } from "lucide-react-native";
import { type ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DraggableRow } from "@/components/draggable-row";
import { ExerciseThumbnail } from "@/components/exercise-thumbnail";
import type { ExerciseProgress } from "@/lib/workouts/active";
import { useThemeColor } from "@/utils/theme";

export type OverviewItem = {
  id: string;
  exerciseId: number | null;
  name: string;
  target: string | null;
  progress: ExerciseProgress;
};

/**
 * Issue #401 — the whole workout at a glance (mockup g2): every exercise
 * with its target and sets done/planned, the current one highlighted. Tap to
 * jump, drag (or accessibility actions) to reorder, add an exercise. Workout
 * date and discard live here too, out of the way of logging.
 */
export function WorkoutOverviewSheet({
  visible,
  title,
  items,
  setsDone,
  setsPlanned,
  onClose,
  onJump,
  onMove,
  onAddExercise,
  footer,
}: {
  visible: boolean;
  title: string;
  items: OverviewItem[];
  setsDone: number;
  setsPlanned: number;
  onClose: () => void;
  onJump: (id: string) => void;
  onMove: (from: number, to: number) => void;
  onAddExercise: () => void;
  footer?: ReactNode;
}) {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const signalInk = useThemeColor("signal-ink");
  const signal = useThemeColor("signal");
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <ScrollView
        testID="workout-overview"
        contentContainerClassName="gap-3 bg-paper px-4 pt-4"
        style={{ paddingBottom: insets.bottom }}
        accessibilityViewIsModal
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-1 gap-0.5">
            <Text
              accessibilityRole="header"
              className="font-display text-2xl font-semibold text-ink"
            >
              {title}
            </Text>
            <Text className="font-sans text-sm text-ink-2">
              {t`${plural(items.length, { one: "# exercise", other: "# exercises" })}`} ·{" "}
              {t`${setsDone} of ${setsPlanned} sets done`}
            </Text>
          </View>
          <Pressable
            testID="workout-overview-done"
            accessibilityRole="button"
            onPress={onClose}
            className="min-h-11 justify-center px-2"
          >
            <Text className="font-sans text-base font-semibold text-ink-2">
              <Trans>Done</Trans>
            </Text>
          </Pressable>
        </View>
        <View className="gap-2">
          {items.map((item, index) => {
            const current = item.progress.state === "current";
            const complete = item.progress.state === "done";
            return (
              <DraggableRow
                key={item.id}
                index={index}
                count={items.length}
                label={item.name}
                onMove={onMove}
              >
                <Pressable
                  testID={`workout-overview-item-${index + 1}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: current }}
                  accessibilityLabel={[
                    item.name,
                    item.target,
                    t`${item.progress.done} of ${item.progress.planned} sets done`,
                    current ? t`current exercise` : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  onPress={() => onJump(item.id)}
                  className={`min-h-[72px] flex-row items-center gap-3 rounded-2xl border-2 px-2 ${
                    current ? "border-signal bg-paper-3" : "border-transparent bg-paper-2"
                  }`}
                >
                  <ExerciseThumbnail exerciseId={item.exerciseId} size={48} />
                  <View className="flex-1 gap-0.5">
                    <Text
                      numberOfLines={1}
                      className={`font-sans text-base font-semibold ${complete || current ? "text-ink" : "text-ink-2"}`}
                    >
                      {item.name}
                    </Text>
                    {item.target ? (
                      <Text className="num font-sans text-sm text-ink-2">{item.target}</Text>
                    ) : null}
                  </View>
                  <View
                    className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${
                      current ? "bg-signal" : complete ? "bg-ink-2" : "bg-paper-3"
                    }`}
                  >
                    <Text
                      className={`num font-sans text-xs font-semibold ${current || complete ? "" : "text-ink-2"}`}
                      style={current || complete ? { color: signalInk } : undefined}
                    >
                      {`${item.progress.done}/${item.progress.planned}`}
                    </Text>
                    {complete ? <Check size={12} color={signalInk} /> : null}
                  </View>
                </Pressable>
              </DraggableRow>
            );
          })}
        </View>
        <Pressable
          testID="workout-overview-add"
          accessibilityRole="button"
          onPress={onAddExercise}
          className="min-h-[52px] flex-row items-center justify-center gap-2 rounded-full border border-dashed border-rule-2"
        >
          <Plus size={16} color={signal} />
          <Text className="font-sans text-base font-semibold text-signal">
            <Trans>Add exercise</Trans>
          </Text>
        </Pressable>
        {items.length > 1 ? (
          <Text className="font-sans text-sm text-ink-3">
            <Trans>Drag to reorder. Tap an exercise to go to it.</Trans>
          </Text>
        ) : null}
        {footer}
      </ScrollView>
    </Modal>
  );
}
