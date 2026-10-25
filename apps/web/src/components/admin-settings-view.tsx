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

import { EmptyState, ErrorState, PageHeader, Section } from "@/components/page";
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
  return (
    <Section
      title={<Trans>Environment configuration</Trans>}
      description={
        <Trans>
          Startup configuration is read-only. Values are hidden for security, even for non-sensitive
          keys.
        </Trans>
      }
    >
      {entries.length === 0 ? (
        <EmptyState title={<Trans>No configuration keys reported.</Trans>} />
      ) : (
        <Table aria-label={t`Configuration keys`} className="sheet">
          <TableHeader>
            <TableRow>
              <TableHead className="px-5">
                <Trans>Name</Trans>
              </TableHead>
              <TableHead className="px-5">
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
      )}
    </Section>
  );
}

function ConfigurationRow({ entry }: { entry: AdminConfigurationEntry }) {
  const { t } = useLingui();
  return (
    <TableRow>
      <TableCell className="px-5 py-2.5 whitespace-normal">
        <code className="font-mono text-sm break-all text-ink">{entry.key}</code>
      </TableCell>
      <TableCell className="px-5 py-2.5">
        <span className="flex flex-wrap gap-x-3 gap-y-0.5">
          {entry.configured ? (
            <span className="font-medium text-success" aria-label={t`${entry.key} configured`}>
              <Trans>Configured</Trans>
            </span>
          ) : (
            <span className="text-ink-3" aria-label={t`${entry.key} not set`}>
              <Trans>Not set</Trans>
            </span>
          )}
          {entry.sensitive ? (
            <span className="text-ink-2" aria-label={t`${entry.key} sensitive`}>
              <Trans>Sensitive</Trans>
            </span>
          ) : null}
        </span>
      </TableCell>
    </TableRow>
  );
}

function LoadingCard() {
  return (
    <Section title={<Trans>Environment configuration</Trans>}>
      <div className="sheet grid gap-3 px-5 py-4">
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
    <Section title={<Trans>Environment configuration</Trans>}>
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
      title={<Trans>Access denied</Trans>}
      description={<Trans>You do not have access to instance administration.</Trans>}
    />
  );
}
