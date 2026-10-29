import { Trans, useLingui } from "@lingui/react/macro";
import {
  aiUsageLimitMessage,
  aiUsageLimitOf,
  relativeTime,
} from "@openvalens/api/presenters/cochat";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { cn } from "@openvalens/ui/lib/utils";
import { ArrowLeft, Send, Sparkles } from "lucide-react";

import { ErrorState, ToneIcon } from "@/components/page";
import { orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";

export const Route = createFileRoute("/_auth/coach/$conversationId")({
  component: CoachThreadPage,
});

function CoachThreadPage() {
  const { conversationId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settingsQuery = useProductSettings();
  const settings = settingsQuery.data;
  const { t, i18n } = useLingui();

  const messages = useQuery(orpc.ai.listMessages.queryOptions({ input: { conversationId } }));

  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.data?.length]);

  const send = useMutation(
    orpc.ai.chat.mutationOptions({
      onSuccess: async () => {
        setInput("");
        await queryClient.invalidateQueries({ queryKey: orpc.ai.listMessages.key() });
        await queryClient.invalidateQueries({ queryKey: orpc.ai.listThreads.key() });
      },
    }),
  );

  const submit = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    // The server keeps the history; send only the new message.
    send.mutate({ conversationId, message: trimmed });
  };

  if (messages.isPending) {
    return (
      <div className="grid max-w-[68ch] gap-4" aria-hidden="true">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-20 w-4/5 rounded-3xl" />
        <Skeleton className="ml-auto h-16 w-3/5 rounded-3xl" />
        <Skeleton className="h-12 w-full rounded-full" />
      </div>
    );
  }

  if (messages.isError || !messages.data) {
    return (
      <ErrorState
        title={<Trans>Could not load this conversation.</Trans>}
        action={
          <Button variant="outline" size="sm" onClick={() => void messages.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        }
      />
    );
  }

  const list = messages.data;
  // Issue #299: a used-up monthly allowance is not a failure; say when it resets.
  const usageLimit = send.isError ? aiUsageLimitOf(send.error) : false;

  return (
    <section className="grid max-w-[68ch] gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to="/coach"
          className="inline-flex items-center gap-1.5 rounded-full px-1 text-sm font-medium text-ink-2 no-underline hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:invisible"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          <Trans>All conversations</Trans>
        </Link>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: "/coach" })}
          disabled={send.isPending}
        >
          <Trans>New conversation</Trans>
        </Button>
      </div>

      <div
        ref={listRef}
        className="grid max-h-[calc(100dvh-18rem)] min-h-64 content-start gap-4 overflow-y-auto px-1 py-2"
      >
        {list.length === 0 ? (
          <p className="py-6 text-ink-3">
            <Trans>No messages yet. Say hello to start.</Trans>
          </p>
        ) : (
          list.map((message) => {
            const mine = message.role === "user";
            return (
              <article
                key={message.id}
                className={cn("flex items-end gap-2.5", mine ? "justify-end" : "justify-start")}
              >
                {mine ? null : <ToneIcon icon={Sparkles} tone="signal" size="sm" />}
                <div
                  className={cn(
                    "grid max-w-[85%] gap-1 px-4 py-3",
                    mine
                      ? "rounded-3xl rounded-br-lg bg-sidebar-accent"
                      : "rounded-3xl rounded-bl-lg border border-rule bg-card shadow-sm",
                  )}
                >
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-semibold text-ink">{mine ? t`You` : t`Coach`}</span>
                    <span className="text-ink-3">
                      {i18n._(relativeTime(message.createdAt, new Date(), settings))}
                    </span>
                  </p>
                  <div className="whitespace-pre-wrap text-ink-2">{message.content}</div>
                </div>
              </article>
            );
          })
        )}
        {send.isPending ? (
          <p role="status" className="flex items-center gap-2.5 text-sm text-ink-3">
            <ToneIcon icon={Sparkles} tone="signal" size="sm" />
            <Trans>Coach is thinking…</Trans>
          </p>
        ) : null}
        {usageLimit ? (
          <p role="status" className="rounded-2xl bg-paper-2 px-4 py-3 text-sm text-ink-2">
            {i18n._(aiUsageLimitMessage(usageLimit.resetsOn, i18n.locale))}
          </p>
        ) : send.isError ? (
          <p role="alert" className="text-sm text-destructive">
            <Trans>Could not send. Check AI consent in Settings.</Trans>
          </p>
        ) : null}
      </div>

      <form
        className="sheet sticky bottom-2 flex items-center gap-2 rounded-full p-1.5 pl-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          className="flex-1 rounded-full border-transparent bg-transparent shadow-none"
          aria-label={t`Ask the coach anything…`}
          placeholder={t`Ask the coach anything…`}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={send.isPending}
        />
        <Button type="submit" disabled={send.isPending || input.trim().length === 0}>
          <Send aria-hidden="true" />
          {send.isPending ? t`Sending…` : t`Send`}
        </Button>
      </form>
    </section>
  );
}
