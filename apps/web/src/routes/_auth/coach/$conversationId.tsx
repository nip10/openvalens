import { relativeTime } from "@openvalens/api/presenters/cochat";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent } from "@openvalens/ui/components/card";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/coach/$conversationId")({
  component: CoachThreadPage,
});

function CoachThreadPage() {
  const { conversationId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
        await queryClient.invalidateQueries({ queryKey: ["ai", "listMessages"] });
        await queryClient.invalidateQueries({ queryKey: ["ai", "listThreads"] });
      },
    }),
  );

  const submit = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const history = (messages.data ?? []).map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));
    send.mutate({
      conversationId,
      messages: [...history, { role: "user" as const, content: trimmed }],
    });
  };

  if (messages.isPending) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (messages.isError || !messages.data) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Coach</h1>
        <p className="text-sm text-muted-foreground">
          Could not load this conversation.{" "}
          <button className="underline" onClick={() => void messages.refetch()}>
            Retry
          </button>
        </p>
      </div>
    );
  }

  const list = messages.data;

  return (
    <div className="container mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <Link to="/coach" className="text-sm text-muted-foreground underline">
          ← All conversations
        </Link>
        <Button
          variant="outline"
          onClick={() => navigate({ to: "/coach" })}
          disabled={send.isPending}
        >
          New conversation
        </Button>
      </div>

      <div
        ref={listRef}
        className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card p-4"
      >
        {list.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">
            No messages yet — say hello to start.
          </p>
        ) : (
          list.map((message) => (
            <Card
              key={message.id}
              className={message.role === "user" ? "border-primary-primary" : ""}
            >
              <CardContent className="p-3">
                <div className="mb-1 text-xs text-muted-foreground">
                  {message.role === "user" ? "You" : "Coach"} · {relativeTime(message.createdAt)}
                </div>
                <div className="whitespace-pre-wrap text-sm">{message.content}</div>
              </CardContent>
            </Card>
          ))
        )}
        {send.isPending ? (
          <Card>
            <CardContent className="p-3">
              <div className="mb-1 text-xs text-muted-foreground">Coach · thinking…</div>
              <div className="text-sm text-muted-foreground">…</div>
            </CardContent>
          </Card>
        ) : null}
        {send.isError ? (
          <p className="text-sm text-destructive">Could not send. Check AI consent in Settings.</p>
        ) : null}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          className="min-h-11 flex-1 rounded-lg border border-border bg-card px-3 text-base"
          placeholder="Ask the coach anything…"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={send.isPending}
        />
        <Button type="submit" disabled={send.isPending || input.trim().length === 0}>
          {send.isPending ? "Sending…" : "Send"}
        </Button>
      </form>
    </div>
  );
}
