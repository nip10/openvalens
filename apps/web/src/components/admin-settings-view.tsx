import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openvalens/ui/components/table";
import { Skeleton } from "@openvalens/ui/components/skeleton";

import { Settings2, ShieldX } from "lucide-react";

import {
  Details,
  EmptyState,
  ErrorState,
  Figure,
  PageHeader,
  Section,
  StatusPill,
} from "@/components/page";
import type { AdminConfigurationEntry } from "@/utils/admin-settings-keys";

export type AdminSettingsViewProps = {
  accessState: "loading" | "error" | "denied" | "granted";
  configState?: "loading" | "error" | "denied" | "ready";
  entries?: AdminConfigurationEntry[];
  onRetryAccess?: () => void;
  onRetryConfig?: () => void;
};

/**
 * The head of the instance screen and its configuration inventory. Rendered
 * inside the route's `Page`; the route adds the display defaults and backups.
 */
export function AdminSettingsView({
  accessState,
  configState,
  entries,
  onRetryAccess,
  onRetryConfig,
}: AdminSettingsViewProps) {
  const { t } = useLingui();
  return (
    <>
      <PageHeader
        title={<Trans>Instance configuration</Trans>}
        description={<Trans>Administration</Trans>}
      />

      {accessState === "loading" ? (
        <LoadingCard />
      ) : accessState === "error" ? (
        <ErrorCard message={t`Could not verify admin access.`} onRetry={onRetryAccess} />
      ) : accessState === "denied" ? (
        <DeniedCard />
      ) : configState === "loading" ? (
        <LoadingCard />
      ) : configState === "error" ? (
        <ErrorCard message={t`Could not load instance configuration.`} onRetry={onRetryConfig} />
      ) : configState === "denied" ? (
        <DeniedCard />
      ) : (
        <ConfigurationList entries={entries ?? []} />
      )}
    </>
  );
}

function ConfigurationList({ entries }: { entries: AdminConfigurationEntry[] }) {
  const { t } = useLingui();
  const configured = entries.filter((entry) => entry.configured).length;
  const sensitive = entries.filter((entry) => entry.sensitive).length;
  return (
    <Section
      icon={Settings2}
      tone="signal"
      title={<Trans>Environment configuration</Trans>}
      info={
        <Trans>
          Startup configuration is read-only. Values are hidden for security, even for non-sensitive
          keys.
        </Trans>
      }
    >
      {entries.length === 0 ? (
        <EmptyState icon={Settings2} title={<Trans>No configuration keys reported.</Trans>} />
      ) : (
        <div className="sheet grid gap-4 p-5">
          <dl className="m-0 grid grid-cols-3 gap-4">
            <Figure label={<Trans>Keys</Trans>} value={entries.length} />
            <Figure label={<Trans>Configured</Trans>} value={configured} />
            <Figure label={<Trans>Sensitive</Trans>} value={sensitive} />
          </dl>
          <Details summary={<Trans>All keys</Trans>}>
            <Table aria-label={t`Configuration keys`}>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Trans>Name</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Status</Trans>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <ConfigurationRow key={entry.key} entry={entry} />
                ))}
              </TableBody>
            </Table>
          </Details>
        </div>
      )}
    </Section>
  );
}

function ConfigurationRow({ entry }: { entry: AdminConfigurationEntry }) {
  const { t } = useLingui();
  return (
    <TableRow>
      <TableCell className="py-2.5 whitespace-normal">
        <code className="text-sm break-all text-ink">{entry.key}</code>
      </TableCell>
      <TableCell className="py-2.5">
        <span className="flex flex-wrap gap-1.5">
          {entry.configured ? (
            <span aria-label={t`${entry.key} configured`}>
              <StatusPill tone="good">
                <Trans>Configured</Trans>
              </StatusPill>
            </span>
          ) : (
            <span aria-label={t`${entry.key} not set`}>
              <StatusPill tone="neutral">
                <Trans>Not set</Trans>
              </StatusPill>
            </span>
          )}
          {entry.sensitive ? (
            <span aria-label={t`${entry.key} sensitive`}>
              <StatusPill tone="warn">
                <Trans>Sensitive</Trans>
              </StatusPill>
            </span>
          ) : null}
        </span>
      </TableCell>
    </TableRow>
  );
}

function LoadingCard() {
  return (
    <Section icon={Settings2} tone="signal" title={<Trans>Environment configuration</Trans>}>
      <div className="sheet grid gap-3 p-5">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    </Section>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Section icon={Settings2} tone="signal" title={<Trans>Environment configuration</Trans>}>
      <ErrorState
        title={message}
        action={
          onRetry ? (
            <Button variant="outline" onClick={onRetry}>
              <Trans>Retry</Trans>
            </Button>
          ) : undefined
        }
      />
    </Section>
  );
}

function DeniedCard() {
  return (
    <EmptyState
      icon={ShieldX}
      title={<Trans>Access denied</Trans>}
      description={<Trans>You do not have access to instance administration.</Trans>}
    />
  );
}
