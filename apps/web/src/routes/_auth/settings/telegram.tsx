import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BellRing, ChevronLeft, Send, Timer } from "lucide-react";

import { Page, PageHeader, Section, StatusPill } from "@/components/page";
import { SettingsGroup, SettingsRow } from "@/components/settings-rows";
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
        <Skeleton className="h-32 w-full rounded-3xl" />
      </Page>
    );
  }

  const connected = status.data?.connected;
  const pendingLink = connect.isSuccess && connect.data && !connected ? connect.data : null;

  return (
    <Page width="narrow">
      <PageHeader
        title="Telegram"
        actions={
          <Link
            to="/settings"
            className="inline-flex items-center gap-1 rounded-full px-1 text-sm font-medium text-ink-2 underline decoration-signal underline-offset-[0.15em] hover:text-ink hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:decoration-2"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            <Trans>Settings</Trans>
          </Link>
        }
      />

      <Section title={<Trans>Daily reminders over Telegram</Trans>} icon={BellRing} tone="signal">
        <SettingsGroup>
          <SettingsRow
            icon={Send}
            label={
              <StatusPill tone={connected ? "good" : "neutral"}>
                {connected ? t`Connected` : t`Not connected`}
              </StatusPill>
            }
            description={
              connected
                ? t`Daily reminders will be sent to your Telegram chat.`
                : t`Connect a Telegram chat to receive daily reminders.`
            }
          >
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
          </SettingsRow>
          {pendingLink ? (
            <div className="grid gap-3 py-4 text-sm">
              {pendingLink.link ? (
                <>
                  <p className="max-w-[60ch] text-ink-2">
                    <Trans>
                      Open the link in Telegram and press Start. This page updates once the chat is
                      connected.
                    </Trans>
                  </p>
                  <Button asChild variant="outline" className="w-fit">
                    <a href={pendingLink.link} target="_blank" rel="noreferrer">
                      <Trans>Open in Telegram</Trans>
                    </a>
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-ink-2">
                    <Trans>Send this message to this server's Telegram bot:</Trans>
                  </p>
                  <p className="num rounded-xl bg-paper-2 px-3 py-2 break-all text-ink">
                    /start {pendingLink.token}
                  </p>
                </>
              )}
              <p className="flex items-center gap-1.5 text-ink-3">
                <Timer className="size-4" aria-hidden="true" />
                <Trans>Expires {new Date(pendingLink.expiresAt).toLocaleString()}.</Trans>
              </p>
            </div>
          ) : connect.isError ? (
            <p role="alert" className="py-4 text-sm text-destructive">
              <Trans>Could not generate a connect link.</Trans>
            </p>
          ) : null}
        </SettingsGroup>
      </Section>
    </Page>
  );
}
