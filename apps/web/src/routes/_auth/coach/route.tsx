import { previewLine, relativeTime, truncate } from "@openvalens/api/presenters/cochat";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent } from "@openvalens/ui/components/card";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { ProductSettingsStatus } from "@/components/product-settings-status";
import { orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";

export const Route = createFileRoute("/_auth/coach")({
  component: CoachListPage,
});

function CoachListPage() {
  const threads = useQuery(orpc.ai.listThreads.queryOptions({ input: { limit: 50 } }));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const settingsQuery = useProductSettings();
  const settings = settingsQuery.data;

  const start = useMutation(
    orpc.ai.chat.mutationOptions({
      onSuccess: async (result) => {
        await queryClient.invalidateQueries({ queryKey: ["ai", "listThreads"] });
        await navigate({
          to: "/coach/$conversationId",
          params: { conversationId: result.conversationId },
        });
      },
    }),
  );

  const onNew = () => {
    setStarting(true);
    start.mutate({
      conversationId: crypto.randomUUID(),
      messages: [
        {
          role: "user",
          content:
            "Hi coach — give me a one-line summary of where I am today and one concrete suggestion.",
        },
      ],
    });
  };

  if (threads.isPending) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="mb-6 flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold">Coach</h1>
        </div>
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (threads.isError || !threads.data) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Coach</h1>
        <p className="text-sm text-muted-foreground">
          Could not load threads.{" "}
          <button className="underline" onClick={() => void threads.refetch()}>
            Retry
          </button>
        </p>
      </div>
    );
  }

  const list = threads.data;

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Coach</h1>
        <Button onClick={onNew} disabled={starting || start.isPending}>
          {start.isPending ? "Starting…" : "New conversation"}
        </Button>
      </div>

      <ProductSettingsStatus />

      {start.isError ? (
        <p className="mb-4 text-sm text-destructive">
          Could not start a conversation. Check that AI is enabled in Settings.
        </p>
      ) : null}

      {list.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">No conversations yet</p>
            <p className="text-sm text-muted-foreground">
              Start a new conversation to ask the AI coach for guidance.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <ul className="divide-y divide-border">
            {list.map((thread) => (
              <li key={thread.conversationId}>
                <Link
                  to="/coach/$conversationId"
                  params={{ conversationId: thread.conversationId }}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-muted-foreground">
                      {relativeTime(thread.lastMessageAt, new Date(), settings)} ·{" "}
                      {thread.messageCount} message
                      {thread.messageCount === 1 ? "" : "s"}
                    </div>
                    <div className="truncate font-medium">{truncate(previewLine(thread), 80)}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
