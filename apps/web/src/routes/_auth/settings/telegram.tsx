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
  const queryClient = useQueryClient();
  const { t } = useLingui();

  const connect = useMutation(
    orpc.telegram.issueConnectToken.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.telegram.status.key() });
      },
    }),
  );
  const disconnect = useMutation(
    orpc.telegram.disconnect.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.telegram.status.key() });
      },
    }),
  );
  // While a connect link is open, poll so the page flips to Connected once the
  // member presses Start in Telegram.
  const waiting = connect.isSuccess;
  const status = useQuery({
    ...orpc.telegram.status.queryOptions({ input: {} }),
    refetchInterval: (query) => (waiting && !query.state.data?.connected ? 3000 : false),
  });

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
          {connected ? (
            <Button
              variant="outline"
              onClick={() => {
                connect.reset();
                disconnect.mutate({});
              }}
              disabled={disconnect.isPending}
            >
              {disconnect.isPending ? t`Disconnecting…` : t`Disconnect`}
            </Button>
          ) : (
            <Button onClick={() => connect.mutate({})} disabled={connect.isPending}>
              {connect.isPending ? t`Generating link…` : t`Connect`}
            </Button>
          )}
        </CardContent>
        {connect.isSuccess && connect.data && !connected ? (
          <CardContent className="grid gap-2 text-sm">
            {connect.data.link ? (
              <>
                <p className="text-muted-foreground">
                  <Trans>
                    Open the link in Telegram and press Start. This page updates once the chat is
                    connected.
                  </Trans>
                </p>
                <Button asChild className="w-fit">
                  <a href={connect.data.link} target="_blank" rel="noreferrer">
                    <Trans>Open in Telegram</Trans>
                  </a>
                </Button>
              </>
            ) : (
              <>
                <p className="text-muted-foreground">
                  <Trans>Send this message to this server's Telegram bot:</Trans>
                </p>
                <p className="break-all rounded-lg border border-border bg-muted/40 p-2 font-mono">
                  /start {connect.data.token}
                </p>
              </>
            )}
            <p className="text-xs text-muted-foreground">
              <Trans>Expires {new Date(connect.data.expiresAt).toLocaleString()}.</Trans>
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
