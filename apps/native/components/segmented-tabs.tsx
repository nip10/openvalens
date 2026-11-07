import { cn } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { Icon, useStackedLayout } from "@/components/bloom";
import { CONTROL_MAX_FONT_SCALE } from "@/components/font-scale";

export type SegmentedTab<T extends string> = {
  value: T;
  label: string;
  icon: LucideIcon;
  /** The full name for screen readers when the visible label is short. */
  accessibilityLabel?: string;
  testID?: string;
};

/**
 * A few modes as one row of equal segments, the icon over a short label. At
 * the accessibility text sizes the segments wrap, three to a row.
 */
export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  disabled = false,
}: {
  tabs: readonly SegmentedTab<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const stacked = useStackedLayout();
  return (
    <View
      className={cn("flex-row gap-1 rounded-2xl bg-paper-2 p-1", stacked && "flex-wrap")}
      accessibilityRole="tablist"
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <Pressable
            key={tab.value}
            onPress={() => onChange(tab.value)}
            disabled={disabled}
            testID={tab.testID}
            accessibilityRole="tab"
            accessibilityLabel={tab.accessibilityLabel ?? tab.label}
            accessibilityState={{ selected, disabled }}
            className={cn(
              "min-h-14 items-center justify-center gap-1 rounded-xl border px-1 py-1.5 active:opacity-70",
              stacked ? "min-w-[31%] flex-grow" : "flex-1",
              selected ? "border-signal bg-card" : "border-transparent",
              disabled && "opacity-55",
            )}
          >
            <Icon icon={tab.icon} size={18} color={selected ? "signal" : "ink-3"} />
            <Text
              className={cn(
                "text-center font-sans text-xs leading-tight",
                selected ? "font-semibold text-ink" : "text-ink-2",
              )}
              numberOfLines={2}
              maxFontSizeMultiplier={CONTROL_MAX_FONT_SCALE}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
