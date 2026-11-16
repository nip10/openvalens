import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  aiUsageLimitMessage,
  aiUsageLimitOf,
  previewLine,
  relativeTime,
  truncate,
} from "@openvalens/api/presenters/cochat";
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
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { CoachComposer, CoachIdeas, CoachScopeLine, useCoachIdeas } from "@/components/coach-ideas";
import { CoachIcon } from "@/components/coach-icon";
import { ModuleHiddenNote } from "@/components/module-hidden-note";
import { EmptyState, ErrorState, Page, PageHeader, ToneIcon } from "@/components/page";
import { ProductSettingsStatus } from "@/components/product-settings-status";
import { useAiState } from "@/utils/ai-state";
import { orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";

/**
 * `ask` fills the message box with a question to edit (from "Ask the coach"
 * on an insight); `compose` puts the cursor there ("New conversation" from
 * an open conversation). Neither sends anything.
 */
const coachSearch = z.object({
  ask: z.string().max(500).optional().catch(undefined),
  compose: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute("/_auth/coach")({
  component: CoachListPage,
  validateSearch: coachSearch,
});

/**
 * AI runs only with the workspace switch on and the member's own consent.
 * A failed read does not block: sending says what is wrong.
 */
function useAiReady(): { ready: "ready" | "off" | "unknown" } & ReturnType<typeof useAiState> {
  const ai = useAiState();
  const ready = ai.status === "pending" ? "unknown" : ai.reason === null ? "ready" : "off";
  return { ready, ...ai };
}

function CoachListPage() {
  const threads = useQuery(orpc.ai.listThreads.queryOptions({ input: { limit: 50 } }));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settingsQuery = useProductSettings();
  const settings = settingsQuery.data;
  const { t, i18n } = useLingui();
  const search = Route.useSearch();
  const aiState = useAiReady();
  const ai = aiState.ready;
  const ideas = useCoachIdeas();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(search.ask ?? "");

  // A question handed over from an insight lands in the box, ready to edit.
  useEffect(() => {
    if (search.ask) setDraft(search.ask);
    if (search.ask || search.compose) composerRef.current?.focus();
  }, [search.ask, search.compose]);

  const start = useMutation(
    orpc.ai.chat.mutationOptions({
      onSuccess: async (result) => {
        setDraft("");
        await queryClient.invalidateQueries({ queryKey: orpc.ai.listThreads.key() });
        await navigate({
          to: "/coach/$conversationId",
          params: { conversationId: result.conversationId },
        });
      },
    }),
  );

  const send = () => {
    const message = draft.trim();
    if (!message) return;
    start.mutate({ conversationId: crypto.randomUUID(), message });
  };

  // The list is the layout's quiet left column; a conversation opens beside it.
  const hasThread = useChildMatches().length > 0;

  // #coach-0: a new conversation starts from an empty box the person fills.
  const onNew = () => {
    if (hasThread) {
      void navigate({ to: "/coach", search: { compose: true } });
      return;
    }
    composerRef.current?.focus();
  };

  // Issue #299: a used-up monthly allowance is not a failure; say when it resets.
  const startLimit = start.isError ? aiUsageLimitOf(start.error) : false;
  const list = threads.data ?? [];

  const conversations = (
    <nav aria-label={t`Conversations`} className={hasThread ? "order-last lg:order-none" : ""}>
      {threads.isPending ? (
        <div className="grid gap-3" aria-hidden="true">
          <Skeleton className="h-20 w-full rounded-3xl" />
          <Skeleton className="h-20 w-full rounded-3xl" />
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
          icon={CoachIcon}
          title={<Trans>No conversations yet</Trans>}
          description={<Trans>Your conversations with the coach appear here.</Trans>}
        />
      ) : (
        <div className="grid gap-2">
          {hasThread ? null : (
            <h2 className="text-base leading-tight font-semibold text-ink-2">
              <Trans>Conversations</Trans>
            </h2>
          )}
          <ul className="grid gap-2.5">
            {list.map((thread) => (
              <li key={thread.conversationId}>
                <Link
                  to="/coach/$conversationId"
                  params={{ conversationId: thread.conversationId }}
                  className="sheet flex items-start gap-3 p-4 text-ink-2 no-underline transition-transform duration-[var(--dur-short)] ease-[var(--ease-out)] hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-0 motion-reduce:transition-none"
                  activeProps={{
                    className: "ring-2 ring-signal/40 text-ink",
                    "aria-current": "page",
                  }}
                >
                  <ToneIcon icon={CoachIcon} tone="signal" size="sm" />
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="truncate text-sm font-semibold text-ink">
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
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );

  return (
    <Page>
      <ModuleHiddenNote module="coach" />
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            <ToneIcon icon={CoachIcon} tone="signal" />
            <Trans>Coach</Trans>
          </span>
        }
        actions={
          ai === "off" ? null : (
            <Button variant="outline" onClick={onNew}>
              <Plus aria-hidden="true" />
              <Trans>New conversation</Trans>
            </Button>
          )
        }
      />

      <ProductSettingsStatus />

      {ai === "off" ? (
        // #coach-1: say up front that the coach needs AI, and where to turn it on.
        <section
          aria-labelledby="coach-ai-off"
          className="sheet grid max-w-2xl justify-items-start gap-3 p-6"
        >
          <ToneIcon icon={CoachIcon} tone="signal" size="lg" />
          <h2 id="coach-ai-off" className="text-xl leading-tight text-ink">
            {aiState.reason === "workspace" ? (
              <Trans>The coach uses AI, which is off for this workspace</Trans>
            ) : (
              <Trans>The coach uses AI, which is off</Trans>
            )}
          </h2>
          {/* #settings-2: say which switch holds it, and offer it only to who can turn it on. */}
          <p className="max-w-[60ch] text-ink-2">
            {aiState.reason === "workspace" && !aiState.canManageWorkspace ? (
              <Trans>
                Only the workspace owner can turn it on. Everything else in OpenValens works as
                usual.
              </Trans>
            ) : (
              <Trans>Turn it on to ask about your own records. You can turn it off any time.</Trans>
            )}
          </p>
          {aiState.reason === "workspace" && !aiState.canManageWorkspace ? null : (
            <Button asChild>
              <Link to="/settings" hash="ai">
                <Trans>Turn on AI</Trans>
              </Link>
            </Button>
          )}
        </section>
      ) : hasThread ? (
        <div className="grid items-start gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {conversations}
          <div className="min-w-0">
            <Outlet />
          </div>
        </div>
      ) : (
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
          <div className="grid min-w-0 gap-5">
            <CoachComposer
              ref={composerRef}
              value={draft}
              onChange={setDraft}
              onSubmit={send}
              pending={start.isPending}
            />
            {startLimit ? (
              <p role="status" className="rounded-2xl bg-paper-2 px-4 py-3 text-sm text-ink-2">
                {i18n._(aiUsageLimitMessage(startLimit.resetsOn, i18n.locale))}
              </p>
            ) : start.isError ? (
              <ErrorState
                title={
                  <Trans>
                    Could not start a conversation. Check that AI is enabled in Settings.
                  </Trans>
                }
              />
            ) : null}
            <CoachScopeLine />
            <CoachIdeas
              groups={ideas}
              onPick={(text) => {
                setDraft(text);
                composerRef.current?.focus();
              }}
            />
          </div>
          {conversations}
        </div>
      )}
    </Page>
  );
}
