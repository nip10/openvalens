import { Trans, useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { Check, GripVertical, Plus } from "lucide-react-native";
import { useRef, useState, type ReactNode } from "react";
import { Animated, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ExerciseThumbnail } from "@/components/exercise-thumbnail";
import { dragTargetIndex, type ExerciseProgress } from "@/lib/workouts/active";
import { useThemeColor } from "@/utils/theme";

/** Row pitch (row height + gap) used to turn a drag distance into a position. */
const ROW_PITCH = 80;

export type OverviewItem = {
  id: string;
  exerciseId: number | null;
  name: string;
  target: string | null;
  progress: ExerciseProgress;
};

/**
 * Drag handle + row. The handle pans (on the JS thread: the list is short),
 * the row follows the finger, and on release the row moves to the slot it
 * was dropped on. Screen readers get "Move up" / "Move down" actions instead.
 */
function DraggableRow({
  index,
  count,
  label,
  onMove,
  children,
}: {
  index: number;
  count: number;
  label: string;
  onMove: (from: number, to: number) => void;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const y = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const muted = useThemeColor("ink-3");
  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([-6, 6])
    .onStart(() => setDragging(true))
    .onUpdate((event) => y.setValue(event.translationY))
    .onEnd((event) => {
      const to = dragTargetIndex(index, event.translationY, ROW_PITCH, count);
      y.setValue(0);
      setDragging(false);
      if (to !== index) onMove(index, to);
    })
    .onFinalize(() => {
      y.setValue(0);
      setDragging(false);
    });
  return (
    <Animated.View
      style={{
        transform: [{ translateY: y }],
        zIndex: dragging ? 10 : 0,
        opacity: dragging ? 0.92 : 1,
      }}
      className="flex-row items-center gap-1"
    >
      <GestureDetector gesture={pan}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={t`Reorder ${label}`}
          accessibilityHint={t`Drag to move, or use the actions to move up or down.`}
          accessibilityActions={[
            ...(index > 0 ? [{ name: "moveUp", label: t`Move up` }] : []),
            ...(index < count - 1 ? [{ name: "moveDown", label: t`Move down` }] : []),
          ]}
          onAccessibilityAction={(event) => {
            if (
              event.nativeEvent.actionName === "moveUp" ||
              event.nativeEvent.actionName === "decrement"
            )
              onMove(index, index - 1);
            if (
              event.nativeEvent.actionName === "moveDown" ||
              event.nativeEvent.actionName === "increment"
            )
              onMove(index, index + 1);
          }}
          testID={`workout-overview-drag-${index + 1}`}
          className="h-11 w-8 items-center justify-center"
        >
          <GripVertical size={18} color={muted} />
        </View>
      </GestureDetector>
      <View className="flex-1">{children}</View>
    </Animated.View>
  );
}

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
