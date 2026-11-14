import { useLingui } from "@lingui/react/macro";
import { TRACKER_TEMPLATE_COPY } from "@openvalens/api/presenters/trackers";
import type { TrackerTemplateId, TrackerType } from "@openvalens/trackers/model";
import { Pressable, Text, TextInput, View } from "react-native";

import { DecimalHint } from "@/components/decimal-hint";
import { useThemeColor } from "@/utils/theme";

export const TRACKER_INPUT_CLASS =
  "min-h-11 rounded-xl border border-rule-2 bg-sheet px-3 font-sans text-base text-ink";

/**
 * The value control for one tracker type (#441): a number with its unit, the
 * 1-5 self-rating as five buttons, yes/no, or a typed duration ("20 min",
 * "1:30", "45 s"). The parent parses `text` with `parseTrackerInput`.
 */
export function TrackerValueInput({
  label,
  type,
  unit,
  template,
  text,
  onText,
  testID,
}: {
  label: string;
  type: TrackerType;
  unit: string | null;
  template: TrackerTemplateId | null;
  text: string;
  onText: (text: string) => void;
  testID?: string;
}) {
  const { t, i18n } = useLingui();
  const placeholder = useThemeColor("ink-3");
  if (type === "scale" || type === "yes_no") {
    const options =
      type === "scale"
        ? ["1", "2", "3", "4", "5"].map((value) => ({ value, label: value }))
        : [
            { value: "yes", label: t`Yes` },
            { value: "no", label: t`No` },
          ];
    const copy = template ? TRACKER_TEMPLATE_COPY[template] : undefined;
    const low = copy?.scaleLow ? i18n._(copy.scaleLow) : null;
    const high = copy?.scaleHigh ? i18n._(copy.scaleHigh) : null;
    return (
      <View className="gap-2">
        <View accessibilityRole="radiogroup" accessibilityLabel={label} className="flex-row gap-2">
          {options.map((option) => {
            const selected = text === option.value;
            return (
              <Pressable
                key={option.value}
                testID={testID ? `${testID}-${option.value}` : undefined}
                onPress={() => onText(option.value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                className={`min-h-11 min-w-11 items-center justify-center rounded-xl border px-3 ${selected ? "border-signal bg-sidebar-accent" : "border-rule-2 bg-sheet"}`}
              >
                <Text
                  className={`font-sans text-base ${selected ? "font-semibold text-ink" : "text-ink-2"}`}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {type === "scale" ? (
          <Text className="font-sans text-sm text-ink-3">
            {low && high
              ? t`1 = ${low}, 5 = ${high}. Your own rating.`
              : t`From 1 to 5. Your own rating.`}
          </Text>
        ) : null}
      </View>
    );
  }
  return (
    <View className="gap-1">
      <View className="flex-row items-center gap-2">
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          value={text}
          onChangeText={onText}
          keyboardType={type === "number" ? "decimal-pad" : "default"}
          placeholder={type === "duration" ? t`20 min, 1:30 or 45 s` : undefined}
          placeholderTextColor={placeholder}
          autoCorrect={false}
          className={`${TRACKER_INPUT_CLASS} min-w-32 flex-1`}
        />
        {type === "number" && unit ? (
          <Text className="font-sans text-base text-ink-3">{unit}</Text>
        ) : null}
      </View>
      {type === "number" ? <DecimalHint value={text} /> : null}
    </View>
  );
}
