import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { previewLine, relativeTime, truncate } from "@openvalens/api/presenters/cochat";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  createFileRoute,
  useChildMatches,
  useNavigate,
} from "@tanstack/react-router";
import { useState } from "react";

import { EmptyState, ErrorState, Page, PageHeader } from "@/components/page";
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
          "Hi coach, give me a one-line summary of where I am today and one concrete suggestion.",
        comment:
          "First message sent to the AI coach for a new conversation; shown as the person's own message",
      }),
    });
  };

  // The list is the layout's quiet left column; a conversation opens beside it.
  const hasThread = useChildMatches().length > 0;
  const list = threads.data ?? [];

  return (
    <Page>
      <PageHeader
        title={<Trans>Coach</Trans>}
        actions={
          <Button onClick={onNew} disabled={starting || start.isPending}>
            {start.isPending ? t`Starting…` : t`New conversation`}
          </Button>
        }
      />

      <ProductSettingsStatus />

      {start.isError ? (
        <ErrorState
          title={
            <Trans>Could not start a conversation. Check that AI is enabled in Settings.</Trans>
          }
        />
      ) : null}

      <div
        className={
          hasThread
            ? "grid items-start gap-10 lg:grid-cols-[16rem_minmax(0,1fr)]"
            : "grid max-w-3xl items-start"
        }
      >
        <nav
          aria-label={t`Conversations`}
          className={hasThread ? "order-last lg:order-none" : undefined}
        >
          {threads.isPending ? (
            <div className="grid gap-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : threads.isError || !threads.data ? (
            <ErrorState
              title={<Trans>Could not load threads.</Trans>}
              action={
                <Button variant="outline" size="sm" onClick={() => void threads.refetch()}>
                  <Trans>Retry</Trans>
                </Button>
              }
            />
          ) : list.length === 0 ? (
            <EmptyState
              title={<Trans>No conversations yet</Trans>}
              description={
                <Trans>Start a new conversation to ask the AI coach for guidance.</Trans>
              }
            />
          ) : (
            <ul className="divide-y divide-rule border-t border-rule">
              {list.map((thread) => (
                <li key={thread.conversationId}>
                  <Link
                    to="/coach/$conversationId"
                    params={{ conversationId: thread.conversationId }}
                    className="grid gap-0.5 px-2 py-3 text-ink-2 transition-colors duration-[var(--dur-short)] hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    activeProps={{ className: "bg-paper-2 text-ink", "aria-current": "page" }}
                  >
                    <span className="truncate font-display text-sm font-medium">
                      {truncate(previewLine(thread), 80)}
                    </span>
                    <span className="flex flex-wrap justify-between gap-x-3 text-sm text-ink-3">
                      <span>
                        {i18n._(relativeTime(thread.lastMessageAt, new Date(), settings))}
                      </span>
                      <span>
                        <Plural value={thread.messageCount} one="# message" other="# messages" />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </nav>

        {hasThread ? (
          <div className="min-w-0">
            <Outlet />
          </div>
        ) : null}
      </div>
    </Page>
  );
}
