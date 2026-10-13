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
  return (
    <main className="container mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Instance configuration</h1>
        <p className="text-sm text-muted-foreground">Administration</p>
      </div>

      {accessState === "loading" ? (
        <LoadingCard />
      ) : accessState === "error" ? (
        <ErrorCard message="Could not verify admin access." onRetry={onRetryAccess} />
      ) : accessState === "denied" ? (
        <DeniedCard />
      ) : configState === "loading" ? (
        <LoadingCard />
      ) : configState === "error" ? (
        <ErrorCard message="Could not load instance configuration." onRetry={onRetryConfig} />
      ) : configState === "denied" ? (
        <DeniedCard />
      ) : (
        <ConfigurationList entries={entries ?? []} />
      )}
    </main>
  );
}

function ConfigurationList({ entries }: { entries: AdminConfigurationEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Environment configuration</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Startup configuration is read-only. Values are hidden for security, even for non-sensitive
          keys.
        </p>

        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No configuration keys reported.</p>
        ) : (
          <ul className="grid gap-2" role="list" aria-label="Configuration keys">
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
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
      <code className="break-all text-sm font-medium">{entry.key}</code>
      <div className="flex flex-wrap gap-2">
        {entry.configured ? (
          <Badge variant="default" aria-label={`${entry.key} configured`}>
            Configured
          </Badge>
        ) : (
          <Badge variant="secondary" aria-label={`${entry.key} not set`}>
            Not set
          </Badge>
        )}
        {entry.sensitive ? (
          <Badge variant="outline" aria-label={`${entry.key} sensitive`}>
            Sensitive
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
        <CardTitle>Environment configuration</CardTitle>
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
        <CardTitle>Environment configuration</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {message}{" "}
          {onRetry ? (
            <button className="underline" onClick={onRetry}>
              Retry
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
        <CardTitle>Access denied</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          You do not have access to instance administration.
        </p>
      </CardContent>
    </Card>
  );
}
