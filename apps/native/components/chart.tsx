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
  const every = Math.max(1, Math.ceil(n / 5));
  // Every few points get a label, centred on the point and wide enough for
  // "Yesterday" or "28 Sep" (gifted-charts otherwise clips to the spacing).
  const points = data.map((point, index) => {
    const labelled = index % every === 0 || (index === n - 1 && (n - 1) % every >= every / 2);
    return {
      value: point.value,
      label: labelled ? point.label : "",
      labelWidth: 64,
      labelTextStyle: { textAlign: "center" as const, marginLeft: -26 },
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
