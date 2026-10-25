import { Trans, useLingui } from "@lingui/react/macro";
import { Badge } from "@openvalens/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import type { ReactNode } from "react";

import type { AdminBackupStatusOutput } from "@/utils/admin-settings-keys";

/**
 * Issue #64 — the self-host backup panel on /admin/settings. Read-only: backups
 * are taken, verified and restored with `deploy/setup.sh` on the server.
 */
export type AdminBackupStatusProps =
  | { status: "loading" }
  | { status: "error"; onRetry?: () => void }
  | { status: "ready"; backups: AdminBackupStatusOutput };

export function AdminBackupStatus(props: AdminBackupStatusProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Backups</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.status === "loading" ? (
          <>
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-14 w-full" />
          </>
        ) : props.status === "error" ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Could not load the backup status.</Trans>{" "}
            {props.onRetry ? (
              <button className="underline" onClick={props.onRetry}>
                <Trans>Retry</Trans>
              </button>
            ) : null}
          </p>
        ) : (
          <BackupDetails backups={props.backups} />
        )}
      </CardContent>
    </Card>
  );
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "";
}

function bytes(n: number | null): string {
  if (n === null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function BackupDetails({ backups }: { backups: AdminBackupStatusOutput }) {
  const { t } = useLingui();
  const trigger = (value: string) =>
    value === "daily"
      ? t`daily`
      : value === "pre-migrate"
        ? t`before an upgrade`
        : value === "manual"
          ? t`manual`
          : value;
  const operation = (value: string) =>
    value === "backup" ? t`Backup` : value === "verify" ? t`Verify` : t`Restore`;

  if (backups.state === "off" || backups.state === "unknown") {
    return (
      <>
        <StateBadge state={backups.state} />
        <p className="text-sm text-muted-foreground">
          {backups.state === "off" ? (
            <Trans>
              No backup has been reported. The self-host stack backs up daily and before every
              upgrade; see docs/self-hosting/backup.md.
            </Trans>
          ) : (
            <Trans>The backup status could not be read.</Trans>
          )}
        </p>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <StateBadge state={backups.state} />
        {backups.offsite.state === "failing" ? (
          <Badge variant="destructive">
            <Trans>Off-site copy failing</Trans>
          </Badge>
        ) : null}
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <Item label={t`Last backup`}>
          {backups.lastBackup ? (
            <Trans>
              {when(backups.lastBackup.at)} ({trigger(backups.lastBackup.trigger)},{" "}
              {bytes(backups.lastBackup.sizeBytes)} encrypted)
            </Trans>
          ) : (
            <Trans>None yet</Trans>
          )}
        </Item>
        <Item label={t`Last verify`}>
          {backups.lastVerify ? (
            backups.lastVerify.outcome === "ok" ? (
              <Trans>Passed {when(backups.lastVerify.at)}</Trans>
            ) : (
              <Trans>Failed {when(backups.lastVerify.at)}</Trans>
            )
          ) : (
            <Trans>None yet</Trans>
          )}
        </Item>
        <Item label={t`Next scheduled backup`}>
          {backups.schedule?.nextRunAt ? (
            <Trans>
              {when(backups.schedule.nextRunAt)} (keeping {backups.schedule.dailyRetain} daily
              backups)
            </Trans>
          ) : (
            <Trans>Not scheduled</Trans>
          )}
        </Item>
        <Item label={t`Last failure`}>
          {backups.lastFailure ? (
            <Trans>
              {operation(backups.lastFailure.operation)} ({trigger(backups.lastFailure.trigger)}) at
              step "{backups.lastFailure.step ?? "-"}", {when(backups.lastFailure.at)}
            </Trans>
          ) : (
            <Trans>None</Trans>
          )}
        </Item>
        <Item label={t`Off-site copy`}>
          {backups.offsite.state === "failing" && backups.offsite.lastFailure ? (
            <span className="text-destructive">
              <Trans>
                Upload failed at step "{backups.offsite.lastFailure.step ?? "-"}",{" "}
                {when(backups.offsite.lastFailure.at)}; retrying
              </Trans>
            </span>
          ) : backups.offsite.lastUpload ? (
            <Trans>Last upload {when(backups.offsite.lastUpload.at)}</Trans>
          ) : (
            <Trans>Not configured</Trans>
          )}
        </Item>
      </dl>
      <p className="text-sm text-muted-foreground">
        <Trans>
          Backups are encrypted with the key in deploy/secrets/backup/age-identity on the server.
          Keep a copy of that file somewhere else: without it no backup can be restored.
        </Trans>
      </p>
    </>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 rounded-lg border px-4 py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function StateBadge({ state }: { state: AdminBackupStatusOutput["state"] }) {
  switch (state) {
    case "ok":
      return (
        <Badge variant="default">
          <Trans>Backups healthy</Trans>
        </Badge>
      );
    case "failing":
      return (
        <Badge variant="destructive">
          <Trans>Backups failing</Trans>
        </Badge>
      );
    case "stale":
      return (
        <Badge variant="destructive">
          <Trans>No recent backup</Trans>
        </Badge>
      );
    case "off":
      return (
        <Badge variant="secondary">
          <Trans>Not reported</Trans>
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary">
          <Trans>Unknown</Trans>
        </Badge>
      );
  }
}
