import * as Haptics from "expo-haptics";
import { Moon, Sun } from "lucide-react-native";
import { Platform, Pressable } from "react-native";
import Animated, { FadeOut, ZoomIn } from "react-native-reanimated";

import { Icon } from "@/components/bloom";
import { useAppTheme } from "@/contexts/app-theme-context";

export function ThemeToggle() {
  const { toggleTheme, isLight } = useAppTheme();

  return (
    <Pressable
      onPress={() => {
        if (Platform.OS === "ios") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        toggleTheme();
      }}
      className="px-2.5"
    >
      {isLight ? (
        <Animated.View key="moon" entering={ZoomIn} exiting={FadeOut}>
          <Icon icon={Moon} size={20} color="ink" />
        </Animated.View>
      ) : (
        <Animated.View key="sun" entering={ZoomIn} exiting={FadeOut}>
          <Icon icon={Sun} size={20} color="ink" />
        </Animated.View>
      )}
    </Pressable>
  );
}
