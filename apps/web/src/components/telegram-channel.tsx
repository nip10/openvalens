import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Timer } from "lucide-react";

import { ErrorState, InfoTip, StatusPill } from "@/components/page";
import { orpc } from "@/utils/orpc";

/** What a Telegram reminder holds and when it comes (#settings-telegram-1). */
export function TelegramReminderInfo() {
  return (
    <InfoTip>
      <p>
        <Trans>
          At your reminder time, one message for each supplement, medication or scheduled event due
          that day. React with 👍 when it's done or 👎 to skip it.
        </Trans>
      </p>
      <p>
        <Trans>
          A message names the item, such as a medication, and never a measurement. Anyone who can
          read your Telegram can see it.
        </Trans>
      </p>
    </InfoTip>
  );
}

/**
 * Telegram as a daily reminder channel: its state, Connect or Disconnect,
 * and the link to open while connecting. Lives with the other reminder
 * channels in Settings › Notifications; Settings › Telegram shows the same.
 */
export function TelegramChannel() {
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
        void queryClient.invalidateQueries({ queryKey: orpc.insights.key() });
      },
    }),
  );
  // While a connect link is open, poll so the row flips to Connected once the
  // member presses Start in Telegram.
  const waiting = connect.isSuccess;
  const status = useQuery({
    ...orpc.telegram.status.queryOptions({ input: {} }),
    refetchInterval: (query) => (waiting && !query.state.data?.connected ? 3000 : false),
  });

  if (status.isPending) return <Skeleton className="h-10 w-full rounded-2xl" />;

  // Without a status there is nothing true to say: not "Not connected".
  if (status.isError && !status.data) {
    return (
      <ErrorState
        title={<Trans>Could not check your Telegram connection.</Trans>}
        action={
          <Button variant="outline" size="sm" onClick={() => void status.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        }
      />
    );
  }

  const connected = status.data?.connected;
  const pendingLink = connect.isSuccess && connect.data && !connected ? connect.data : null;

  return (
    <div className="grid gap-3">
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="flex items-center gap-2 text-ink-2">
          Telegram
          <StatusPill tone={connected ? "good" : "neutral"}>
            {connected ? t`Connected` : t`Not connected`}
          </StatusPill>
          <TelegramReminderInfo />
        </span>
        {connected ? (
          <Button
            size="sm"
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
          <Button
            size="sm"
            variant="outline"
            onClick={() => connect.mutate({})}
            disabled={connect.isPending}
          >
            {connect.isPending ? t`Generating link…` : t`Connect`}
          </Button>
        )}
      </div>
      {!connected && !pendingLink ? (
        <p className="text-sm text-ink-3">
          <Trans>Opens Telegram. Press Start in the chat with the OpenValens bot.</Trans>
        </p>
      ) : null}
      {pendingLink ? (
        <div className="grid gap-3 text-sm">
          {pendingLink.link ? (
            <>
              <p className="max-w-[60ch] text-ink-2">
                <Trans>
                  Open the link in Telegram and press Start. This page updates once the chat is
                  connected.
                </Trans>
              </p>
              <Button asChild size="sm" variant="outline" className="w-fit">
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
        <p role="alert" className="text-sm text-destructive">
          <Trans>Could not generate a connect link.</Trans>
        </p>
      ) : null}
    </div>
  );
}
