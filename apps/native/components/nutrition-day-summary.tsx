import type { NutrientKey, NutrientTotal } from "@openvalens/api/contracts/nutrition-diary";
import type { NutritionTargetWire } from "@openvalens/api/contracts/nutrition-targets";
import {
  MACRO_LETTERS,
  MACRO_SHORT_LABELS,
  ROW_MACRO_KEYS,
} from "@openvalens/api/presenters/nutrition-diary";
import {
  SUMMARY_COPY,
  SUMMARY_MODES,
  type SummaryMode,
  readTotalAgainstTarget,
} from "@openvalens/api/presenters/nutrition-targets";
import { useLingui } from "@lingui/react/macro";
import { cn } from "heroui-native";
import { Pressable, Text, View } from "react-native";

import { DISPLAY_MAX_FONT_SCALE, Sheet, useStackedLayout } from "@/components/bloom";
import { MACRO_TEXT } from "@/components/nutrition-macro-line";

const MACRO_DOT: Record<(typeof ROW_MACRO_KEYS)[number], string> = {
  proteinG: "bg-protein",
  carbohydrateG: "bg-carbs",
  fatG: "bg-fat",
};

/** "at least 100 g" may wrap, but never between the number and its unit. */
function keepUnitsAttached(text: string): string {
  return text.replace(/(\d) (?=(?:g|mg|kcal|kJ)\b)/g, "$1\u00a0");
}

/**
 * The day at a glance (#394): energy and P/C/F with each target written
 * beside its total ("1,450 of 1,700–2,100 kcal"). One tap switches to what
 * remains to the targets. Text only: no rings, no bars, no "met" highlight
 * (D1 in #390). Hide-numbers mode shows no number.
 */
export function NutritionDaySummary({
  title,
  totals,
  targets,
  mode,
  onMode,
  hideNumbers,
}: {
  title: string;
  totals: Record<NutrientKey, NutrientTotal>;
  targets: readonly NutritionTargetWire[];
  mode: SummaryMode;
  onMode: (mode: SummaryMode) => void;
  hideNumbers: boolean;
}) {
  const { i18n } = useLingui();
  const stacked = useStackedLayout();
  const read = (key: NutrientKey) =>
    readTotalAgainstTarget(
      key,
      totals[key],
      targets.find((target) => target.nutrient === key),
      mode,
      hideNumbers,
      i18n,
    );
  const energy = read("energyKcal");
  return (
    <Sheet className="gap-2 px-4 py-3" testID="day-summary">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="font-sans text-sm font-semibold text-ink-3" accessibilityRole="header">
          {title}
        </Text>
        <View
          className="flex-row rounded-full bg-paper-2 p-0.5"
          accessibilityRole="radiogroup"
          accessibilityLabel={i18n._(SUMMARY_COPY.modeLabel)}
        >
          {SUMMARY_MODES.map((option) => (
            <Pressable
              key={option}
              onPress={() => onMode(option)}
              testID={`day-summary-${option}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: mode === option }}
              className={cn(
                "min-h-11 justify-center rounded-full px-3",
                mode === option && "bg-card",
              )}
            >
              <Text
                className={cn(
                  "font-sans text-xs",
                  mode === option ? "font-semibold text-ink" : "text-ink-2",
                )}
              >
                {i18n._(SUMMARY_COPY[option])}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View
        accessible
        accessibilityLabel={energy.spoken}
        className="flex-row flex-wrap items-baseline gap-x-2"
      >
        <Text
          className="font-display text-[26px] font-semibold text-ink"
          style={{ fontVariant: ["tabular-nums"] }}
          maxFontSizeMultiplier={DISPLAY_MAX_FONT_SCALE}
        >
          {energy.figure}
        </Text>
        <Text className="font-sans text-sm text-ink-2">{energy.note}</Text>
      </View>
      <View className={stacked ? "gap-2" : "flex-row gap-2"}>
        {ROW_MACRO_KEYS.map((key) => {
          const reading = read(key);
          return (
            <View
              key={key}
              accessible
              accessibilityLabel={reading.spoken}
              className={cn("gap-0.5", !stacked && "min-w-0 flex-1")}
            >
              <View className="flex-row items-center gap-1.5">
                <View className={cn("h-2 w-2 rounded-full", MACRO_DOT[key])} />
                <Text
                  numberOfLines={1}
                  className={cn("shrink font-sans text-xs font-semibold", MACRO_TEXT[key])}
                >
                  {i18n._(MACRO_LETTERS[key])} · {i18n._(MACRO_SHORT_LABELS[key])}
                </Text>
              </View>
              <Text
                className="font-sans text-sm font-semibold text-ink"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {reading.figure}
              </Text>
              <Text className="font-sans text-xs text-ink-3">{keepUnitsAttached(reading.note)}</Text>
            </View>
          );
        })}
      </View>
    </Sheet>
  );
}
