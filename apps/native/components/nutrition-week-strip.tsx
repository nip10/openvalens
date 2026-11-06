import { useLingui } from "@lingui/react/macro";
import { cn } from "heroui-native";
import { Pressable, Text, View } from "react-native";

import { CONTROL_MAX_FONT_SCALE } from "@/components/font-scale";
import { type DayMark, dayParts } from "@/lib/nutrition/week";

/**
 * Seven days with a quiet mark under each (#394): a filled dot when marked
 * complete, a ring when something was logged, nothing otherwise. The mark
 * never changes colour and never compares a day with a target.
 */
export function NutritionWeekStrip({
  days,
  selected,
  today,
  onSelect,
}: {
  days: readonly { localDate: string; mark: DayMark }[];
  selected: string;
  today: string;
  onSelect: (localDate: string) => void;
}) {
  const { t, i18n } = useLingui();
  return (
    <View className="flex-row gap-1" accessibilityRole="tablist">
      {days.map(({ localDate, mark }) => {
        const { weekday, day } = dayParts(localDate, i18n.locale);
        const isSelected = localDate === selected;
        const markText =
          mark === "complete"
            ? t`marked complete`
            : mark === "logged"
              ? t`food logged`
              : t`nothing logged`;
        const todayText = localDate === today ? t`today` : "";
        return (
          <Pressable
            key={localDate}
            onPress={() => onSelect(localDate)}
            testID={`week-day-${localDate}`}
            accessibilityRole="tab"
            accessibilityLabel={[weekday, day, todayText, markText].filter(Boolean).join(", ")}
            accessibilityState={{ selected: isSelected }}
            className={cn(
              "min-h-14 min-w-0 flex-1 items-center justify-center gap-0.5 rounded-2xl py-1 active:opacity-70",
              isSelected ? "bg-sidebar-accent" : "",
            )}
          >
            <Text
              className="font-sans text-[11px] font-semibold text-ink-3"
              numberOfLines={1}
              maxFontSizeMultiplier={CONTROL_MAX_FONT_SCALE}
            >
              {weekday}
            </Text>
            <Text
              className={cn(
                "font-sans text-base text-ink",
                (isSelected || localDate === today) && "font-semibold",
              )}
              maxFontSizeMultiplier={CONTROL_MAX_FONT_SCALE}
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {day}
            </Text>
            <View
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                mark === "complete" && "bg-ink-2",
                mark === "logged" && "border border-ink-2",
              )}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
