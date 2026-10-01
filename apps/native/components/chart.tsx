import { useThemeColor } from "@/utils/theme";
import { type ComponentProps, type ReactNode } from "react";
import { Text, View } from "react-native";
import { BarChart as RNBarChart, LineChart as RNLineChart } from "react-native-gifted-charts";

function useChartColors() {
  return {
    chart1: useThemeColor("chart-1"),
    chart2: useThemeColor("chart-2"),
    chart3: useThemeColor("chart-3"),
    chart4: useThemeColor("chart-4"),
    chart5: useThemeColor("chart-5"),
  };
}

const defaultPointerConfig = {
  pointerStripColor: "current",
  pointerColor: "current",
  pointerLabelComponent: (items: { value?: number | string }[]): ReactNode => {
    const value = items[0]?.value;
    if (value === undefined || value === null) return null;
    return (
      <View className="rounded-md bg-background px-2 py-1 shadow">
        <Text className="font-mono text-sm text-foreground">{String(value)}</Text>
      </View>
    );
  },
};

export function LineChart(props: ComponentProps<typeof RNLineChart>) {
  const colors = useChartColors();
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");

  const pointerConfig = props.pointerConfig ?? {
    ...defaultPointerConfig,
    pointerStripColor: muted,
    pointerColor: props.color ?? colors.chart1,
  };

  return (
    <View className="overflow-hidden rounded-xl">
      <RNLineChart
        {...props}
        color={props.color ?? colors.chart1}
        dataPointsColor={props.dataPointsColor ?? colors.chart1}
        xAxisColor={props.xAxisColor ?? muted}
        yAxisColor={props.yAxisColor ?? muted}
        rulesColor={props.rulesColor ?? muted}
        xAxisLabelTextStyle={props.xAxisLabelTextStyle ?? { color: foreground }}
        yAxisTextStyle={props.yAxisTextStyle ?? { color: foreground }}
        yAxisLabelPrefix={props.yAxisLabelPrefix ?? ""}
        yAxisLabelSuffix={props.yAxisLabelSuffix ?? ""}
        hideRules={props.hideRules ?? false}
        pointerConfig={pointerConfig}
      />
    </View>
  );
}

export function BarChart(props: ComponentProps<typeof RNBarChart>) {
  const colors = useChartColors();
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");

  return (
    <View className="overflow-hidden rounded-xl">
      <RNBarChart
        {...props}
        barWidth={props.barWidth ?? 22}
        frontColor={props.frontColor ?? colors.chart1}
        xAxisColor={props.xAxisColor ?? muted}
        yAxisColor={props.yAxisColor ?? muted}
        rulesColor={props.rulesColor ?? muted}
        xAxisLabelTextStyle={props.xAxisLabelTextStyle ?? { color: foreground }}
        yAxisTextStyle={props.yAxisTextStyle ?? { color: foreground }}
        yAxisLabelPrefix={props.yAxisLabelPrefix ?? ""}
        yAxisLabelSuffix={props.yAxisLabelSuffix ?? ""}
        hideRules={props.hideRules ?? false}
      />
    </View>
  );
}
