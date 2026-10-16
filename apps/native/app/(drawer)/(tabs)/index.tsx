import { Ionicons } from "@expo/vector-icons";
import {
  buildCockpitBlocks,
  COCKPIT_SLEEP_WINDOW_DAYS,
  type CockpitSnapshot,
} from "@openvalens/api/presenters/cockpit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, Chip } from "heroui-native";
import { useMemo } from "react";
import { RefreshControl, Text, View } from "react-native";

import { CardStack, ListRow } from "@/components/list-row";
import { Container } from "@/components/container";
import { InsightsSection } from "@/components/insights-section";
import { ProfileSetupPrompt } from "@/components/profile-setup-prompt";
import { orpc } from "@/utils/orpc";
import { useHealthReadiness } from "@/utils/queries";
import { useThemeColor } from "@/utils/theme";

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

function StatBlock({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <View className="gap-1">
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <Text className="font-mono text-xl text-foreground">{value}</Text>
      <Text className="text-xs text-muted-foreground">{sub}</Text>
    </View>
  );
}

export default function CockpitScreen() {
  const queryClient = useQueryClient();
  const readiness = useHealthReadiness();
  const today = useMemo(() => new Date().toISOString().split("T")[0], []);

  const foreground = useThemeColor("foreground");
  const success = useThemeColor("success");
  const danger = useThemeColor("danger");

  const weight = useQuery(orpc.body.dailyWeights.queryOptions({ input: { limit: 1 } }));
  const sleep = useQuery(
    orpc.sleep.summary.queryOptions({ input: { days: COCKPIT_SLEEP_WINDOW_DAYS } }),
  );
  const activity = useQuery(orpc.activity.dailyTotals.queryOptions({ input: { days: 1 } }));
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

  const blocks = useMemo(() => buildCockpitBlocks(snapshot), [snapshot]);

  const dataPending = weight.isPending || sleep.isPending || activity.isPending || vitals.isPending;

  const status = readiness.data?.status ?? "unknown";
  const statusLabel =
    status === "ok"
      ? "Ready"
      : status === "degraded"
        ? "Degraded"
        : status === "unready"
          ? "Unavailable"
          : "Checking…";

  const capabilityIcon = (enabled: boolean) =>
    enabled ? (
      <Ionicons name="checkmark-circle" size={20} color={success} />
    ) : (
      <Ionicons name="close-circle" size={20} color={danger} />
    );

  const onRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["health", "readiness"] });
    void weight.refetch();
    void sleep.refetch();
    void activity.refetch();
    void vitals.refetch();
  };

  return (
    <Container
      className="p-4"
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
      <View className="gap-6">
        <View>
          <Text className="text-sm text-muted-foreground">Today</Text>
          <Text className="font-mono text-3xl text-foreground">{today}</Text>
        </View>

        <ProfileSetupPrompt />

        <InsightsSection />

        <CardStack title="Today">
          <Card variant="secondary" className="p-4">
            {dataPending && !snapshot.weight && !snapshot.sleep && !snapshot.activity ? (
              <Text className="text-sm text-muted-foreground">Loading…</Text>
            ) : (
              <View className="gap-4">
                <StatBlock
                  label={blocks[0]?.title ?? "Weight"}
                  value={blocks[0]?.primary ?? "—"}
                  sub={blocks[0]?.secondary ?? ""}
                />
                <View className="flex-row gap-4">
                  <View className="flex-1">
                    <StatBlock
                      label={blocks[1]?.title ?? "Sleep"}
                      value={blocks[1]?.primary ?? "—"}
                      sub={blocks[1]?.secondary ?? ""}
                    />
                  </View>
                  <View className="flex-1">
                    <StatBlock
                      label={blocks[2]?.title ?? "Activity"}
                      value={blocks[2]?.primary ?? "—"}
                      sub={blocks[2]?.secondary ?? ""}
                    />
                  </View>
                </View>
                <View>
                  <StatBlock
                    label={blocks[3]?.title ?? "Heart rate"}
                    value={blocks[3]?.primary ?? "—"}
                    sub={blocks[3]?.secondary ?? ""}
                  />
                </View>
              </View>
            )}
          </Card>
        </CardStack>

        <CardStack title="System readiness">
          <Card variant="secondary" className="p-4">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-lg font-medium text-foreground">Status</Text>
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
              <Text className="text-sm text-muted-foreground">Checking connection…</Text>
            )}

            {readiness.isError && (
              <Text className="text-sm text-destructive">
                Could not load status. Pull down to retry.
              </Text>
            )}

            {readiness.data && (
              <View>
                <ListRow
                  icon={<Ionicons name="server-outline" size={20} color={foreground} />}
                  title="Database"
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
                  icon={<Ionicons name="key-outline" size={20} color={foreground} />}
                  title="Auth secret"
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
                  icon={<Ionicons name="shield-checkmark-outline" size={20} color={foreground} />}
                  title="Cron secret"
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
          </Card>
        </CardStack>

        {readiness.data && (
          <CardStack title="Recent activity">
            <Card variant="secondary" className="p-4">
              <View className="gap-3">
                <Text className="font-mono text-xs text-muted-foreground">
                  Readiness checked at {readiness.data.timestamp}
                </Text>
                <View>
                  {Object.entries(readiness.data.checks.capabilities).map(
                    ([name, enabled], index, arr) => (
                      <ListRow
                        key={name}
                        icon={capabilityIcon(enabled)}
                        title={name}
                        trailing={
                          <Text
                            className={
                              enabled ? "text-sm text-success" : "text-sm text-destructive"
                            }
                          >
                            {enabled ? "Enabled" : "Disabled"}
                          </Text>
                        }
                        showDivider={index < arr.length - 1}
                      />
                    ),
                  )}
                </View>
              </View>
            </Card>
          </CardStack>
        )}
      </View>
    </Container>
  );
}
