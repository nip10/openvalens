import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { cn } from "@openvalens/ui/lib/utils";
import {
  Archive,
  CalendarClock,
  CloudUpload,
  DatabaseBackup,
  KeyRound,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { ErrorState, Section, StatusPill } from "@/components/page";
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
    <Section
      icon={DatabaseBackup}
      tone="signal"
      title={<Trans>Backups</Trans>}
      actions={props.status === "ready" ? <StateWord state={props.backups.state} /> : null}
    >
      {props.status === "loading" ? (
        <div className="sheet grid gap-3 p-5">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : props.status === "error" ? (
        <ErrorState
          title={<Trans>Could not load the backup status.</Trans>}
          action={
            props.onRetry ? (
              <Button variant="outline" onClick={props.onRetry}>
                <Trans>Retry</Trans>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <BackupDetails backups={props.backups} />
      )}
    </Section>
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
        <p className="sheet max-w-[65ch] p-5 text-sm text-ink-2">
          {backups.state === "off" ? (
            <Trans>
              No backup service has reported to this instance. On a platform deployment (Coolify,
              Dokploy, a managed database), backups are your provider's database backups: see
              docs/deployment.md, section 5. On the self-host stack, backups run daily and before
              every upgrade: see docs/self-hosting/backup.md.
            </Trans>
          ) : (
            <Trans>The backup status could not be read.</Trans>
          )}
        </p>
      </>
    );
  }

  const verifyFailed = backups.lastVerify?.outcome === "failed";
  const offsiteFailing = backups.offsite.state === "failing";

  return (
    <>
      {offsiteFailing ? (
        <p className="flex items-center gap-2 text-sm font-medium text-destructive">
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          <Trans>Off-site copy failing</Trans>
        </p>
      ) : null}
      <dl className="sheet m-0 grid divide-y divide-rule px-5 text-sm">
        <Item icon={Archive} label={t`Last backup`}>
          {backups.lastBackup ? (
            <Trans>
              {when(backups.lastBackup.at)} ({trigger(backups.lastBackup.trigger)},{" "}
              {bytes(backups.lastBackup.sizeBytes)} encrypted)
            </Trans>
          ) : (
            <Trans>None yet</Trans>
          )}
        </Item>
        <Item
          icon={ShieldCheck}
          label={t`Last verify`}
          tone={verifyFailed ? "text-destructive" : undefined}
        >
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
        <Item icon={CalendarClock} label={t`Next scheduled backup`}>
          {backups.schedule?.nextRunAt ? (
            <Trans>
              {when(backups.schedule.nextRunAt)} (keeping {backups.schedule.dailyRetain} daily
              backups)
            </Trans>
          ) : (
            <Trans>Not scheduled</Trans>
          )}
        </Item>
        <Item
          icon={TriangleAlert}
          label={t`Last failure`}
          tone={backups.lastFailure ? "text-destructive" : undefined}
        >
          {backups.lastFailure ? (
            <Trans>
              {operation(backups.lastFailure.operation)} ({trigger(backups.lastFailure.trigger)}) at
              step "{backups.lastFailure.step ?? "-"}", {when(backups.lastFailure.at)}
            </Trans>
          ) : (
            <Trans>None</Trans>
          )}
        </Item>
        <Item icon={CloudUpload} label={t`Off-site copy`}>
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
      <p className="flex max-w-[65ch] items-start gap-2 text-sm text-ink-3">
        <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <Trans>
          Backups are encrypted with the key in deploy/secrets/backup/age-identity on the server.
          Keep a copy of that file somewhere else: without it no backup can be restored.
        </Trans>
      </p>
    </>
  );
}

function Item({
  icon: Icon,
  label,
  tone,
  children,
}: {
  icon: LucideIcon;
  label: string;
  tone?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-x-6 gap-y-0.5 py-3 sm:grid-cols-[13rem_minmax(0,1fr)]">
      <dt className="flex items-center gap-2 text-ink-3">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {label}
      </dt>
      <dd className={cn("m-0 text-ink", tone)}>{children}</dd>
    </div>
  );
}

/** The overall state as a word on a tint; the word carries the meaning. */
function StateWord({ state }: { state: AdminBackupStatusOutput["state"] }) {
  switch (state) {
    case "ok":
      return (
        <StatusPill tone="good">
          <Trans>Backups healthy</Trans>
        </StatusPill>
      );
    case "failing":
      return (
        <StatusPill tone="bad">
          <Trans>Backups failing</Trans>
        </StatusPill>
      );
    case "stale":
      return (
        <StatusPill tone="warn">
          <Trans>No recent backup</Trans>
        </StatusPill>
      );
    case "off":
      return (
        <StatusPill tone="neutral">
          <Trans>Not reported</Trans>
        </StatusPill>
      );
    default:
      return (
        <StatusPill tone="neutral">
          <Trans>Unknown</Trans>
        </StatusPill>
      );
  }
}
