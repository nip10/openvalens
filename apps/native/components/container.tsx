import { cn } from "heroui-native";
import { type PropsWithChildren, type Ref } from "react";
import { ScrollView, View, type ScrollViewProps, type ViewProps } from "react-native";
import Animated, { type AnimatedProps } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const AnimatedView = Animated.createAnimatedComponent(View);

type Props = AnimatedProps<ViewProps> & {
  className?: string;
  isScrollable?: boolean;
  scrollViewProps?: Omit<ScrollViewProps, "contentContainerStyle">;
  scrollRef?: Ref<ScrollView>;
};

export function Container({
  children,
  className,
  isScrollable = true,
  scrollViewProps,
  scrollRef,
  ...props
}: PropsWithChildren<Props>) {
  const insets = useSafeAreaInsets();

  return (
    <AnimatedView
      className={cn("flex-1 bg-background", className)}
      style={{
        paddingBottom: insets.bottom,
      }}
      {...props}
    >
      {isScrollable ? (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          {...scrollViewProps}
        >
          {children}
        </ScrollView>
      ) : (
        <View className="flex-1">{children}</View>
      )}
    </AnimatedView>
  );
}
