import { Trans, useLingui } from "@lingui/react/macro";
import {
  domainLabel,
  groupTimelineByDay,
  severityTone,
  sourceLabel,
} from "@openvalens/api/presenters/timeline";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { cn } from "@openvalens/ui/lib/utils";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, ErrorState, Page, PageHeader } from "@/components/page";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/records/timeline")({
  component: TimelinePage,
});

const PAGE_SIZE = 50;
const TONE_CLASS = {
  destructive: "text-destructive",
  warning: "text-warning",
} as const;

function TimelinePage() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { i18n } = useLingui();
  const query = useInfiniteQuery(
    orpc.timeline.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) }),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
  );
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const groups = groupTimelineByDay(items, timeZone);

  return (
    <Page>
      <PageHeader title={<Trans>Timeline</Trans>} />

      {query.isPending ? (
        <div className="sheet divide-y divide-rule">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="grid gap-4 px-5 py-4 md:grid-cols-[9rem_minmax(0,1fr)]">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState
          title={<Trans>Could not load the timeline.</Trans>}
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      ) : groups.length === 0 ? (
        <EmptyState
          title={<Trans>No records yet</Trans>}
          description={
            <Trans>Sync Health Connect or Apple Health from the mobile app, or add an entry.</Trans>
          }
        />
      ) : (
        <div className="grid justify-items-start gap-6">
          <div className="sheet w-full divide-y divide-rule">
            {groups.map((group) => (
              <section
                key={group.day}
                aria-label={group.day}
                className="grid gap-x-6 gap-y-1 px-5 pt-4 pb-2 md:grid-cols-[9rem_minmax(0,1fr)]"
              >
                <h2 className="num pt-2.5 text-sm font-normal text-ink-3">{group.day}</h2>
                <ul className="divide-y divide-rule">
                  {group.items.map((item) => {
                    const tone = severityTone(item.severity);
                    const source = sourceLabel(item);
                    return (
                      <li
                        key={item.id}
                        className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto]"
                      >
                        <span className="num pt-0.5 text-sm text-ink-3">{item.time}</span>
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-baseline gap-x-3">
                            <span className="font-display font-medium text-ink">{item.title}</span>
                            {tone ? (
                              <span className={cn("text-sm font-medium", TONE_CLASS[tone])}>
                                {item.severity === "critical" ? (
                                  <Trans>Needs attention</Trans>
                                ) : (
                                  <Trans>Check</Trans>
                                )}
                              </span>
                            ) : null}
                          </p>
                          {item.summary ? (
                            <p className="truncate text-sm text-ink-2">{item.summary}</p>
                          ) : null}
                        </div>
                        <div className="col-start-2 text-sm text-ink-3 sm:col-start-3 sm:text-right">
                          <div>{i18n._(domainLabel(item.domain))}</div>
                          {source ? <div>{source}</div> : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
          {query.hasNextPage ? (
            <Button
              variant="outline"
              // The Button primitive carries these; restated so the screen's states read here.
              className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              {query.isFetchingNextPage ? <Trans>Loading…</Trans> : <Trans>Load more</Trans>}
            </Button>
          ) : null}
        </div>
      )}
    </Page>
  );
}
