import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "heroui-native";
import { Card, Chip } from "heroui-native";
import { useThemeColor } from "@/utils/theme";
import { useMemo } from "react";
import { RefreshControl, Text, View } from "react-native";

import { CardStack, ListRow } from "@/components/list-row";
import { Container } from "@/components/container";
import { useHealthReadiness } from "@/utils/queries";

export default function CockpitScreen() {
  const queryClient = useQueryClient();
  const readiness = useHealthReadiness();
  const today = useMemo(() => new Date().toISOString().split("T")[0], []);

  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const success = useThemeColor("success");
  const warning = useThemeColor("warning");
  const danger = useThemeColor("danger");

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
  };

  return (
    <Container
      className="p-4"
      scrollViewProps={{
        refreshControl: (
          <RefreshControl refreshing={readiness.isFetching} onRefresh={onRefresh} tintColor={foreground} />
        ),
      }}
    >
      <View className="gap-6">
        <View>
          <Text className="text-sm text-muted-foreground">Today</Text>
          <Text className="font-mono text-3xl text-foreground">{today}</Text>
        </View>

        <CardStack title="System readiness">
          <Card variant="secondary" className="p-4">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-lg font-medium text-foreground">Status</Text>
              <Chip
                size="sm"
                color={
                  status === "ok" ? "success" : status === "degraded" ? "warning" : status === "unready" ? "danger" : "default"
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
                    <Chip size="sm" color={readiness.data.checks.database === "ok" ? "success" : "danger"}>
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
                      color={readiness.data.checks.secrets.betterAuthSecret === "ok" ? "success" : "warning"}
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
                      color={readiness.data.checks.secrets.cronSecret === "ok" ? "success" : "warning"}
                    >
                      <Chip.Label>{readiness.data.checks.secrets.cronSecret}</Chip.Label>
                    </Chip>
                  }
                />
              </View>
            )}
          </Card>
        </CardStack>

        <CardStack title="Recent activity">
          <Card variant="secondary" className="p-4">
            {!readiness.data ? (
              <Text className="text-sm text-muted-foreground">No recent activity.</Text>
            ) : (
              <View className="gap-3">
                <Text className="font-mono text-xs text-muted-foreground">
                  Readiness checked at {readiness.data.timestamp}
                </Text>
                <View>
                  {Object.entries(readiness.data.checks.capabilities).map(([name, enabled], index, arr) => (
                    <ListRow
                      key={name}
                      icon={capabilityIcon(enabled)}
                      title={name}
                      trailing={
                        <Text className={cn("text-sm", enabled ? "text-success" : "text-destructive")}>
                          {enabled ? "Enabled" : "Disabled"}
                        </Text>
                      }
                      showDivider={index < arr.length - 1}
                    />
                  ))}
                </View>
              </View>
            )}
          </Card>
        </CardStack>
      </View>
    </Container>
  );
}
