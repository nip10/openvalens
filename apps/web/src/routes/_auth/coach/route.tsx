import { Plural, Trans, useLingui } from "@lingui/react/macro";
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
  const { t, i18n } = useLingui();

  const start = useMutation(
    orpc.ai.chat.mutationOptions({
      onSuccess: async (result) => {
        await queryClient.invalidateQueries({ queryKey: orpc.ai.listThreads.key() });
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
      message: t({
        message:
          "Hi coach — give me a one-line summary of where I am today and one concrete suggestion.",
        comment:
          "First message sent to the AI coach for a new conversation; shown as the person's own message",
      }),
    });
  };

  if (threads.isPending) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="mb-6 flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold">
            <Trans>Coach</Trans>
          </h1>
        </div>
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (threads.isError || !threads.data) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">
          <Trans>Coach</Trans>
        </h1>
        <p className="text-sm text-muted-foreground">
          <Trans>Could not load threads.</Trans>{" "}
          <button className="underline" onClick={() => void threads.refetch()}>
            <Trans>Retry</Trans>
          </button>
        </p>
      </div>
    );
  }

  const list = threads.data;

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">
          <Trans>Coach</Trans>
        </h1>
        <Button onClick={onNew} disabled={starting || start.isPending}>
          {start.isPending ? t`Starting…` : t`New conversation`}
        </Button>
      </div>

      <ProductSettingsStatus />

      {start.isError ? (
        <p className="mb-4 text-sm text-destructive">
          <Trans>Could not start a conversation. Check that AI is enabled in Settings.</Trans>
        </p>
      ) : null}

      {list.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">
              <Trans>No conversations yet</Trans>
            </p>
            <p className="text-sm text-muted-foreground">
              <Trans>Start a new conversation to ask the AI coach for guidance.</Trans>
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
                      {i18n._(relativeTime(thread.lastMessageAt, new Date(), settings))} ·{" "}
                      <Plural value={thread.messageCount} one="# message" other="# messages" />
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
