import type { NutrientKey, NutrientTotal } from "@openvalens/api/contracts/nutrition-diary";
import type { NutritionTargetWire } from "@openvalens/api/contracts/nutrition-targets";
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
  formatTarget,
  targetBand,
  type TargetBand,
} from "@openvalens/api/presenters/nutrition-targets";
import { useLingui } from "@lingui/react/macro";
import { Beef, Droplet, Leaf, type LucideIcon, Wheat, Zap } from "lucide-react-native";
import { Text, View } from "react-native";

import { Details, InfoTip, Prose, Sheet, StatTile, TileRow } from "@/components/bloom";

/** The same icon per nutrient as the web tiles. */
const NUTRIENT_ICONS: Partial<Record<NutrientKey, LucideIcon>> = {
  energyKcal: Zap,
  proteinG: Beef,
  carbohydrateG: Wheat,
  fatG: Droplet,
  fiberG: Leaf,
};

/** Each macro's identity colour for its band's fill; energy and fibre take the food tone. */
const BAND_FILL: Partial<Record<NutrientKey, string>> = {
  proteinG: "bg-protein",
  carbohydrateG: "bg-carbs",
  fatG: "bg-fat",
};

/**
 * nutrition#10, as on the web: the target range shaded with a tick at each
 * edge, and a fill from 0 to today's total. Position only, never a verdict.
 */
function TargetBandBar({ band, nutrient }: { band: TargetBand; nutrient: NutrientKey }) {
  const pct = (value: number) => `${Math.round(value * 1000) / 10}%` as const;
  const edges = [band.bandStart, band.bandEnd].filter((edge) => edge > 0 && edge < 1);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={band.label}
      testID={`target-band-${nutrient}`}
      className="h-2 w-full rounded-full bg-paper-2"
    >
      <View
        className="absolute bottom-0 top-0 rounded-full bg-rule-2"
        style={{ left: pct(band.bandStart), width: pct(band.bandEnd - band.bandStart) }}
      />
      <View
        className={`absolute bottom-0 left-0 top-0 rounded-full ${BAND_FILL[nutrient] ?? "bg-food"}`}
        style={{ width: pct(band.position) }}
      />
      {edges.map((edge) => (
        <View
          key={edge}
          className="absolute -bottom-1 -top-1 w-0.5 rounded-full bg-ink-3"
          style={{ left: pct(edge), marginLeft: -1 }}
        />
      ))}
    </View>
  );
}

/** Tiles two to a row on a phone. */
function pairs<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += 2) rows.push(items.slice(index, index + 2));
  return rows;
}

/**
 * Day totals with per-nutrient coverage (Issue #79) and hide-numbers mode
 * (#80), matching the web view. `pending` marks a local preview that includes
 * queued offline changes; the server's totals replace it after sync. With
 * hide-numbers on every numeric value is replaced but coverage stays, so a
 * total is never read as a verdict and a day with nothing logged is never
 * shown as zero. A target that applies on the day is written beside its total
 * as text with a thin band under the figure (nutrition#10), never a ring; the
 * band is left out while numbers are hidden.
 */
