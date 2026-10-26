import { type ComponentProps, type ReactNode, useState } from "react";
import { Text, View } from "react-native";
import { BarChart as RNBarChart, LineChart as RNLineChart } from "react-native-gifted-charts";

import { type Tone, useToneColor } from "@/components/bloom";
import { BODY_FONT } from "@/components/fonts";
import { useThemeColor } from "@/utils/theme";

/**
 * Bloom charts (DESIGN.md): one series in its measure's tone, a soft area
 * fill fading to nothing, a thick curved line, dashed hairline rules, no axis
 * lines, quiet labels. Pass `tone` for the measure; explicit colour props
 * still win, so existing screens keep working.
 */
type ToneProp = { tone?: Tone };

function useChartChrome() {
  const ink3 = useThemeColor("ink-3");
  const rule = useThemeColor("rule");
  const sheet = useThemeColor("sheet");
  const ink = useThemeColor("ink");
  return { ink3, rule, sheet, ink };
}

function pointerConfigFor(color: string, stripColor: string, sheet: string, ink: string) {
  return {
    pointerStripColor: stripColor,
    pointerColor: color,
    pointerLabelComponent: (items: { value?: number | string }[]): ReactNode => {
      const value = items[0]?.value;
      if (value === undefined || value === null) return null;
      return (
        <View
          className="rounded-xl border border-rule px-2 py-1"
          style={{ backgroundColor: sheet }}
        >
          <Text className="font-sans text-sm font-semibold" style={{ color: ink }}>
            {String(value)}
          </Text>
        </View>
      );
    },
  };
}

export function LineChart({
  tone = "signal",
  ...props
}: ComponentProps<typeof RNLineChart> & ToneProp) {
  const { color: toneColor } = useToneColor(tone);
  const { ink3, rule, sheet, ink } = useChartChrome();
  const color = props.color ?? toneColor;
  const labelStyle = { color: ink3, fontFamily: BODY_FONT, fontSize: 10 };

  return (
    <View className="overflow-hidden rounded-2xl">
      <RNLineChart
        areaChart
        curved
        hideDataPoints
        thickness={3}
        startFillColor={color}
        endFillColor={color}
        startOpacity={0.28}
        endOpacity={0}
        rulesType="dashed"
        dashWidth={4}
        dashGap={6}
        isAnimated={false}
        {...props}
        color={color}
        dataPointsColor={props.dataPointsColor ?? color}
        xAxisColor={rule}
        yAxisColor="transparent"
        yAxisThickness={0}
        xAxisThickness={props.xAxisThickness ?? 0}
        rulesColor={rule}
        xAxisLabelTextStyle={{ ...labelStyle, ...props.xAxisLabelTextStyle, color: ink3 }}
        yAxisTextStyle={{ ...labelStyle, ...props.yAxisTextStyle, color: ink3 }}
        yAxisLabelPrefix={props.yAxisLabelPrefix ?? ""}
        yAxisLabelSuffix={props.yAxisLabelSuffix ?? ""}
        hideRules={props.hideRules ?? false}
        pointerConfig={props.pointerConfig ?? pointerConfigFor(color, rule, sheet, ink)}
      />
    </View>
  );
}

export function BarChart({
  tone = "signal",
  ...props
}: ComponentProps<typeof RNBarChart> & ToneProp) {
  const { color: toneColor } = useToneColor(tone);
  const { ink3, rule } = useChartChrome();
  const labelStyle = { color: ink3, fontFamily: BODY_FONT, fontSize: 10 };

  return (
    <View className="overflow-hidden rounded-2xl">
      <RNBarChart
        barBorderRadius={8}
        rulesType="dashed"
        dashWidth={4}
        dashGap={6}
        isAnimated={false}
        {...props}
        barWidth={props.barWidth ?? 16}
        frontColor={props.frontColor ?? toneColor}
        xAxisColor={rule}
        yAxisColor="transparent"
        yAxisThickness={0}
        xAxisThickness={props.xAxisThickness ?? 0}
        rulesColor={rule}
        xAxisLabelTextStyle={{ ...labelStyle, ...props.xAxisLabelTextStyle, color: ink3 }}
        yAxisTextStyle={{ ...labelStyle, ...props.yAxisTextStyle, color: ink3 }}
        yAxisLabelPrefix={props.yAxisLabelPrefix ?? ""}
        yAxisLabelSuffix={props.yAxisLabelSuffix ?? ""}
        hideRules={props.hideRules ?? false}
      />
    </View>
  );
}

