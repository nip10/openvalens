import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { Page, PageHeader, Section } from "@/components/page";
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
      <Page width="narrow">
        <PageHeader title="Telegram" />
        <Skeleton className="h-32 w-full" />
      </Page>
    );
  }

  const connected = status.data?.connected;

  return (
    <Page width="narrow">
      <PageHeader title="Telegram" />

      <Section title={<Trans>Daily reminders over Telegram</Trans>} sheet>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="grid gap-0.5">
            <span
              className={
                connected
                  ? "font-display font-medium text-success"
                  : "font-display font-medium text-ink-3"
              }
            >
              {connected ? t`Connected` : t`Not connected`}
            </span>
            <span className="text-sm text-ink-3">
              {connected
                ? t`Daily reminders will be sent to your Telegram chat.`
                : t`Connect a Telegram chat to receive daily reminders.`}
            </span>
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
        </div>
        {connect.isSuccess && connect.data && !connected ? (
          <div className="mt-4 grid gap-3 border-t border-rule pt-4 text-sm">
            {connect.data.link ? (
              <>
                <p className="max-w-[65ch] text-ink-2">
                  <Trans>
                    Open the link in Telegram and press Start. This page updates once the chat is
                    connected.
                  </Trans>
                </p>
                <Button asChild variant="outline" className="w-fit">
                  <a href={connect.data.link} target="_blank" rel="noreferrer">
                    <Trans>Open in Telegram</Trans>
                  </a>
                </Button>
              </>
            ) : (
              <>
                <p className="text-ink-2">
                  <Trans>Send this message to this server's Telegram bot:</Trans>
                </p>
                <p className="bg-paper-2 px-3 py-2 font-mono break-all text-ink">
                  /start {connect.data.token}
                </p>
              </>
            )}
            <p className="text-ink-3">
              <Trans>Expires {new Date(connect.data.expiresAt).toLocaleString()}.</Trans>
            </p>
          </div>
        ) : connect.isError ? (
          <p role="alert" className="mt-4 border-t border-rule pt-4 text-sm text-destructive">
            <Trans>Could not generate a connect link.</Trans>
          </p>
        ) : null}
      </Section>
    </Page>
  );
}