export function NutritionDayTotals({
  totals,
  sources,
  pending,
  hideNumbers = false,
  targets = [],
  compact = false,
}: {
  totals: Record<NutrientKey, NutrientTotal>;
  sources: { fdc: number; off: number; custom: number; manual: number } | null;
  pending: boolean;
  hideNumbers?: boolean;
  targets?: readonly NutritionTargetWire[];
  compact?: boolean;
}) {
  const { t, i18n } = useLingui();
  const sourceLine = sources ? formatSources(sources, i18n) : null;
  return (
    <View className="gap-3" accessibilityLabel={i18n._(DIARY_COPY.totalsTitle)}>
      {compact ? (
        <Details
          summary={i18n._(DIARY_COPY.totalsTitle)}
          className="rounded-2xl border border-rule bg-card px-3 py-2"
        >
          <View className="flex-row flex-wrap gap-2 py-2">
            {SUMMARY_NUTRIENTS.map((key) => (
              <View key={key} className="min-w-[22%] flex-1 gap-0.5">
                <Text className="font-sans text-xs text-ink-3">
                  {i18n._(NUTRIENT_LABELS[key].label)}
                </Text>
                <Text className="font-sans text-sm font-semibold text-ink">
                  {displayTotalValue(key, totals[key], hideNumbers, i18n)}
                </Text>
                <Text className="font-sans text-xs text-ink-3">
                  {i18n._(formatCoverage(totals[key]))}
                </Text>
              </View>
            ))}
          </View>
          <View className="gap-3 pt-2">
            {pairs(SUMMARY_NUTRIENTS).map((row) => (
              <TileRow key={row.join("-")}>
                {row.map((key) => {
                  const total = totals[key];
                  const target = targets.find((item) => item.nutrient === key);
                  const targetText = target ? formatTarget(target, hideNumbers, i18n) : null;
                  const band = targetBand(key, total, target, hideNumbers, i18n);
                  return (
                    <View
                      key={key}
                      accessible
                      accessibilityLabel={describeDisplayedTotal(key, total, hideNumbers, i18n)}
                    >
                      <StatTile
                        icon={NUTRIENT_ICONS[key] ?? Zap}
                        tone="food"
                        label={i18n._(NUTRIENT_LABELS[key].label)}
                        value={displayTotalValue(key, total, hideNumbers, i18n)}
                        bar={band ? <TargetBandBar band={band} nutrient={key} /> : null}
                        note={
                          targetText
                            ? `${i18n._(formatCoverage(total))}\n${t`Target: ${targetText}`}`
                            : i18n._(formatCoverage(total))
                        }
                      />
                    </View>
                  );
                })}
              </TileRow>
            ))}
            {pending ? (
              <Text className="font-sans text-sm text-ink-3">
                {i18n._(DIARY_COPY.pendingTotals)}
              </Text>
            ) : null}
            <Text className="font-sans text-sm text-ink-3">
              {i18n._(
                TARGET_COPY.numbersHidden && hideNumbers
                  ? TARGET_COPY.numbersHidden
                  : DIARY_COPY.totalsNote,
              )}
            </Text>
            <Details summary={i18n._(DIARY_COPY.allNutrients)}>
              <Sheet className="gap-0 px-4 py-2">
                {ALL_NUTRIENTS.map((key, index) => (
                  <View
                    key={key}
                    className={`flex-row flex-wrap items-baseline justify-between gap-x-3 py-2 ${index > 0 ? "border-t border-rule" : ""}`}
                    accessible
                    accessibilityLabel={describeDisplayedTotal(key, totals[key], hideNumbers, i18n)}
                  >
                    <Text className="flex-1 font-sans text-sm text-ink">
                      {i18n._(NUTRIENT_LABELS[key].label)} ({i18n._(NUTRIENT_LABELS[key].unit)})
                    </Text>
                    <Text className="font-sans text-sm font-semibold text-ink">
                      {displayTotalValue(key, totals[key], hideNumbers, i18n)}
                    </Text>
                    <Text className="w-full font-sans text-xs text-ink-3">
                      {i18n._(formatCoverage(totals[key]))}
                    </Text>
                  </View>
                ))}
              </Sheet>
            </Details>
            <InfoTip label={t`About these totals`}>
              {sourceLine ? (
                <Prose>
                  {i18n._(DIARY_COPY.sourcesLabel)}: {sourceLine}
                </Prose>
              ) : null}
              <Prose>
                {i18n._(DIARY_COPY.totalsNote)} {i18n._(DIARY_COPY.unknownNote)}
              </Prose>
            </InfoTip>
          </View>
        </Details>
      ) : null}
      {!compact ? (
        <>
          {pairs(SUMMARY_NUTRIENTS).map((row) => (
            <TileRow key={row.join("-")}>
              {row.map((key) => {
                const total = totals[key];
                const target = targets.find((item) => item.nutrient === key);
                const targetText = target ? formatTarget(target, hideNumbers, i18n) : null;
                const band = targetBand(key, total, target, hideNumbers, i18n);
                return (
                  <View
                    key={key}
                    accessible
                    accessibilityLabel={describeDisplayedTotal(key, total, hideNumbers, i18n)}
                  >
                    <StatTile
                      icon={NUTRIENT_ICONS[key] ?? Zap}
                      tone="food"
                      label={i18n._(NUTRIENT_LABELS[key].label)}
                      value={displayTotalValue(key, total, hideNumbers, i18n)}
                      bar={band ? <TargetBandBar band={band} nutrient={key} /> : null}
                      note={
                        targetText
                          ? `${i18n._(formatCoverage(total))}\n${t`Target: ${targetText}`}`
                          : i18n._(formatCoverage(total))
                      }
                    />
                  </View>
                );
              })}
            </TileRow>
          ))}
          {pending ? (
            <Text className="font-sans text-sm text-ink-3">{i18n._(DIARY_COPY.pendingTotals)}</Text>
          ) : null}
          {hideNumbers ? (
            <Text className="font-sans text-sm text-ink-3">
              {i18n._(TARGET_COPY.numbersHidden)}
            </Text>
          ) : null}
          <View className="flex-row items-start gap-2">
            <Details summary={i18n._(DIARY_COPY.allNutrients)} className="flex-1">
              <Sheet className="gap-0 px-4 py-2">
                {ALL_NUTRIENTS.map((key, index) => (
                  <View
                    key={key}
                    className={`flex-row flex-wrap items-baseline justify-between gap-x-3 py-2 ${index > 0 ? "border-t border-rule" : ""}`}
                    accessible
                    accessibilityLabel={describeDisplayedTotal(key, totals[key], hideNumbers, i18n)}
                  >
                    <Text className="flex-1 font-sans text-sm text-ink">
                      {i18n._(NUTRIENT_LABELS[key].label)} ({i18n._(NUTRIENT_LABELS[key].unit)})
                    </Text>
                    <Text
                      className="font-sans text-sm font-semibold text-ink"
                      style={{ fontVariant: ["tabular-nums"] }}
                    >
                      {displayTotalValue(key, totals[key], hideNumbers, i18n)}
                    </Text>
                    <Text className="w-full font-sans text-xs text-ink-3">
                      {i18n._(formatCoverage(totals[key]))}
                    </Text>
                  </View>
                ))}
              </Sheet>
            </Details>
            <View className="min-h-11 justify-center">
              <InfoTip label={t`About these totals`}>
                {sourceLine ? (
                  <Prose>
                    {i18n._(DIARY_COPY.sourcesLabel)}: {sourceLine}
                  </Prose>
                ) : null}
                <Prose>
                  {i18n._(DIARY_COPY.totalsNote)} {i18n._(DIARY_COPY.unknownNote)}
                </Prose>
              </InfoTip>
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}
