import { cn } from "heroui-native";
import { Pressable, Text, View } from "react-native";

import { CONTROL_MAX_FONT_SCALE } from "@/components/font-scale";

export type ScaleStep<T extends string> = { value: T; label: string };

/**
 * An ordered choice as one row: a track that fills up to the picked step, its
 * label under each step. Tapping the picked step again clears it.
 */
export function StepScale<T extends string>({
  steps,
  value,
  onChange,
  accessibilityLabel,
  testID,
}: {
  steps: readonly ScaleStep<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  const picked = steps.findIndex((step) => step.value === value);
  return (
    <View
      className="flex-row"
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {steps.map((step, index) => {
        const filled = index <= picked;
        const selected = index === picked;
        return (
          <Pressable
            key={step.value}
            onPress={() => onChange(selected ? null : step.value)}
            accessibilityRole="radio"
            accessibilityLabel={step.label}
            accessibilityState={{ checked: selected, selected }}
            testID={testID ? `${testID}-${step.value}` : undefined}
            className="min-h-11 flex-1 gap-2 py-1 active:opacity-70"
          >
            <View
              className={cn(
                "h-2",
                index === 0 && "rounded-l-full",
                index === steps.length - 1 && "rounded-r-full",
                index > 0 && "ml-0.5",
                filled ? "bg-heart" : "bg-rule-2",
              )}
            />
            <Text
              className={cn(
                "text-center font-sans text-xs",
                selected ? "font-semibold text-ink" : "text-ink-3",
              )}
              maxFontSizeMultiplier={CONTROL_MAX_FONT_SCALE}
            >
              {step.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
