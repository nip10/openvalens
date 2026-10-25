import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  wearableActions,
  wearableErrorLabel,
  wearableSendsLabel,
  wearableStatusLabel,
  type WearableCallbackNotice,
  type WearableConnectionLike,
  type WearableProviderId,
} from "@openvalens/api/presenters/wearables";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@openvalens/ui/components/alert-dialog";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { cn } from "@openvalens/ui/lib/utils";

import { EmptyState, ErrorState } from "@/components/page";

/** A destructive choice waiting for confirmation. */
export type WearableConfirm =
  | { kind: "disconnect"; provider: WearableProviderId }
  | { kind: "deleteQuarantined"; provider: WearableProviderId };

export type WearableDevicesViewProps = {
  status: "pending" | "error" | "ready";
  providers: WearableConnectionLike[];
  /** Result of the OAuth round trip, from `?provider=&status=`. */
  notice: WearableCallbackNotice | null;
  /** The provider a mutation is running for, so only its buttons disable. */
  busyProvider: WearableProviderId | null;
  /** Value-free message from the last failed action. */
  actionError: string | null;
  /** Shown after "Sync now" succeeds. */
  syncRequestedFor: WearableProviderId | null;
  confirm: WearableConfirm | null;
  onConfirmChange: (confirm: WearableConfirm | null) => void;
  onRetry: () => void;
  onConnect: (provider: WearableProviderId) => void;
  onSyncNow: (provider: WearableProviderId) => void;
  onDisconnect: (provider: WearableProviderId, deleteData: boolean) => void;
  onResolveQuarantine: (provider: WearableProviderId, action: "keep" | "delete") => void;
};

/** The state word's colour; the word itself always carries the meaning. */
const STATUS_TONE: Record<WearableConnectionLike["status"], string> = {
  active: "text-success",
  not_connected: "text-ink-3",
  reconnect_needed: "text-warning",
  quarantined: "text-destructive",
};

function formatInstant(iso: string): string {
  return new Date(iso).toLocaleString();
}

/**
 * Cloud wearable connections (Issue #60). Presentational: no data hooks, only
 * the Lingui context, so tests can render and inspect it; the route supplies
 * the oRPC wiring.
 */
