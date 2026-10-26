import type { MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";
import {
  formatClockTime,
  formatSleepDuration,
  formatSleepEfficiency,
  lastNightStages,
  sleepSeries,
  sleepStatusLabel,
  sleepStatusTone,
} from "@openvalens/api/presenters/sleep";
import { useQuery } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { CalendarDays, Hourglass, Moon, Target, TrendingUp } from "lucide-react-native";
import { useMemo } from "react";
import { RefreshControl, Text, View } from "react-native";

import {
  Details,
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  Section,
  Sheet,
  StatTile,
  StatusPill,
  TileRow,
  ToneIcon,
  useToneColor,
  withAlpha,
} from "@/components/bloom";
import { TrendChart } from "@/components/chart";
import { Container } from "@/components/container";
import { friendlyDate, pillTone } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

const TREND_WINDOW_DAYS = 30;

type SleepStatus = Parameters<typeof sleepStatusTone>[0];

function SleepStatusPill({ status }: { status: SleepStatus }) {
  const { i18n } = useLingui();
  return (
    <StatusPill tone={pillTone(sleepStatusTone(status))}>
      {i18n._(sleepStatusLabel(status))}
    </StatusPill>
  );
}

/** Stage colours: the deeper the sleep, the stronger the ink (as on web). */
function useStageColours() {
  const { color: sleep } = useToneColor("sleep");
  const { color: steps } = useToneColor("steps");
  const paper3 = useThemeColor("paper-3");
  return (stage: string): string => {
    switch (stage) {
      case "deep":
        return sleep;
      case "rem":
        return withAlpha(sleep, 0.6);
      case "light":
        return withAlpha(sleep, 0.3);
      case "awake":
        return steps;
      default:
        return paper3;
    }
  };
}

function StageBars({
  stages,
}: {
  stages: { stage: string; label: MessageDescriptor; minutes: number }[];
}) {
  const { t, i18n } = useLingui();
  const colorFor = useStageColours();
  const total = stages.reduce((sum, s) => sum + s.minutes, 0);

  if (total === 0) {
    return <Text className="font-sans text-sm text-ink-3">{t`No stage data.`}</Text>;
  }

  return (
    <View className="gap-3">
      <View
        className="h-4 flex-row gap-1 overflow-hidden rounded-full"
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${t`Stages`}: ${stages
          .map((entry) => `${i18n._(entry.label)} ${formatSleepDuration(entry.minutes)}`)
          .join(", ")}`}
      >
        {stages.map((entry) => (
          <View
            key={entry.stage}
            className="h-full rounded-full"
            style={{
              backgroundColor: colorFor(entry.stage),
              width: `${(entry.minutes / total) * 100}%`,
            }}
          />
        ))}
      </View>
      <View className="flex-row flex-wrap gap-y-2">
        {stages.map((entry) => (
          <View key={entry.stage} className="w-1/2 gap-0.5 pr-2">
            <View className="flex-row items-center gap-1.5">
              <View
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: colorFor(entry.stage) }}
              />
              <Text className="font-sans text-sm text-ink-3">{i18n._(entry.label)}</Text>
            </View>
            <Text
              className="font-sans text-base font-semibold text-ink"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {formatSleepDuration(entry.minutes)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function SleepScreen() {
  const foreground = useThemeColor("foreground");
  const { t, i18n } = useLingui();
  const windowDays = TREND_WINDOW_DAYS;

  const summary = useQuery(orpc.sleep.summary.queryOptions({ input: { days: TREND_WINDOW_DAYS } }));

  const series = useMemo(() => (summary.data ? sleepSeries(summary.data) : []), [summary.data]);

  if (summary.isPending)
    return (
      <Container>
        <Page>
          <PageHeader title={t`Sleep`} />
          <Sheet className="h-48" />
          <TileRow>
            <Sheet className="h-28" />
            <Sheet className="h-28" />
          </TileRow>
        </Page>
      </Container>
    );

  if (summary.isError || !summary.data)
    return (
      <Container>
        <Page>
          <PageHeader title={t`Sleep`} />
          <ErrorState
            title={t`Could not load sleep.`}
            action={
              <Button variant="outline" size="sm" onPress={() => void summary.refetch()}>
                <Button.Label>{t`Retry`}</Button.Label>
              </Button>
            }
          />
        </Page>
      </Container>
    );

  const last = summary.data.lastNight;
  const stages = lastNightStages(last);
  const maxAsleep = Math.max(60, ...series.map((p) => p.asleepMinutes), last?.targetMinutes ?? 0);
  const nights = [...summary.data.days].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={summary.isRefetching}
            onRefresh={() => void summary.refetch()}
            tintColor={foreground}
          />
        ),
      }}
    >
      <Page>
        <PageHeader title={t`Sleep`} />

        {!last ? (
          <EmptyState
            icon={Moon}
            tone="sleep"
            title={t`No sleep yet`}
            description={t`Track sleep through Health Connect or Apple Health, or add a session.`}
          />
        ) : (
          <>
            <Sheet className="gap-5">
              <View className="gap-3">
                <View className="flex-row items-center gap-2.5">
                  <ToneIcon icon={Moon} tone="sleep" />
                  <Text className="font-sans text-base font-semibold text-ink-2">
                    {t`Last night`}
                  </Text>
                  <Text className="font-sans text-base text-ink-3">
                    {friendlyDate(i18n, last.date)}
                  </Text>
                </View>
                <Text
                  className="font-display text-[52px] font-medium leading-[58px] text-ink"
                  style={{ fontVariant: ["tabular-nums"] }}
                >
                  {formatSleepDuration(last.asleepMinutes)}
                </Text>
                <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
                  <SleepStatusPill status={last.status} />
                  <Text
                    className="font-sans text-sm text-ink-3"
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    {formatClockTime(last.mainSleepStart)} – {formatClockTime(last.mainSleepEnd)}
                  </Text>
                </View>
              </View>
              <View className="border-t border-rule pt-4">
                <StageBars stages={stages} />
              </View>
            </Sheet>

            <View className="gap-3">
              <TileRow>
                <StatTile
                  tone="sleep"
                  icon={CalendarDays}
                  label={t`7-day average`}
                  value={formatSleepDuration(summary.data.sevenDayAverageMinutes)}
                />
                <StatTile
                  tone="steps"
                  icon={Hourglass}
                  label={t`Avg debt`}
                  value={formatSleepDuration(summary.data.averageSleepDebtMinutes)}
                />
              </TileRow>
              <TileRow>
                <StatTile
                  tone="weight"
                  icon={Target}
                  label={t`Target`}
                  value={formatSleepDuration(last.targetMinutes)}
                  meter={
                    last.targetMinutes
                      ? { value: last.asleepMinutes / last.targetMinutes }
                      : undefined
                  }
                />
                <StatTile
                  tone="sleep"
                  icon={Moon}
                  label={t`In bed`}
                  value={formatSleepDuration(last.timeInBedMinutes)}
                  note={`${t`Efficiency`} ${formatSleepEfficiency(last.sleepEfficiencyPct)}`}
                />
              </TileRow>
            </View>

            {series.length > 0 ? (
              <Section icon={TrendingUp} tone="sleep" title={t`Last ${windowDays} days`}>
                <Sheet>
                  <TrendChart
                    tone="sleep"
                    data={series.map((point) => ({
                      value: point.asleepMinutes,
                      label: friendlyDate(i18n, point.date),
                    }))}
                    minValue={0}
                    maxValue={Math.ceil(maxAsleep / 120) * 120}
                    target={last.targetMinutes}
                    formatYLabel={(label) => `${Math.round(Number(label) / 60)}h`}
                    height={170}
                  />
                </Sheet>
              </Section>
            ) : null}

            <Details summary={t`All nights`}>
              <View className="gap-2">
                {nights.map((night) => (
                  <Sheet key={night.date} className="gap-2 p-4">
                    <View className="flex-row items-center justify-between gap-2">
                      <Text className="font-sans text-sm text-ink-3">
                        {friendlyDate(i18n, night.date)}
                      </Text>
                      <SleepStatusPill status={night.status} />
                    </View>
                    <View className="flex-row gap-3">
                      <NightFigure
                        label={t`Asleep`}
                        value={formatSleepDuration(night.asleepMinutes)}
                      />
                      <NightFigure
                        label={t`In bed`}
                        value={formatSleepDuration(night.timeInBedMinutes)}
                      />
                      <NightFigure
                        label={t`Efficiency`}
                        value={formatSleepEfficiency(night.sleepEfficiencyPct)}
                      />
                    </View>
                  </Sheet>
                ))}
              </View>
            </Details>
          </>
        )}
      </Page>
    </Container>
  );
}

function NightFigure({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 gap-0.5">
      <Text className="font-sans text-xs text-ink-3">{label}</Text>
      <Text
        className="font-sans text-base font-semibold text-ink"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {value}
      </Text>
    </View>
  );
}
