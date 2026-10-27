import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { formatSteps, summarizeDailyActivity } from "@openvalens/api/presenters/activity";
import { formatKg, formatKgDelta, summarizeDailyWeights } from "@openvalens/api/presenters/body";
import {
  buildCockpitBlocks,
  COCKPIT_SLEEP_WINDOW_DAYS,
  type CockpitSnapshot,
} from "@openvalens/api/presenters/cockpit";
import { sleepStatusLabel, sleepStatusTone } from "@openvalens/api/presenters/sleep";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Button, Chip } from "heroui-native";
import {
  CircleCheck,
  CircleX,
  Database,
  Footprints,
  HeartPulse,
  History,
  KeyRound,
  Moon,
  Scale,
  ShieldCheck,
  TrendingUp,
} from "lucide-react-native";
import { useMemo } from "react";
import { RefreshControl, Text, View } from "react-native";

import {
  Details,
  ErrorState,
  Figure,
  Icon,
  Page,
  PageHeader,
  Section,
  Sheet,
  StatTile,
  TileRow,
} from "@/components/bloom";
import { TrendChart } from "@/components/chart";
import { Container } from "@/components/container";
import { InsightsSection } from "@/components/insights-section";
import { useModules } from "@/lib/modules/use-modules";
import { ListRow } from "@/components/list-row";
import { FinishSetupCard } from "@/components/finish-setup-card";
import { authClient } from "@/lib/auth-client";
import { friendlyDate, pillTone } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";
import { useHealthReadiness } from "@/utils/queries";
import { useThemeColor } from "@/utils/theme";

// The weight chart reads the same 90-day window the web dashboard does; the
// first row is still the latest reading the Weight tile shows.
const WEIGHT_TREND_DAYS = 90;
// Thirty days of activity give the "usual" (seven-day average) steps; the
// last row is still today's.
const ACTIVITY_WINDOW_DAYS = 30;

function formatClockTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function greeting(hour: number) {
  if (hour < 12) return msg`Good morning`;
  if (hour < 18) return msg`Good afternoon`;
  return msg`Good evening`;
}

/** Tiles two to a row. */
function pairs<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += 2) rows.push(items.slice(index, index + 2));
  return rows;
}

