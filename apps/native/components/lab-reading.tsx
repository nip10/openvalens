import { Text, View } from "react-native";

import type { LabRangeBar } from "@/utils/lab-range-bar";

/**
 * A lab reading and the lab's printed range in one place: the value with its
 * unit, a neutral track with the range as a plain band and a marker at the
 * value, then the range text as recorded. A reading outside the lab's range
 * gets a warning marker and an "Above range" / "Below range" pill (`flag`;
 * the owner reopened never-add item 1 for this on 2026-11-16). Without a bar
 * (a text range, another unit) only the value and the range text show.
 */
export function LabReading({
  valueText,
  rangeText,
  bar,
  flag = null,
  testID,
}: {
  valueText: string;
  rangeText: string | null;
  bar: LabRangeBar | null;
  /** "Above range" / "Below range" when the reading sits outside the lab's range. */
  flag?: string | null;
  testID?: string;
}) {
  return (
    <View
      className="gap-2"
      accessible
      accessibilityLabel={[valueText, flag, rangeText].filter(Boolean).join(". ")}
      testID={testID}
    >
      <View className="flex-row flex-wrap items-center gap-2">
        <Text
          className="font-sans text-lg font-semibold text-ink"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {valueText}
        </Text>
        {flag ? (
          <View
            className="rounded-full bg-warning/15 px-2 py-0.5"
            testID={testID ? `${testID}-flag` : undefined}
          >
            <Text className="font-sans text-xs font-medium text-warning">{flag}</Text>
          </View>
        ) : null}
      </View>
      {bar ? (
        <View className="mx-2 h-4 justify-center">
          <View className="h-2 overflow-hidden rounded-full bg-paper-2">
            <View
              className="absolute bottom-0 top-0 bg-rule-2"
              style={{ left: `${bar.bandStart}%`, width: `${bar.bandEnd - bar.bandStart}%` }}
            />
          </View>
          <View
            className={`absolute h-4 w-4 rounded-full border-2 border-paper ${flag ? "bg-warning" : "bg-ink-2"}`}
            style={{ left: `${bar.marker}%`, marginLeft: -8 }}
          />
        </View>
      ) : null}
      {rangeText ? <Text className="font-sans text-sm text-ink-3">{rangeText}</Text> : null}
    </View>
  );
}
