import { Text, View } from "react-native";

import type { LabRangeBar } from "@/utils/lab-range-bar";

/**
 * A lab reading and the lab's printed range in one place: the value with its
 * unit, a neutral track with the range as a plain band and a marker at the
 * value, then the range text as recorded. One neutral colour throughout, and
 * no inside/outside wording, in line with never-add item 1 of the Legal and
 * clinical gate decisions. Without a bar (a text range, another unit) only
 * the value and the range text show.
 */
export function LabReading({
  valueText,
  rangeText,
  bar,
  testID,
}: {
  valueText: string;
  rangeText: string | null;
  bar: LabRangeBar | null;
  testID?: string;
}) {
  return (
    <View
      className="gap-2"
      accessible
      accessibilityLabel={rangeText ? `${valueText}. ${rangeText}` : valueText}
      testID={testID}
    >
      <Text
        className="font-sans text-lg font-semibold text-ink"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {valueText}
      </Text>
      {bar ? (
        <View className="mx-2 h-4 justify-center">
          <View className="h-2 overflow-hidden rounded-full bg-paper-2">
            <View
              className="absolute bottom-0 top-0 bg-rule-2"
              style={{ left: `${bar.bandStart}%`, width: `${bar.bandEnd - bar.bandStart}%` }}
            />
          </View>
          <View
            className="absolute h-4 w-4 rounded-full border-2 border-paper bg-ink-2"
            style={{ left: `${bar.marker}%`, marginLeft: -8 }}
          />
        </View>
      ) : null}
      {rangeText ? <Text className="font-sans text-sm text-ink-3">{rangeText}</Text> : null}
    </View>
  );
}
