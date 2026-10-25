import { Trans, useLingui } from "@lingui/react/macro";
import { relativeTime } from "@openvalens/api/presenters/cochat";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { ErrorState } from "@/components/page";
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
      <div className="grid max-w-[68ch] gap-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-4/5" />
        <Skeleton className="h-9 w-full" />
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

  return (
    <section className="grid max-w-[68ch] gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to="/coach"
          className="font-display text-sm font-medium text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:invisible"
        >
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
        className="grid max-h-[calc(100dvh-18rem)] min-h-64 content-start gap-0 overflow-y-auto border-t-2 border-rule-2"
      >
        {list.length === 0 ? (
          <p className="py-6 text-ink-3">
            <Trans>No messages yet. Say hello to start.</Trans>
          </p>
        ) : (
          list.map((message) => (
            <article
              key={message.id}
              className={
                message.role === "user"
                  ? "grid gap-1 border-b border-rule bg-paper-2 px-4 py-4"
                  : "grid gap-1 border-b border-rule px-4 py-4"
              }
            >
              <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
                <span className="font-display font-medium text-ink">
                  {message.role === "user" ? t`You` : t`Coach`}
                </span>
                <span className="text-ink-3">
                  {i18n._(relativeTime(message.createdAt, new Date(), settings))}
                </span>
              </p>
              <div className="whitespace-pre-wrap text-ink-2">{message.content}</div>
            </article>
          ))
        )}
        {send.isPending ? (
          <p role="status" className="px-4 py-4 text-sm text-ink-3">
            <Trans>Coach is thinking…</Trans>
          </p>
        ) : null}
        {send.isError ? (
          <p role="alert" className="px-4 py-4 text-sm text-destructive">
            <Trans>Could not send. Check AI consent in Settings.</Trans>
          </p>
        ) : null}
      </div>

      <form
        className="sticky bottom-0 flex gap-2 border-t border-rule bg-background pt-3 pb-1"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          className="flex-1"
          aria-label={t`Ask the coach anything…`}
          placeholder={t`Ask the coach anything…`}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={send.isPending}
        />
        <Button type="submit" disabled={send.isPending || input.trim().length === 0}>
          {send.isPending ? t`Sending…` : t`Send`}
        </Button>
      </form>
    </section>
  );
}