type TrendPoint = { value: number; label: string };

/**
 * The one chart a screen leads with: a measure over time in its tone, sized
 * to its card. Labels thin out to about five on the x axis; `target` draws a
 * dashed ink-3 reference line (a target is a line, never a progress bar).
 */
export function TrendChart({
  data,
  tone,
  height = 180,
  minValue,
  maxValue,
  formatYLabel,
  target,
  noOfSections = 4,
  bars = false,
}: {
  data: readonly TrendPoint[];
  tone: Tone;
  height?: number;
  minValue?: number;
  maxValue?: number;
  formatYLabel?: (label: string) => string;
  target?: number | null;
  noOfSections?: number;
  bars?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const ink3 = useThemeColor("ink-3");
  const yLabelWidth = 36;
  const n = data.length;
  // Four labels spread evenly from the first point to the last.
  const labelled = new Set(n <= 1 ? [0] : [0, 1, 2, 3].map((k) => Math.round((k * (n - 1)) / 3)));
  const points = data.map((point, index) => {
    const align = index === 0 ? "left" : index === n - 1 ? "right" : "center";
    return {
      value: point.value,
      labelComponent: labelled.has(index)
        ? () => <AxisLabel text={point.label} align={align} color={ink3} nudge={bars ? -12 : 0} />
        : undefined,
    };
  });
  const plotWidth = Math.max(0, width - yLabelWidth - 16);
  const offset = minValue ?? 0;
  const top = maxValue ?? Math.max(1, ...data.map((p) => p.value));
  const reference =
    target !== null && target !== undefined && Number.isFinite(target)
      ? {
          showReferenceLine1: true,
          referenceLine1Position: target - offset,
          referenceLine1Config: {
            color: ink3,
            dashWidth: 4,
            dashGap: 4,
            thickness: 1,
            type: "dashed",
          },
        }
      : {};

  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ minHeight: height + 30 }}
    >
      {width > 0 && n > 0 ? (
        bars ? (
          <BarChart
            tone={tone}
            data={points}
            height={height}
            width={plotWidth}
            yAxisLabelWidth={yLabelWidth}
            barWidth={Math.max(4, Math.min(16, (plotWidth / Math.max(1, n)) * 0.55))}
            spacing={Math.max(2, (plotWidth / Math.max(1, n)) * 0.45)}
            initialSpacing={6}
            endSpacing={6}
            maxValue={top - offset}
            yAxisOffset={offset || undefined}
            noOfSections={noOfSections}
            formatYLabel={formatYLabel}
            disableScroll
            {...reference}
          />
        ) : (
          <LineChart
            tone={tone}
            data={points}
            height={height}
            width={plotWidth}
            yAxisLabelWidth={yLabelWidth}
            spacing={n > 1 ? (plotWidth - 12) / (n - 1) : plotWidth}
            initialSpacing={6}
            endSpacing={6}
            maxValue={top - offset}
            yAxisOffset={offset || undefined}
            noOfSections={noOfSections}
            formatYLabel={formatYLabel}
            disableScroll
            {...reference}
          />
        )
      ) : null}
    </View>
  );
}

/**
 * An x-axis label wider than the bar or point spacing, centred on its point
 * (the first and last align to the plot edge so they are not cut off).
 */
function AxisLabel({
  text,
  align,
  color,
  nudge = 0,
}: {
  text: string;
  align: "left" | "center" | "right";
  color: string;
  /** Extra shift for the last label (bars are drawn from their left edge). */
  nudge?: number;
}) {
  const width = 72;
  const marginLeft =
    align === "left" ? -2 : align === "right" ? -width + 8 + nudge : -width / 2 + 4;
  return (
    <Text
      numberOfLines={1}
      style={{
        width,
        marginLeft,
        textAlign: align,
        color,
        fontFamily: BODY_FONT,
        fontSize: 10,
      }}
    >
      {text}
    </Text>
  );
}