export function WearableDevicesView(props: WearableDevicesViewProps) {
  const { status, providers, notice, actionError, confirm, onConfirmChange } = props;
  const { i18n } = useLingui();
  const confirmName =
    providers.find((row) => row.provider === confirm?.provider)?.displayName ?? "";

  return (
    <div className="grid gap-6">
      <p className="max-w-[65ch] text-ink-2">
        <Trans>
          The mobile app already sends steps, heart rate, sleep, weight and workouts from Apple
          Health or Health Connect. Connect a vendor account here only for what the phone cannot
          carry, such as overnight HRV and the vendor's own scores.
        </Trans>
      </p>

      {notice ? (
        <p
          role="status"
          className={
            notice.tone === "success"
              ? "well px-4 py-3 text-sm text-ink"
              : "border-t-2 border-destructive py-3 text-sm text-destructive"
          }
        >
          {i18n._(notice.message)}
        </p>
      ) : null}

      {actionError ? (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      {status === "pending" ? (
        <div className="sheet grid gap-4 px-5 py-5">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-9 w-40" />
        </div>
      ) : status === "error" ? (
        <ErrorState
          title={<Trans>Could not load your devices.</Trans>}
          action={
            <Button variant="outline" onClick={props.onRetry}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      ) : providers.length === 0 ? (
        <EmptyState
          title={<Trans>No cloud devices are available on this server</Trans>}
          description={
            <Trans>
              Your server operator has not enabled any vendor. The mobile app still syncs Apple
              Health and Health Connect.
            </Trans>
          }
        />
      ) : (
        <ul className="sheet divide-y divide-rule px-5">
          {providers.map((row) => (
            <ProviderCard key={row.provider} row={row} {...props} />
          ))}
        </ul>
      )}

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) onConfirmChange(null);
        }}
      >
        <AlertDialogContent>
          {confirm?.kind === "deleteQuarantined" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  <Trans>Delete the held-back {confirmName} records?</Trans>
                </AlertDialogTitle>
                <AlertDialogDescription>
                  <Trans comment="safety">
                    Every record this connection brought in is permanently deleted. It can't be
                    undone.
                  </Trans>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  <Trans>Cancel</Trans>
                </AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => props.onResolveQuarantine(confirm.provider, "delete")}
                >
                  <Trans>Delete records</Trans>
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  <Trans>Disconnect {confirmName}?</Trans>
                </AlertDialogTitle>
                <AlertDialogDescription>
                  <Trans>
                    Access is revoked at the vendor and the stored tokens are deleted. Choose
                    whether the records this connection already brought in are kept or deleted.
                  </Trans>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  <Trans>Cancel</Trans>
                </AlertDialogCancel>
                <AlertDialogAction
                  variant="outline"
                  data-choice="keep"
                  onClick={() => confirm && props.onDisconnect(confirm.provider, false)}
                >
                  <Trans>Disconnect, keep records</Trans>
                </AlertDialogAction>
                <AlertDialogAction
                  variant="destructive"
                  data-choice="delete"
                  onClick={() => confirm && props.onDisconnect(confirm.provider, true)}
                >
                  <Trans>Disconnect and delete records</Trans>
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProviderCard({
  row,
  busyProvider,
  syncRequestedFor,
  onConfirmChange,
  onConnect,
  onSyncNow,
  onResolveQuarantine,
}: WearableDevicesViewProps & { row: WearableConnectionLike }) {
  const { t, i18n } = useLingui();
  const actions = wearableActions(row.status);
  const busy = busyProvider === row.provider;
  const error = wearableErrorLabel(row.lastErrorCode);
  const lastSynced = row.lastSyncedAt ? formatInstant(row.lastSyncedAt) : null;
  const count = row.quarantinedRecordCount;
  const name = row.displayName;

  return (
    <li data-provider={row.provider} className="grid gap-4 py-5">
      <div className="grid gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-lg text-ink">{name}</h3>
          <span className={cn("text-sm font-medium", STATUS_TONE[row.status])}>
            {i18n._(wearableStatusLabel(row.status))}
          </span>
        </div>
        <p className="max-w-[65ch] text-sm text-ink-3">
          {i18n._(wearableSendsLabel(row.provider))}{" "}
          <a
            href={row.termsUrl}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:decoration-2"
          >
            <Trans>Vendor terms</Trans>
          </a>
        </p>
      </div>

      {row.status !== "not_connected" || error || syncRequestedFor === row.provider ? (
        <div className="grid gap-1 text-sm">
          {row.status !== "not_connected" ? (
            <p className="text-ink-3">
              {lastSynced ? t`Last synced ${lastSynced}` : t`Not synced yet`}
            </p>
          ) : null}
          {error && row.status !== "quarantined" ? (
            <p className="text-destructive">{i18n._(error)}</p>
          ) : null}
          {syncRequestedFor === row.provider ? (
            <p className="text-ink-3">
              <Trans>Sync requested. It runs on the next scheduled pass.</Trans>
            </p>
          ) : null}
        </div>
      ) : null}

      {actions.resolveQuarantine ? (
        <div className="well grid gap-3 px-4 py-3 text-sm">
          <p className="text-ink">
            <Plural
              value={count}
              one={`${name} access was revoked. # record is hidden until you choose whether to keep it or delete it.`}
              other={`${name} access was revoked. # records are hidden until you choose whether to keep them or delete them.`}
            />
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => onResolveQuarantine(row.provider, "keep")}
            >
              <Trans>Keep records</Trans>
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => onConfirmChange({ kind: "deleteQuarantined", provider: row.provider })}
            >
              <Trans>Delete records</Trans>
            </Button>
          </div>
        </div>
      ) : null}

      {actions.connect || actions.syncNow || actions.disconnect ? (
        <div className="flex flex-wrap gap-2">
          {actions.connect ? (
            <Button variant="outline" disabled={busy} onClick={() => onConnect(row.provider)}>
              {row.status === "not_connected" ? t`Connect` : t`Reconnect`}
            </Button>
          ) : null}
          {actions.syncNow ? (
            <Button variant="outline" disabled={busy} onClick={() => onSyncNow(row.provider)}>
              <Trans>Sync now</Trans>
            </Button>
          ) : null}
          {actions.disconnect ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => onConfirmChange({ kind: "disconnect", provider: row.provider })}
            >
              <Trans>Disconnect</Trans>
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
