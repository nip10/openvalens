import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { syncNow, useOutboxStatus } from "@/lib/offline/sync";

/**
 * Pending-write chip for the metric-domain screens. Hidden while the outbox is
 * empty; otherwise shows the count and whether the engine is syncing, offline,
 * or stuck retrying (failed). Pressing it attempts an immediate sync.
 */
export function SyncStatusBadge() {
  const { pending, state } = useOutboxStatus();

  if (pending === 0) return null;

  const label =
    state === "offline"
      ? `Offline (${pending})`
      : state === "syncing"
        ? `Syncing (${pending})`
        : `Failed (${pending})`;

  return (
    <Pressable
      onPress={() => void syncNow()}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="active:opacity-70"
    >
      <View className="flex-row items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1">
        {state === "syncing" ? (
          <ActivityIndicator size="small" />
        ) : (
          <View
            className={`h-1.5 w-1.5 rounded-full ${
              state === "offline" ? "bg-muted-foreground" : "bg-destructive"
            }`}
          />
        )}
        <Text className="text-xs font-medium text-foreground">{label}</Text>
      </View>
    </Pressable>
  );
}
