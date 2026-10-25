import { Trans, useLingui } from "@lingui/react/macro";
import {
  domainLabel,
  groupTimelineByDay,
  severityTone,
  sourceLabel,
} from "@openvalens/api/presenters/timeline";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  CalendarDays,
  Footprints,
  FlaskConical,
  HeartPulse,
  History,
  type LucideIcon,
  Moon,
  Pill,
  RefreshCw,
  Scale,
  ScanLine,
  Sparkles,
} from "lucide-react";

import {
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  StatusPill,
  ToneIcon,
  type Tone,
} from "@/components/page";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/records/timeline")({
  component: TimelinePage,
});

const PAGE_SIZE = 50;
const DOMAIN_ICON: Record<string, { icon: LucideIcon; tone: Tone }> = {
  sleep: { icon: Moon, tone: "sleep" },
  activity: { icon: Footprints, tone: "steps" },
  body: { icon: Scale, tone: "weight" },
  vitals: { icon: HeartPulse, tone: "heart" },
  labs: { icon: FlaskConical, tone: "water" },
  meds_supplements: { icon: Pill, tone: "food" },
  calendar: { icon: CalendarDays, tone: "signal" },
  sync: { icon: RefreshCw, tone: "signal" },
  imaging: { icon: ScanLine, tone: "water" },
  cardiac: { icon: Activity, tone: "heart" },
};
const OTHER_DOMAIN = { icon: Sparkles, tone: "signal" } as const;

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
        <div className="grid gap-6">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="grid gap-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-36 w-full rounded-3xl" />
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
          icon={History}
          title={<Trans>No records yet</Trans>}
          description={
            <Trans>Sync Health Connect or Apple Health from the mobile app, or add an entry.</Trans>
          }
        />
      ) : (
        <div className="grid justify-items-start gap-8">
          {groups.map((group) => (
            <section key={group.day} aria-label={group.day} className="grid w-full gap-3">
              <h2 className="text-xl leading-tight text-ink">
                <time dateTime={group.day}>{friendlyDate(i18n, group.day)}</time>
              </h2>
              <ul className="sheet grid divide-y divide-rule px-4 py-1">
                {group.items.map((item) => {
                  const tone = severityTone(item.severity);
                  const source = sourceLabel(item);
                  const look = DOMAIN_ICON[item.domain] ?? OTHER_DOMAIN;
                  return (
                    <li key={item.id} className="flex items-start gap-3 py-3">
                      <ToneIcon icon={look.icon} tone={look.tone} />
                      <div className="grid min-w-0 flex-1 gap-0.5">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-semibold text-ink">{item.title}</span>
                          {tone ? (
                            <StatusPill tone={tone === "destructive" ? "bad" : "warn"}>
                              {item.severity === "critical" ? (
                                <Trans>Needs attention</Trans>
                              ) : (
                                <Trans>Check</Trans>
                              )}
                            </StatusPill>
                          ) : null}
                        </p>
                        {item.summary ? (
                          <p className="truncate text-ink-2">{item.summary}</p>
                        ) : null}
                        <p className="text-sm text-ink-3">
                          {i18n._(domainLabel(item.domain))}
                          {source ? ` · ${source}` : ""}
                        </p>
                      </div>
                      <span className="num shrink-0 pt-0.5 text-sm text-ink-3">{item.time}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
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
