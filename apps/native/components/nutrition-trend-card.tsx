import {
  ENERGY_ESTIMATE_COPY,
  TREND_CARD_COPY,
  presentEnergyEstimate,
  presentTrendEstimate,
  presentTrendWeight,
} from "@openvalens/api/presenters/energy-estimate";
import { shiftLocalDate } from "@openvalens/api/presenters/nutrition-diary";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Gauge } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { DISPLAY_MAX_FONT_SCALE, InfoTip, Prose, Section, StatusPill } from "@/components/bloom";
import { orpc } from "@/utils/orpc";

/**
 * The Food tab's trend card (#395): the experimental expenditure estimate
 * (#76) and the trend weight (#87), each with how it was worked out. Read
 * only: estimates never change a target; proposals stay on Nutrition targets.
 * Not shown in hide-numbers mode, before the preference is known, or while
 * energy targets are off; the server also withholds it for anyone not
 * confirmed adult.
 */
export function NutritionTrendCard({
  scope,
  today,
  hideNumbers,
  preferenceKnown,
  energyOff,
}: {
  scope: string | null;
  today: string;
  hideNumbers: boolean;
  preferenceKnown: boolean;
  energyOff: boolean;
}) {
  const { t, i18n } = useLingui();
  const visible = Boolean(scope && preferenceKnown && !hideNumbers && !energyOff);
  const estimateOptions = orpc.nutritionEnergy.estimate.queryOptions({ input: { to: today } });
  const estimate = useQuery({
    ...estimateOptions,
    queryKey: [...estimateOptions.queryKey, { offlineScope: scope }],
    enabled: visible,
    retry: false,
  });
  const trendOptions = orpc.body.weightTrend.queryOptions({
    input: { from: shiftLocalDate(today, -27), to: today },
  });
  const trend = useQuery({
    ...trendOptions,
    queryKey: [...trendOptions.queryKey, { offlineScope: scope }],
    enabled: visible,
    retry: false,
  });
  if (!visible) return null;
  const status = estimate.data?.status;
  // Withheld by the server (not confirmed adult, off, hidden): say nothing.
  if (status === "adults_only" || status === "off" || status === "hidden") return null;
  const display = estimate.data ? presentTrendEstimate(estimate.data, false, i18n) : null;
  const method = estimate.data ? presentEnergyEstimate(estimate.data, false, i18n) : null;
  const reasons = estimate.data?.status === "no_estimate" ? estimate.data.reasonNotes : [];
  const weight = trend.data ? presentTrendWeight(trend.data, false, i18n) : null;
  return (
    <Section icon={Gauge} tone="food" sheet title={i18n._(TREND_CARD_COPY.title)}>
      <View className="gap-1" testID="trend-card-estimate">
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <Text
            className="font-display text-base font-semibold text-ink"
            accessibilityRole="header"
          >
            {i18n._(TREND_CARD_COPY.expenditure)}
          </Text>
          <StatusPill tone="neutral">{i18n._(TREND_CARD_COPY.experimental)}</StatusPill>
        </View>
        {estimate.isPending ? (
          <Text className="font-sans text-sm text-ink-3">{t`Loading estimate…`}</Text>
        ) : estimate.isError ? (
          <Text className="font-sans text-sm text-ink-2">{i18n._(ENERGY_ESTIMATE_COPY.error)}</Text>
        ) : display ? (
          <>
            <View className="flex-row flex-wrap items-baseline gap-x-2">
              <Text
                className="font-display text-[34px] font-semibold text-ink"
                style={{ fontVariant: ["tabular-nums"] }}
                maxFontSizeMultiplier={DISPLAY_MAX_FONT_SCALE}
              >
                {display.figure}
              </Text>
              <Text className="font-sans text-sm text-ink-2">{t`kcal a day`}</Text>
            </View>
            <Text className="font-sans text-sm text-ink-2">{display.range}</Text>
            <Text className="font-sans text-sm text-ink-3">{display.basis}</Text>
          </>
        ) : (
          <>
            <Text className="font-sans text-sm text-ink-2">
              {i18n._(ENERGY_ESTIMATE_COPY.unavailable)}
            </Text>
            {reasons.map((note) => (
              <Text key={note} className="font-sans text-sm text-ink-3">
                {note}
              </Text>
            ))}
          </>
        )}
        {method ? (
          <View className="min-h-11 flex-row items-center gap-1">
            <Text className="font-sans text-sm text-ink-2">
              {i18n._(TREND_CARD_COPY.howCalculated)}
            </Text>
            <InfoTip label={i18n._(TREND_CARD_COPY.howCalculated)}>
              <Prose>{method.window}</Prose>
              {method.notes.map((note) => (
                <Prose key={note}>{note}</Prose>
              ))}
            </InfoTip>
          </View>
        ) : null}
      </View>
      <View className="gap-1 border-t border-rule pt-3" testID="trend-card-weight">
        <Text className="font-display text-base font-semibold text-ink" accessibilityRole="header">
          {i18n._(TREND_CARD_COPY.trendWeight)}
        </Text>
        {weight ? (
          <>
            <View className="flex-row flex-wrap items-baseline gap-x-2">
              <Text
                className="font-display text-[28px] font-semibold text-ink"
                style={{ fontVariant: ["tabular-nums"] }}
                maxFontSizeMultiplier={DISPLAY_MAX_FONT_SCALE}
              >
                {weight.figure}
              </Text>
              <Text className="font-sans text-sm text-ink-2">kg</Text>
            </View>
            {weight.change ? (
              <Text className="font-sans text-sm text-ink-3">{weight.change}</Text>
            ) : null}
          </>
        ) : (
          <Text className="font-sans text-sm text-ink-3">
            {trend.isPending ? t`Loading…` : i18n._(TREND_CARD_COPY.noTrend)}
          </Text>
        )}
      </View>
      <Text className="font-sans text-xs text-ink-3">{i18n._(TREND_CARD_COPY.reference)}</Text>
      <Link href="/nutrition-targets" asChild>
        <Pressable accessibilityRole="link" className="min-h-11 justify-center">
          <Text className="font-sans text-sm font-semibold text-signal">
            {i18n._(TREND_CARD_COPY.suggestionsLink)}
          </Text>
        </Pressable>
      </Link>
    </Section>
  );
}
