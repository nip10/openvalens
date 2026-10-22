import type { NutrientKey, NutrientTotal } from "@openvalens/api/contracts/nutrition-diary";
import {
  ALL_NUTRIENTS,
  DIARY_COPY,
  NUTRIENT_LABELS,
  SUMMARY_NUTRIENTS,
  formatCoverage,
  formatSources,
} from "@openvalens/api/presenters/nutrition-diary";
import {
  TARGET_COPY,
  describeDisplayedTotal,
  displayTotalValue,
} from "@openvalens/api/presenters/nutrition-targets";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

/**
 * Day totals with per-nutrient coverage (Issue #79) and hide-numbers mode
 * (#80), matching the web view. `pending` marks a local preview that includes
 * queued offline changes; the server's totals replace it after sync. With
 * hide-numbers on every numeric value is replaced but coverage stays, so a
 * total is never read as a verdict and a day with nothing logged is never
 * shown as zero.
 */
export function NutritionDayTotals({
  totals,
  sources,
  pending,
  hideNumbers = false,
}: {
  totals: Record<NutrientKey, NutrientTotal>;
  sources: { fdc: number; off: number; custom: number; manual: number } | null;
  pending: boolean;
  hideNumbers?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const sourceLine = sources ? formatSources(sources) : null;
  return (
    <View className="gap-3" accessibilityLabel={DIARY_COPY.totalsTitle}>
      <View className="flex-row flex-wrap gap-4">
        {SUMMARY_NUTRIENTS.map((key) => (
          <View
            key={key}
            className="gap-0.5"
            accessible
            accessibilityLabel={describeDisplayedTotal(key, totals[key], hideNumbers)}
          >
            <Text className="text-xs text-muted-foreground">{NUTRIENT_LABELS[key].label}</Text>
            <Text className="font-mono text-sm text-foreground">
              {displayTotalValue(key, totals[key], hideNumbers)}
            </Text>
            <Text className="text-xs text-muted-foreground">{formatCoverage(totals[key])}</Text>
          </View>
        ))}
      </View>
      <Pressable
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        className="min-h-11 justify-center"
      >
        <Text className="text-sm text-muted-foreground underline">{DIARY_COPY.allNutrients}</Text>
      </Pressable>
      {expanded ? (
        <View className="gap-1">
          {ALL_NUTRIENTS.map((key) => (
            <View
              key={key}
              className="flex-row flex-wrap justify-between gap-1 border-t border-border py-1"
              accessible
              accessibilityLabel={describeDisplayedTotal(key, totals[key], hideNumbers)}
            >
              <Text className="flex-1 text-sm text-foreground">
                {NUTRIENT_LABELS[key].label} ({NUTRIENT_LABELS[key].unit})
              </Text>
              <Text className="font-mono text-sm text-foreground">
                {displayTotalValue(key, totals[key], hideNumbers)}
              </Text>
              <Text className="w-full text-left text-xs text-muted-foreground sm:w-36 sm:text-right">
                {formatCoverage(totals[key])}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {pending ? (
        <Text className="text-xs text-muted-foreground">{DIARY_COPY.pendingTotals}</Text>
      ) : null}
      {hideNumbers ? (
        <Text className="text-xs text-muted-foreground">{TARGET_COPY.numbersHidden}</Text>
      ) : null}
      {sourceLine ? (
        <Text className="text-xs text-muted-foreground">
          {DIARY_COPY.sourcesLabel}: {sourceLine}
        </Text>
      ) : null}
      <Text className="text-xs text-muted-foreground">
        {DIARY_COPY.totalsNote} {DIARY_COPY.unknownNote}
      </Text>
    </View>
  );
}
