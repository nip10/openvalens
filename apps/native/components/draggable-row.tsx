import { useLingui } from "@lingui/react/macro";
import { GripVertical } from "lucide-react-native";
import { useRef, useState, type ReactNode } from "react";
import { Animated, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { dragTargetIndex } from "@/lib/workouts/active";
import { useThemeColor } from "@/utils/theme";

/**
 * Drag handle + row. The handle pans (on the JS thread: the list is short),
 * the row follows the finger, and on release the row moves to the slot it
 * was dropped on. Screen readers get "Move up" / "Move down" actions instead.
 */
export function DraggableRow({
  index,
  count,
  label,
  onMove,
  children,
  pitch = 80,
  testIDPrefix = "workout-overview-drag",
}: {
  index: number;
  count: number;
  label: string;
  onMove: (from: number, to: number) => void;
  children: ReactNode;
  /** Row height plus gap, used to turn a drag distance into a slot. */
  pitch?: number;
  testIDPrefix?: string;
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
      const to = dragTargetIndex(index, event.translationY, pitch, count);
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
          testID={`${testIDPrefix}-${index + 1}`}
          className="h-11 w-8 items-center justify-center"
        >
          <GripVertical size={18} color={muted} />
        </View>
      </GestureDetector>
      <View className="flex-1">{children}</View>
    </Animated.View>
  );
}
