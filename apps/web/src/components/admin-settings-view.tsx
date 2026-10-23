import { Trans, useLingui } from "@lingui/react/macro";
import { Badge } from "@openvalens/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import type { AdminConfigurationEntry } from "@/utils/admin-settings-keys";

export type AdminSettingsViewProps = {
  accessState: "loading" | "error" | "denied" | "granted";
  configState?: "loading" | "error" | "denied" | "ready";
  entries?: AdminConfigurationEntry[];
  onRetryAccess?: () => void;
  onRetryConfig?: () => void;
};

export function AdminSettingsView({
  accessState,
  configState,
  entries,
  onRetryAccess,
  onRetryConfig,
}: AdminSettingsViewProps) {
  const { t } = useLingui();
  return (
    <main className="container mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">
          <Trans>Instance configuration</Trans>
        </h1>
        <p className="text-sm text-muted-foreground">
          <Trans>Administration</Trans>
        </p>
      </div>

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
    </main>
  );
}

function ConfigurationList({ entries }: { entries: AdminConfigurationEntry[] }) {
  const { t } = useLingui();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Environment configuration</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          <Trans>
            Startup configuration is read-only. Values are hidden for security, even for
            non-sensitive keys.
          </Trans>
        </p>

        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No configuration keys reported.</Trans>
          </p>
        ) : (
          <ul className="grid gap-2" role="list" aria-label={t`Configuration keys`}>
            {entries.map((entry) => (
              <ConfigurationRow key={entry.key} entry={entry} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ConfigurationRow({ entry }: { entry: AdminConfigurationEntry }) {
  const { t } = useLingui();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
      <code className="break-all text-sm font-medium">{entry.key}</code>
      <div className="flex flex-wrap gap-2">
        {entry.configured ? (
          <Badge variant="default" aria-label={t`${entry.key} configured`}>
            <Trans>Configured</Trans>
          </Badge>
        ) : (
          <Badge variant="secondary" aria-label={t`${entry.key} not set`}>
            <Trans>Not set</Trans>
          </Badge>
        )}
        {entry.sensitive ? (
          <Badge variant="outline" aria-label={t`${entry.key} sensitive`}>
            <Trans>Sensitive</Trans>
          </Badge>
        ) : null}
      </div>
    </li>
  );
}

function LoadingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Environment configuration</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </CardContent>
    </Card>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Environment configuration</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {message}{" "}
          {onRetry ? (
            <button className="underline" onClick={onRetry}>
              <Trans>Retry</Trans>
            </button>
          ) : null}
        </p>
      </CardContent>
    </Card>
  );
}

function DeniedCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Access denied</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          <Trans>You do not have access to instance administration.</Trans>
        </p>
      </CardContent>
    </Card>
  );
}
