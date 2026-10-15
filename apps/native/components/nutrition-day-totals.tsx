import type { NutrientKey, NutrientTotal } from "@openvalens/api/contracts/nutrition-diary";
import {
  ALL_NUTRIENTS,
  DIARY_COPY,
  NUTRIENT_LABELS,
  SUMMARY_NUTRIENTS,
  describeNutrientTotal,
  formatCoverage,
  formatSources,
  formatTotalValue,
} from "@openvalens/api/presenters/nutrition-diary";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

/**
 * Day totals with per-nutrient coverage (Issue #79), matching the web view.
 * `pending` marks a local preview that includes queued offline changes; the
 * server's totals replace it after sync. Unknown is never shown as 0.
 */
export function NutritionDayTotals({
  totals,
  sources,
  pending,
}: {
  totals: Record<NutrientKey, NutrientTotal>;
  sources: { fdc: number; off: number; custom: number; manual: number } | null;
  pending: boolean;
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
            accessibilityLabel={describeNutrientTotal(key, totals[key])}
          >
            <Text className="text-xs text-muted-foreground">{NUTRIENT_LABELS[key].label}</Text>
            <Text className="font-mono text-sm text-foreground">
              {formatTotalValue(key, totals[key])}
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
              className="flex-row justify-between gap-3 border-t border-border py-1"
              accessible
              accessibilityLabel={describeNutrientTotal(key, totals[key])}
            >
              <Text className="flex-1 text-sm text-foreground">
                {NUTRIENT_LABELS[key].label} ({NUTRIENT_LABELS[key].unit})
              </Text>
              <Text className="font-mono text-sm text-foreground">
                {formatTotalValue(key, totals[key])}
              </Text>
              <Text className="w-36 text-right text-xs text-muted-foreground">
                {formatCoverage(totals[key])}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {pending ? (
        <Text className="text-xs text-muted-foreground">{DIARY_COPY.pendingTotals}</Text>
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
