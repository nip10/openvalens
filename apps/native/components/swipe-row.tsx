import type { ReactNode } from "react";
import { View } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";

/**
 * A row that slides left to show its actions (#393). The same actions must
 * also be reachable without the gesture: pass them as accessibility actions
 * on the row, and keep them in the editor the row opens.
 */
export function SwipeRow({ children, actions }: { children: ReactNode; actions: ReactNode }) {
  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <View className="flex-row items-center gap-1 bg-background pl-2">{actions}</View>
      )}
    >
      <View className="bg-card">{children}</View>
    </ReanimatedSwipeable>
  );
}
