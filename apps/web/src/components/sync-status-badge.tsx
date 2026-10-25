import { useLingui } from "@lingui/react/macro";
import { Badge } from "@openvalens/ui/components/badge";
import { cn } from "@openvalens/ui/lib/utils";
import { CloudOff, RefreshCw, TriangleAlert } from "lucide-react";

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
  const Icon = state === "offline" ? CloudOff : state === "syncing" ? RefreshCw : TriangleAlert;
  const calm = state === "offline" || state === "syncing";

  return (
    <Badge variant="outline" asChild>
      <button
        type="button"
        onClick={() => void syncNow()}
        className={cn(
          "h-8 cursor-pointer gap-1.5 rounded-full px-3 text-sm transition-colors duration-[var(--dur-short)] active:bg-paper-3 disabled:cursor-not-allowed disabled:opacity-55 [&>svg]:size-3.5",
          calm
            ? "border-rule-2 bg-card text-ink-2 hover:bg-muted"
            : "border-destructive/40 bg-destructive/6 text-destructive hover:bg-destructive/12",
        )}
        title={t`Sync pending entries`}
      >
        <Icon aria-hidden="true" />
        {label}
      </button>
    </Badge>
  );
}
