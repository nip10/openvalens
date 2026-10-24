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
import { Badge } from "@openvalens/ui/components/badge";
import { Button } from "@openvalens/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";
import { Skeleton } from "@openvalens/ui/components/skeleton";

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
      <p className="text-sm text-muted-foreground">
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
              ? "rounded-lg border border-border bg-muted/40 p-3 text-sm"
              : "rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
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
        <Skeleton className="h-32 w-full" />
      ) : status === "error" ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Could not load your devices.</Trans>{" "}
          <button className="underline" onClick={props.onRetry}>
            <Trans>Retry</Trans>
          </button>
        </p>
      ) : providers.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">
              <Trans>No cloud devices are available on this server</Trans>
            </p>
            <p className="text-sm text-muted-foreground">
              <Trans>
                Your server operator has not enabled any vendor. The mobile app still syncs Apple
                Health and Health Connect.
              </Trans>
            </p>
          </CardContent>
        </Card>
      ) : (
        providers.map((row) => <ProviderCard key={row.provider} row={row} {...props} />)
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
    <Card data-provider={row.provider}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span>{name}</span>
          <Badge variant={row.status === "active" ? "default" : "outline"}>
            {i18n._(wearableStatusLabel(row.status))}
          </Badge>
        </CardTitle>
        <CardDescription>
          {i18n._(wearableSendsLabel(row.provider))}{" "}
          <a href={row.termsUrl} target="_blank" rel="noreferrer" className="underline">
            <Trans>Vendor terms</Trans>
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {row.status !== "not_connected" ? (
          <p className="text-muted-foreground">
            {lastSynced ? t`Last synced ${lastSynced}` : t`Not synced yet`}
          </p>
        ) : null}
        {error && row.status !== "quarantined" ? (
          <p className="text-destructive">{i18n._(error)}</p>
        ) : null}
        {syncRequestedFor === row.provider ? (
          <p className="text-muted-foreground">
            <Trans>Sync requested. It runs on the next scheduled pass.</Trans>
          </p>
        ) : null}

        {actions.resolveQuarantine ? (
          <div className="grid gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <p>
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
                onClick={() =>
                  onConfirmChange({ kind: "deleteQuarantined", provider: row.provider })
                }
              >
                <Trans>Delete records</Trans>
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {actions.connect ? (
            <Button disabled={busy} onClick={() => onConnect(row.provider)}>
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
      </CardContent>
    </Card>
  );
}