export default function CockpitScreen() {
  const queryClient = useQueryClient();
  const { t, i18n } = useLingui();
  const readiness = useHealthReadiness();
  const { data: session } = authClient.useSession();
  const modules = useModules();

  const foreground = useThemeColor("foreground");

  const weight = useQuery(
    orpc.body.dailyWeights.queryOptions({ input: { limit: WEIGHT_TREND_DAYS } }),
  );
  const sleep = useQuery(
    orpc.sleep.summary.queryOptions({ input: { days: COCKPIT_SLEEP_WINDOW_DAYS } }),
  );
  const activity = useQuery(
    orpc.activity.dailyTotals.queryOptions({ input: { days: ACTIVITY_WINDOW_DAYS } }),
  );
  const vitals = useQuery(orpc.vitals.daily.queryOptions({ input: { days: 1 } }));

  const snapshot: CockpitSnapshot = useMemo(
    () => ({
      weight: weight.data?.[0]
        ? { date: weight.data[0].date, weightKg: weight.data[0].weightKg }
        : null,
      sleep: sleep.data?.lastNight
        ? {
            date: sleep.data.lastNight.date,
            asleepMinutes: sleep.data.lastNight.asleepMinutes,
            status: sleep.data.lastNight.status,
            bedtime: formatClockTime(sleep.data.lastNight.mainSleepStart),
            wakeAt: formatClockTime(sleep.data.lastNight.mainSleepEnd),
          }
        : null,
      activity: activity.data?.at(-1)
        ? {
            date: activity.data.at(-1)!.date,
            steps: activity.data.at(-1)!.steps ?? 0,
            activeCaloriesKcal: activity.data.at(-1)!.activeCaloriesKcal ?? 0,
            distanceMeters: activity.data.at(-1)!.distanceMeters ?? 0,
          }
        : null,
      vitals: vitals.data?.at(-1)
        ? {
            date: vitals.data.at(-1)!.date,
            heartRateAvgBpm: vitals.data.at(-1)!.heartRate.avgBpm,
          }
        : null,
    }),
    [weight.data, sleep.data, activity.data, vitals.data],
  );

  const blocks = useMemo(
    () => buildCockpitBlocks(snapshot, i18n),
    // Rebuild when the language changes, not only when the data does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, i18n, i18n.locale],
  );

  const dataPending = weight.isPending || sleep.isPending || activity.isPending || vitals.isPending;
  const dataError = weight.isError || sleep.isError || activity.isError || vitals.isError;

  const sleepRow = sleep.data?.lastNight;
  const activityRow = activity.data?.at(-1);
  const usualSteps = activity.data
    ? summarizeDailyActivity(activity.data).sevenDayAverageSteps || null
    : null;
  const weightSummary = summarizeDailyWeights(weight.data ?? []);

  const status = readiness.data?.status ?? "unknown";
  const statusLabel =
    status === "ok"
      ? t`Ready`
      : status === "degraded"
        ? t`Degraded`
        : status === "unready"
          ? t`Unavailable`
          : t`Checking…`;

  const onRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.health.readiness.key() });
    void weight.refetch();
    void sleep.refetch();
    void activity.refetch();
    void vitals.refetch();
  };

  // Onboarding stage 1: tiles of hidden modules are left out (all show while
  // the profile loads). The queries stay, so turning a module on is instant.
  const tiles = [
    modules.isEnabled("sleep") ? (
      <StatTile
        key="sleep"
        icon={Moon}
        tone="sleep"
        label={blocks[1]?.title ?? t`Sleep`}
        href="/records/sleep"
        value={blocks[1]?.primary ?? "—"}
        meter={
          sleepRow && sleepRow.targetMinutes
            ? { value: sleepRow.asleepMinutes / sleepRow.targetMinutes }
            : undefined
        }
        status={
          sleepRow
            ? {
                label: i18n._(sleepStatusLabel(sleepRow.status)),
                tone: pillTone(sleepStatusTone(sleepRow.status)),
              }
            : undefined
        }
        note={sleepRow ? undefined : t`No reading yet`}
      />
    ) : null,
    modules.isEnabled("activity") ? (
      <StatTile
        key="activity"
        icon={Footprints}
        tone="steps"
        label={t`Steps`}
        href="/records/activity"
        value={blocks[2]?.primary ?? "—"}
        meter={
          activityRow && usualSteps ? { value: (activityRow.steps ?? 0) / usualSteps } : undefined
        }
        note={
          activityRow
            ? usualSteps
              ? t`Your usual: ${formatSteps(Math.round(usualSteps))}`
              : friendlyDate(i18n, activityRow.date)
            : t`No activity logged`
        }
      />
    ) : null,
    modules.isEnabled("heart") ? (
      <StatTile
        key="heart"
        icon={HeartPulse}
        tone="heart"
        label={blocks[3]?.title ?? t`Heart rate`}
        href="/records/vitals"
        value={blocks[3]?.primary ?? "—"}
        note={
          snapshot.vitals
            ? t`Average, ${friendlyDate(i18n, snapshot.vitals.date)}`
            : t`No reading yet`
        }
      />
    ) : null,
    modules.isEnabled("body") ? (
      <StatTile
        key="body"
        icon={Scale}
        tone="weight"
        label={blocks[0]?.title ?? t`Weight`}
        href="/body"
        value={blocks[0]?.primary ?? "—"}
        note={
          weightSummary.change30d !== null
            ? t`${formatKgDelta(i18n, weightSummary.change30d)} in 30 days`
            : snapshot.weight
              ? friendlyDate(i18n, snapshot.weight.date)
              : t`No reading yet`
        }
      />
    ) : null,
  ].filter((tile) => tile !== null);

  const now = new Date();
  const firstName = session?.user?.name?.trim().split(/\s+/)[0];
  const hello = i18n._(greeting(now.getHours()));
  const longDate = new Intl.DateTimeFormat(i18n.locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={
              readiness.isFetching ||
              weight.isRefetching ||
              sleep.isRefetching ||
              activity.isRefetching ||
              vitals.isRefetching
            }
            onRefresh={onRefresh}
            tintColor={foreground}
          />
        ),
      }}
    >
      <Page>
        <PageHeader
          title={firstName ? `${hello}, ${firstName}` : hello}
          description={longDate}
          actions={
            <Link href="/timeline" asChild>
              <Button variant="outline" size="sm" accessibilityLabel={t`Timeline`}>
                <Icon icon={History} size={16} color="ink-2" />
                <Button.Label>{t`Timeline`}</Button.Label>
              </Button>
            </Link>
          }
        />

        <FinishSetupCard />

        {dataPending && !snapshot.weight && !snapshot.sleep && !snapshot.activity ? (
          <Sheet>
            <Text className="font-sans text-sm text-ink-3">{t`Loading…`}</Text>
          </Sheet>
        ) : dataError && !snapshot.weight && !snapshot.sleep && !snapshot.activity ? (
          <ErrorState title={t`Could not load status. Pull down to retry.`} />
        ) : tiles.length > 0 ? (
          <View className="gap-3" accessibilityLabel={t`Today`}>
            {pairs(tiles).map((row, index) => (
              <TileRow key={index}>{row}</TileRow>
            ))}
          </View>
        ) : null}

        {weightSummary.latest && modules.isEnabled("body") ? (
          <Section
            icon={TrendingUp}
            tone="weight"
            title={t`Weight, last ${WEIGHT_TREND_DAYS} days`}
          >
            <Sheet className="gap-4">
              <View className="flex-row">
                <Figure
                  className="flex-1 pr-3"
                  label={friendlyDate(i18n, weightSummary.latest.date)}
                  value={formatKg(weightSummary.latest.weightKg)}
                />
                <Figure
                  className="flex-1 border-l border-rule px-3"
                  label={t`7 days`}
                  value={
                    weightSummary.change7d === null
                      ? "—"
                      : formatKgDelta(i18n, weightSummary.change7d)
                  }
                />
                <Figure
                  className="flex-1 border-l border-rule pl-3"
                  label={t`30 days`}
                  value={
                    weightSummary.change30d === null
                      ? "—"
                      : formatKgDelta(i18n, weightSummary.change30d)
                  }
                />
              </View>
              <TrendChart
                tone="weight"
                data={weightSummary.series.map((point) => ({
                  value: point.weightKg,
                  label: friendlyDate(i18n, point.date),
                }))}
                minValue={Math.floor(Math.min(...weightSummary.series.map((p) => p.weightKg)) - 1)}
                maxValue={Math.ceil(Math.max(...weightSummary.series.map((p) => p.weightKg)) + 1)}
                formatYLabel={(label) => String(Math.round(Number(label)))}
                height={160}
              />
            </Sheet>
          </Section>
        ) : null}

        <InsightsSection />

        <Details summary={t`System readiness`}>
          <Sheet className="gap-3 p-4">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans text-base font-semibold text-ink">{t`Status`}</Text>
              <Chip
                size="sm"
                color={
                  status === "ok"
                    ? "success"
                    : status === "degraded"
                      ? "warning"
                      : status === "unready"
                        ? "danger"
                        : "default"
                }
              >
                <Chip.Label>{statusLabel}</Chip.Label>
              </Chip>
            </View>

            {readiness.isLoading && !readiness.isError && (
              <Text className="font-sans text-sm text-ink-3">{t`Checking connection…`}</Text>
            )}

            {readiness.isError && (
              <Text className="font-sans text-sm text-destructive">
                {t`Could not load status. Pull down to retry.`}
              </Text>
            )}

            {readiness.data && (
              <View>
                <ListRow
                  icon={<Icon icon={Database} size={18} color="ink-2" />}
                  title={t`Database`}
                  trailing={
                    <Chip
                      size="sm"
                      color={readiness.data.checks.database === "ok" ? "success" : "danger"}
                    >
                      <Chip.Label>{readiness.data.checks.database}</Chip.Label>
                    </Chip>
                  }
                />
                <ListRow
                  icon={<Icon icon={KeyRound} size={18} color="ink-2" />}
                  title={t`Auth secret`}
                  trailing={
                    <Chip
                      size="sm"
                      color={
                        readiness.data.checks.secrets.betterAuthSecret === "ok"
                          ? "success"
                          : "warning"
                      }
                    >
                      <Chip.Label>{readiness.data.checks.secrets.betterAuthSecret}</Chip.Label>
                    </Chip>
                  }
                />
                <ListRow
                  icon={<Icon icon={ShieldCheck} size={18} color="ink-2" />}
                  title={t`Cron secret`}
                  trailing={
                    <Chip
                      size="sm"
                      color={
                        readiness.data.checks.secrets.cronSecret === "ok" ? "success" : "warning"
                      }
                    >
                      <Chip.Label>{readiness.data.checks.secrets.cronSecret}</Chip.Label>
                    </Chip>
                  }
                />
              </View>
            )}

            {readiness.data && (
              <View className="gap-3 border-t border-rule pt-3">
                <Text className="font-sans text-sm font-semibold text-ink-2">
                  {t`Recent activity`}
                </Text>
                <Text className="font-sans text-xs text-ink-3">
                  {t`Readiness checked at ${readiness.data.timestamp}`}
                </Text>
                <View>
                  {Object.entries(readiness.data.checks.capabilities).map(
                    ([name, enabled], index, arr) => (
                      <ListRow
                        key={name}
                        density="compact"
                        icon={
                          <Icon
                            icon={enabled ? CircleCheck : CircleX}
                            size={18}
                            color={enabled ? "success" : "destructive"}
                          />
                        }
                        title={name}
                        trailing={
                          <Text
                            className={
                              enabled
                                ? "font-sans text-sm text-success"
                                : "font-sans text-sm text-destructive"
                            }
                          >
                            {enabled ? t`Enabled` : t`Disabled`}
                          </Text>
                        }
                        showDivider={index < arr.length - 1}
                      />
                    ),
                  )}
                </View>
              </View>
            )}
          </Sheet>
        </Details>
      </Page>
    </Container>
  );
}
