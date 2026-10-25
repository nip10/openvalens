import { useLingui } from "@lingui/react/macro";
import { Badge } from "@openvalens/ui/components/badge";

import { syncNow, useOutboxStatus } from "@/utils/sync-engine";

/**
 * Pending-write badge for the metric-domain screens. Hidden while the outbox is
 * empty; otherwise shows the count and whether the engine is syncing, offline,
 * or stuck retrying (failed). Pressing it attempts an immediate sync.
 */
export function SyncStatusBadge() {
  const { pending, state } = useOutboxStatus();
  const { t } = useLingui();

  if (pending === 0) return null;

  const label =
    state === "offline"
      ? t`Offline (${pending})`
      : state === "syncing"
        ? t`Syncing (${pending})`
        : t`Failed (${pending})`;

  return (
    <Badge variant="outline" asChild>
      <button
        type="button"
        onClick={() => void syncNow()}
        className={
          state === "offline" || state === "syncing"
            ? "h-7 cursor-pointer px-2 text-ink-2 hover:bg-muted active:bg-paper-3 disabled:cursor-not-allowed"
            : "h-7 cursor-pointer border-destructive px-2 text-destructive hover:bg-muted active:bg-paper-3 disabled:cursor-not-allowed"
        }
        title={t`Sync pending entries`}
      >
        {label}
      </button>
    </Badge>
  );
}
