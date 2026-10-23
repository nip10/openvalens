import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/settings/telegram")({
  component: TelegramSettingsPage,
});

function TelegramSettingsPage() {
  const status = useQuery(orpc.telegram.status.queryOptions({ input: {} }));
  const queryClient = useQueryClient();
  const { t } = useLingui();

  const connect = useMutation(
    orpc.telegram.issueConnectToken.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ["telegram", "status"] });
      },
    }),
  );

  if (status.isPending) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Telegram</h1>
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const connected = status.data?.connected;

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-semibold">Telegram</h1>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Daily reminders over Telegram</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div>
            <div className="font-medium">{connected ? t`Connected` : t`Not connected`}</div>
            <div className="text-sm text-muted-foreground">
              {connected
                ? t`Daily reminders will be sent to your Telegram chat.`
                : t`Connect a Telegram chat to receive daily reminders.`}
            </div>
          </div>
          <Button onClick={() => connect.mutate({})} disabled={connect.isPending}>
            {connect.isPending ? t`Generating link…` : connected ? t`Re-link` : t`Connect`}
          </Button>
        </CardContent>
        {connect.isSuccess && connect.data ? (
          <CardContent>
            <p className="text-sm text-muted-foreground">
              <Trans>Open this link in Telegram and press Start:</Trans>
            </p>
            <p className="mt-2 break-all rounded-lg border border-border bg-muted/40 p-2 font-mono text-sm">
              {connect.data?.token}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              <Trans>Expires {new Date(connect.data?.expiresAt ?? "").toLocaleString()}.</Trans>
            </p>
          </CardContent>
        ) : connect.isError ? (
          <CardContent>
            <p className="text-sm text-destructive">
              <Trans>Could not generate a connect link.</Trans>
            </p>
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}
