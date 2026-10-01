import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, Chip, Spinner } from "heroui-native";
import { Platform } from "react-native";

import { CardStack, ListRow } from "@/components/list-row";
import {
  getHealthAccess,
  getHealthSyncStatus,
  isHealthSyncTaskRegistered,
  registerHealthSyncTask,
  requestHealthAccess,
  runHealthSync,
  SYNCED_TYPES,
  unregisterHealthSyncTask,
} from "@/lib/health-sync";
import { useThemeColor } from "@/utils/theme";

/** Foreground "Sync now" gets more room than a background run. */
const FOREGROUND_BUDGET = { maxBatches: 50, windowMs: 60_000 };

const ERROR_COPY: Record<string, string> = {
  PERMISSION_DENIED: "This device's access was revoked. Reconnect from the web app.",
  UNAUTHENTICATED: "Sign in again to sync.",
  NO_MEMBERSHIP: "Your account has no organization. Sync is paused.",
  SOURCE_FAILED: "Could not read from Health Connect. Check permissions.",
};

/** `2026-10-01 08:42` in local time, matching the timeline. */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const keys = {
  access: ["health-sync", "access"] as const,
  status: ["health-sync", "status"] as const,
  background: ["health-sync", "background"] as const,
};

export function HealthSyncSettings() {
  const queryClient = useQueryClient();
  const foreground = useThemeColor("foreground");
  const access = useQuery({ queryKey: keys.access, queryFn: getHealthAccess });
  const status = useQuery({ queryKey: keys.status, queryFn: getHealthSyncStatus });
  const background = useQuery({ queryKey: keys.background, queryFn: isHealthSyncTaskRegistered });

  const connect = useMutation({
    mutationFn: requestHealthAccess,
    onSuccess: (result) => queryClient.setQueryData(keys.access, result),
  });
  const sync = useMutation({
    mutationFn: () =>
      runHealthSync({
        maxBatches: FOREGROUND_BUDGET.maxBatches,
        deadline: Date.now() + FOREGROUND_BUDGET.windowMs,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.status }),
  });
  const toggleBackground = useMutation({
    mutationFn: async (enable: boolean) => {
      if (enable) await registerHealthSyncTask();
      else await unregisterHealthSyncTask();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.background }),
  });

  if (Platform.OS !== "android") {
    return (
      <CardStack title="Health data">
        <Card variant="secondary" className="overflow-hidden p-0">
          <ListRow
            icon={<Ionicons name="heart-outline" size={20} color={foreground} />}
            title="Apple Health"
            subtitle="Not supported yet"
          />
        </Card>
      </CardStack>
    );
  }

  const granted = access.data?.grantedTypes.length ?? 0;
  const connected = granted > 0;
  const connectionSubtitle = !access.data
    ? "Checking…"
    : !access.data.available
      ? "Health Connect is not available on this device"
      : connected
        ? `${granted} of ${SYNCED_TYPES.length} data types${access.data.background ? "" : " · background access off"}`
        : "Not connected";

  const last = status.data;
  const errorCode = last?.lastErrorCode;
  const syncSubtitle = sync.isPending
    ? "Syncing…"
    : errorCode
      ? (ERROR_COPY[errorCode] ?? "Last sync failed. Try again.")
      : last?.lastSuccessAt
        ? `Last synced ${formatTimestamp(last.lastSuccessAt)}`
        : "Not synced yet";

  return (
    <CardStack title="Health data">
      <Card variant="secondary" className="overflow-hidden p-0">
        <ListRow
          icon={<Ionicons name="fitness-outline" size={20} color={foreground} />}
          title="Health Connect"
          subtitle={connectionSubtitle}
          showDivider
          onPress={
            access.data?.available && (granted < SYNCED_TYPES.length || !access.data.background)
              ? () => connect.mutate()
              : undefined
          }
          accessibilityHint="Opens Health Connect permissions"
          trailing={
            <Chip size="sm" variant="secondary">
              <Chip.Label>{connected ? "Connected" : "Connect"}</Chip.Label>
            </Chip>
          }
        />
        <ListRow
          icon={<Ionicons name="sync-outline" size={20} color={foreground} />}
          title="Sync now"
          subtitle={syncSubtitle}
          showDivider
          onPress={connected && !sync.isPending ? () => sync.mutate() : undefined}
          trailing={sync.isPending ? <Spinner size="sm" color="default" /> : undefined}
        />
        <ListRow
          icon={<Ionicons name="time-outline" size={20} color={foreground} />}
          title="Background sync"
          subtitle={
            toggleBackground.error
              ? "Background tasks are restricted for this app."
              : "Every few hours, when the system allows"
          }
          onPress={
            connected && !toggleBackground.isPending
              ? () => toggleBackground.mutate(!background.data)
              : undefined
          }
          trailing={
            <Chip size="sm" variant="secondary">
              <Chip.Label>{background.data ? "On" : "Off"}</Chip.Label>
            </Chip>
          }
        />
      </Card>
    </CardStack>
  );
}
