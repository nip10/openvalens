import { cn } from "heroui-native";
import type { PropsWithChildren } from "react";
import { Pressable, Text, View } from "react-native";

type Density = "comfortable" | "compact";

type ListRowProps = {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  density?: Density;
  showDivider?: boolean;
  onPress?: () => void;
  className?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

export function ListRow({
  icon,
  title,
  subtitle,
  trailing,
  density = "comfortable",
  showDivider = false,
  onPress,
  className,
  accessibilityLabel,
  accessibilityHint,
}: ListRowProps) {
  const heightClass = density === "compact" ? "min-h-12" : "min-h-14";

  const content = (
    <View
      className={cn(
        "flex-row items-center gap-3 px-4",
        heightClass,
        showDivider && "border-b border-border",
        className,
      )}
    >
      <View className="h-10 w-10 items-center justify-center rounded-lg bg-muted">{icon}</View>
      <View className="flex-1">
        <Text className="text-base text-foreground">{title}</Text>
        {subtitle ? <Text className="text-sm text-muted-foreground">{subtitle}</Text> : null}
      </View>
      {trailing ? <View className="ml-2">{trailing}</View> : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        className="active:opacity-70"
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityHint={accessibilityHint}
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

type CardStackProps = PropsWithChildren<{
  title?: string;
  className?: string;
}>;

export function CardStack({ title, children, className }: CardStackProps) {
  return (
    <View className={cn("gap-3", className)}>
      {title ? <Text className="text-sm font-medium text-muted-foreground">{title}</Text> : null}
      {children}
    </View>
  );
}
