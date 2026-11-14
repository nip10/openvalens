import { Trans, useLingui } from "@lingui/react/macro";
import {
  domainLabel,
  groupTimelineByDay,
  severityTone,
  sourceLabel,
  timelineSummary,
  timelineTitle,
} from "@openvalens/api/presenters/timeline";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  ListChecks,
  PersonStanding,
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
import { z } from "zod";

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
  // `?source=ai_app:<grantId>` shows only what one connected AI app wrote
  // (#439, M2; linked from Settings → Connected AI apps).
  validateSearch: z.object({ source: z.string().min(1).max(200).optional() }),
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
  custom: { icon: ListChecks, tone: "signal" },
  pain: { icon: PersonStanding, tone: "weight" },
};
const OTHER_DOMAIN = { icon: Sparkles, tone: "signal" } as const;

function TimelinePage() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { i18n } = useLingui();
  const { source } = Route.useSearch();
  const query = useInfiniteQuery(
    orpc.timeline.list.infiniteOptions({
      input: (cursor: string | undefined) => ({
        limit: PAGE_SIZE,
        ...(source ? { source } : {}),
        ...(cursor ? { cursor } : {}),
      }),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
  );
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const groups = groupTimelineByDay(items, timeZone);

  return (
    <Page>
      <PageHeader title={<Trans>Timeline</Trans>} />

      {source ? (
        <p
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-2xl bg-paper-2 px-4 py-3 text-sm text-ink-2"
        >
          {source.startsWith("ai_app:") ? (
            <Trans>Showing only entries a connected AI app added.</Trans>
          ) : (
            <Trans>Showing only entries from one source.</Trans>
          )}
          <Link
            to="/records/timeline"
            className="font-medium text-ink underline-offset-4 hover:underline"
          >
            <Trans>Show everything</Trans>
          </Link>
        </p>
      ) : null}

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
                  const source = sourceLabel(item, i18n);
                  const summary = timelineSummary(item, i18n);
                  const look = DOMAIN_ICON[item.domain] ?? OTHER_DOMAIN;
                  return (
                    <li key={item.id} className="flex items-start gap-3 py-3">
                      <ToneIcon icon={look.icon} tone={look.tone} />
                      <div className="grid min-w-0 flex-1 gap-0.5">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-semibold text-ink">
                            {timelineTitle(item, i18n)}
                          </span>
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
                        {summary ? <p className="truncate text-ink-2">{summary}</p> : null}
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
