import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Spinner } from "heroui-native";
import { Activity, Clock, HeartPulse, RefreshCw } from "lucide-react-native";

import { Icon, Section, Sheet, StatusPill } from "@/components/bloom";
import { ListRow } from "@/components/list-row";
import {
  getHealthAccess,
  getHealthSyncStatus,
  isHealthSyncTaskRegistered,
  registerHealthSyncTask,
  requestHealthAccess,
  runHealthSync,
  syncableTypes,
  unregisterHealthSyncTask,
} from "@/lib/health-sync";

/** Foreground "Sync now" gets more room than a background run. */
const FOREGROUND_BUDGET = { maxBatches: 50, windowMs: 60_000 };

const ERROR_COPY: Record<string, MessageDescriptor> = {
  PERMISSION_DENIED: msg`This device's access was revoked. Reconnect from the web app.`,
  UNAUTHENTICATED: msg`Sign in again to sync.`,
  NO_MEMBERSHIP: msg`Your account has no organization. Sync is paused.`,
  SOURCE_FAILED: msg`Could not read your health data. Check permissions.`,
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
  const { t, i18n } = useLingui();
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

  const total = syncableTypes().length;
  const appleHealth = access.data?.platform === "apple_health";
  const sourceName = appleHealth ? "Apple Health" : "Health Connect";
  const granted = access.data?.grantedTypes.length ?? 0;
  const connected = granted > 0;
  const connectionSubtitle = !access.data
    ? t`Checking…`
    : !access.data.available
      ? t`${sourceName} is not available on this device`
      : !connected
        ? t`Not connected`
        : appleHealth
          ? // HealthKit never says which read permissions were granted.
            // Installs from before sleep sync (#131) can tap to add it.
            granted < total
            ? t`Access requested for ${granted} of ${total} data types`
            : t`Access requested for ${total} data types`
          : access.data.background
            ? t`${granted} of ${total} data types`
            : t`${granted} of ${total} data types · background access off`;

  const last = status.data;
  const errorCode = last?.lastErrorCode;
  const errorCopy = errorCode ? ERROR_COPY[errorCode] : undefined;
  const syncSubtitle = sync.isPending
    ? t`Syncing…`
    : errorCode
      ? errorCopy
        ? i18n._(errorCopy)
        : t`Last sync failed. Try again.`
      : last?.lastSuccessAt
        ? t`Last synced ${formatTimestamp(last.lastSuccessAt)}`
        : t`Not synced yet`;

  return (
    <Section title={t`Health data`} icon={Activity} tone="signal">
      <Sheet className="overflow-hidden p-0 py-1">
        <ListRow
          icon={<Icon icon={HeartPulse} size={18} color="ink-2" />}
          title={sourceName}
          subtitle={connectionSubtitle}
          showDivider
          onPress={
            access.data?.available && (granted < total || !access.data.background)
              ? () => connect.mutate()
              : undefined
          }
          accessibilityHint={t`Opens ${sourceName} permissions`}
          trailing={
            <StatusPill tone={connected ? "good" : "neutral"}>
              {connected ? t`Connected` : t`Connect`}
            </StatusPill>
          }
        />
        <ListRow
          icon={<Icon icon={RefreshCw} size={18} color="ink-2" />}
          title={t`Sync now`}
          subtitle={syncSubtitle}
          showDivider
          onPress={connected && !sync.isPending ? () => sync.mutate() : undefined}
          trailing={sync.isPending ? <Spinner size="sm" color="default" /> : undefined}
        />
        <ListRow
          icon={<Icon icon={Clock} size={18} color="ink-2" />}
          title={t`Background sync`}
          subtitle={
            toggleBackground.error
              ? t`Background tasks are restricted for this app.`
              : t`Every few hours, when the system allows`
          }
          onPress={
            connected && !toggleBackground.isPending
              ? () => toggleBackground.mutate(!background.data)
              : undefined
          }
          trailing={
            <StatusPill tone={background.data ? "good" : "neutral"}>
              {background.data ? t`On` : t`Off`}
            </StatusPill>
          }
        />
      </Sheet>
    </Section>
  );
}
