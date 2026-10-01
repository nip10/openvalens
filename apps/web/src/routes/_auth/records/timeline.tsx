import {
  domainLabel,
  groupTimelineByDay,
  severityTone,
  sourceLabel,
} from "@openhealth/api/presenters/timeline";
import { Badge } from "@openhealth/ui/components/badge";
import { Button } from "@openhealth/ui/components/button";
import { Card, CardContent } from "@openhealth/ui/components/card";
import { Skeleton } from "@openhealth/ui/components/skeleton";
import { cn } from "@openhealth/ui/lib/utils";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/records/timeline")({
  component: TimelinePage,
});

const PAGE_SIZE = 50;
const TONE_CLASS = {
  destructive: "border-destructive/40 bg-destructive/10 text-destructive",
  warning: "border-warning/40 bg-warning/10 text-warning",
} as const;

function TimelinePage() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
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
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-semibold">Timeline</h1>

      {query.isPending ? (
        <div className="grid gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <p className="text-sm text-muted-foreground">
          Could not load the timeline.{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">No records yet</p>
            <p className="text-sm text-muted-foreground">
              Sync Health Connect or Apple Health from the mobile app, or add an entry.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          {groups.map((group) => (
            <section key={group.day} aria-label={group.day}>
              <h2 className="mb-2 font-mono text-sm text-muted-foreground">{group.day}</h2>
              <Card className="py-0">
                <ul className="divide-y divide-border">
                  {group.items.map((item) => {
                    const tone = severityTone(item.severity);
                    const source = sourceLabel(item);
                    return (
                      <li key={item.id} className="flex items-start gap-4 px-4 py-3">
                        <span className="w-12 shrink-0 pt-0.5 font-mono text-sm text-muted-foreground">
                          {item.time}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{item.title}</span>
                            {tone ? (
                              <Badge variant="outline" className={cn(TONE_CLASS[tone])}>
                                {item.severity === "critical" ? "Needs attention" : "Check"}
                              </Badge>
                            ) : null}
                          </div>
                          {item.summary ? (
                            <p className="truncate text-sm text-muted-foreground">{item.summary}</p>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-right text-xs text-muted-foreground">
                          <div>{domainLabel(item.domain)}</div>
                          {source ? <div>{source}</div> : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))}
          {query.hasNextPage ? (
            <Button
              variant="outline"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              {query.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
