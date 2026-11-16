import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  collapseTimelineSamples,
  domainLabel,
  groupTimelineByDay,
  severityTone,
  sourceLabel,
  timelineSummary,
  timelineTitle,
  type TimelineItemLike,
} from "@openvalens/api/presenters/timeline";
import { Button } from "@openvalens/ui/components/button";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { cn } from "@openvalens/ui/lib/utils";
import { useInfiniteQuery, useQueries } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ChevronRight,
  ListChecks,
  PersonStanding,
  CalendarDays,
  Droplet,
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
  Search,
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
import {
  dayTotalsRanges,
  type DayFigures,
  TimelineDayFigures,
} from "@/components/timeline-day-figures";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";

/**
 * The filter chips under the title. Each is one or more timeline domains:
 * Vitals spans the vitals and cardiac domains (heart-rate samples are cardiac).
 */
const FILTERS = {
  sleep: { label: msg`Sleep`, domains: ["sleep"] },
  activity: { label: msg`Activity`, domains: ["activity"] },
  vitals: { label: msg`Vitals`, domains: ["vitals", "cardiac"] },
  body: { label: msg`Body`, domains: ["body"] },
  labs: { label: msg`Labs`, domains: ["labs", "imaging"] },
  supplements: { label: msg`Meds and supplements`, domains: ["meds_supplements"] },
  water: { label: msg`Water`, domains: ["water"] },
  trackers: { label: msg`Trackers`, domains: ["custom"] },
  pain: { label: msg`Pain`, domains: ["pain"] },
} as const satisfies Record<string, { label: MessageDescriptor; domains: readonly string[] }>;
type FilterId = keyof typeof FILTERS;
const FILTER_IDS = Object.keys(FILTERS) as [FilterId, ...FilterId[]];

export const Route = createFileRoute("/_auth/records/timeline")({
  // `?source=ai_app:<grantId>` shows only what one connected AI app wrote
  // (#439, M2; linked from Settings → Connected AI apps). `?show=` is a filter
  // chip, `?day=` jumps to a day (that day and earlier) and `?q=` searches
  // names, values and notes (timeline#3).
  validateSearch: z.object({
    source: z.string().min(1).max(200).optional(),
    show: z.enum(FILTER_IDS).optional().catch(undefined),
    day: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .catch(undefined),
    q: z.string().trim().min(1).max(100).optional().catch(undefined),
  }),
  component: TimelinePage,
});

/**
 * The server's page size. Passive readings fold into one row per measure and
 * day, so a full page keeps the day's other entries on screen.
 */
const PAGE_SIZE = 200;
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
  water: { icon: Droplet, tone: "water" },
};
const OTHER_DOMAIN = { icon: Sparkles, tone: "signal" } as const;

/** The end of a local calendar day as an ISO timestamp (the server's `to` is inclusive). */
function endOfLocalDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 23, 59, 59, 999).toISOString();
}

function todayIso(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

const CHIP =
  "inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-sm whitespace-nowrap transition-colors duration-[var(--dur-short)] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:bg-paper-3";
const CHIP_ON =
  "border-transparent bg-sidebar-accent font-semibold text-signal hover:bg-sidebar-accent";
const CHIP_OFF = "border-input bg-card text-ink-2";

/** timeline#6 — the day headers' figures, keyed by local date. */
function useDayFigures(days: readonly string[]): Map<string, DayFigures> {
  const ranges = dayTotalsRanges(days);
  const results = useQueries({
    queries: ranges.map((range) => ({
      ...orpc.timeline.dayTotals.queryOptions({ input: range }),
      staleTime: 60_000,
    })),
  });
  const figures = new Map<string, DayFigures>();
  for (const result of results) for (const day of result.data ?? []) figures.set(day.date, day);
  return figures;
}

/**
 * timeline#3 — one search box over names, values and notes. It waits for a
 * short pause in typing, then puts the words in the address (`?q=`).
 */
function TimelineSearch({ value, onSearch }: { value: string; onSearch: (value: string) => void }) {
  const { t } = useLingui();
  const [text, setText] = useState(value);
  const sent = useRef(value);
  const search = useRef(onSearch);
  search.current = onSearch;
  // A change from outside (a link that clears the search) resets the box.
  useEffect(() => {
    if (value !== sent.current) {
      sent.current = value;
      setText(value);
    }
  }, [value]);
  useEffect(() => {
    const words = text.trim();
    if (words === sent.current) return;
    const timer = window.setTimeout(() => {
      sent.current = words;
      search.current(words);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [text]);
  return (
    <div className="relative w-full sm:w-auto sm:min-w-[12rem] sm:max-w-xs sm:flex-1">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
        aria-hidden="true"
      />
      <input
        type="search"
        aria-label={t`Search the timeline`}
        placeholder={t`Search names and notes`}
        maxLength={100}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="h-9 w-full rounded-xl border border-input bg-card pr-3 pl-9 text-sm text-ink outline-2 -outline-offset-2 outline-transparent placeholder:text-ink-3 focus-visible:outline-ring"
      />
    </div>
  );
}

function TimelinePage() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { i18n, t } = useLingui();
  const { source, show, day, q } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const domains = show ? [...FILTERS[show].domains] : undefined;
  const query = useInfiniteQuery(
    orpc.timeline.list.infiniteOptions({
      input: (cursor: string | undefined) => ({
        limit: PAGE_SIZE,
        ...(source ? { source } : {}),
        ...(domains ? { domains } : {}),
        ...(day ? { to: endOfLocalDay(day) } : {}),
        ...(q ? { q } : {}),
        ...(cursor ? { cursor } : {}),
      }),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
  );
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const groups = groupTimelineByDay(items, timeZone);
  const filtered = Boolean(show || day || q);
  const settings = useProductSettings().data;
  const dayFigures = useDayFigures(groups.map((group) => group.day));

  return (
    <Page>
      <PageHeader title={<Trans>Timeline</Trans>} />

      <div className="grid min-w-0 gap-3">
        <nav
          aria-label={t`Filter the timeline`}
          className="-mx-4 min-w-0 overflow-x-auto px-4 [contain:inline-size] md:mx-0 md:px-0"
        >
          <ul className="flex w-max gap-2 md:w-auto md:flex-wrap">
            <li>
              <Link
                to="/records/timeline"
                search={(prev) => ({ ...prev, show: undefined })}
                aria-current={show ? undefined : "page"}
                className={cn(CHIP, show ? CHIP_OFF : CHIP_ON)}
              >
                <Trans>All</Trans>
              </Link>
            </li>
            {FILTER_IDS.map((id) => (
              <li key={id}>
                <Link
                  to="/records/timeline"
                  search={(prev) => ({ ...prev, show: id })}
                  aria-current={show === id ? "page" : undefined}
                  className={cn(CHIP, show === id ? CHIP_ON : CHIP_OFF)}
                >
                  {i18n._(FILTERS[id].label)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <TimelineSearch
            value={q ?? ""}
            onSearch={(value) =>
              void navigate({ search: (prev) => ({ ...prev, q: value || undefined }) })
            }
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Label htmlFor="timeline-day" className="text-ink-3">
              <Trans>Go to a day</Trans>
            </Label>
            <input
              id="timeline-day"
              type="date"
              max={todayIso()}
              value={day ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    day: /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined,
                  }),
                });
              }}
              className="h-9 rounded-xl border border-input bg-card px-3 text-sm text-ink outline-2 -outline-offset-2 outline-transparent focus-visible:outline-ring"
            />
            {day ? (
              <Link
                to="/records/timeline"
                search={(prev) => ({ ...prev, day: undefined })}
                className="font-medium text-ink underline-offset-4 hover:underline"
              >
                <Trans>Back to today</Trans>
              </Link>
            ) : null}
          </div>
        </div>
      </div>

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
        filtered ? (
          <EmptyState
            icon={History}
            title={<Trans>Nothing here</Trans>}
            description={
              q ? (
                <Trans>No entries match “{q}”.</Trans>
              ) : (
                <Trans>No entries match this filter.</Trans>
              )
            }
          />
        ) : (
          <EmptyState
            icon={History}
            title={<Trans>No records yet</Trans>}
            description={
              <Trans>
                Sync Health Connect or Apple Health from the mobile app, or add an entry.
              </Trans>
            }
          />
        )
      ) : (
        <div className="grid min-w-0 justify-items-start gap-6">
          {groups.map((group) => (
            <section
              key={group.day}
              aria-label={group.day}
              className="grid w-full min-w-0 grid-cols-1 gap-2"
            >
              {/* The day and its figures stay in view while its entries scroll (below the phone top bar). */}
              <div className="sticky top-14 z-10 grid gap-1 bg-paper py-2 lg:top-0">
                <h2 className="text-xl leading-tight text-ink">
                  <time dateTime={group.day}>{friendlyDate(i18n, group.day)}</time>
                </h2>
                <TimelineDayFigures figures={dayFigures.get(group.day)} settings={settings} />
              </div>
              <ul className="sheet grid grid-cols-1 divide-y divide-rule px-4 py-1">
                {collapseTimelineSamples(group.items, i18n).map((row) =>
                  row.type === "entry" ? (
                    <li key={row.key}>
                      <EntryLine item={row.item} time={row.item.time} />
                    </li>
                  ) : (
                    <li key={row.key}>
                      <details className="group">
                        <summary className="-mx-2 cursor-pointer list-none rounded-2xl px-2 transition-colors duration-[var(--dur-short)] hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                          <EntryLine
                            item={row.items[0]!}
                            summary={row.summary}
                            time={row.timeRange}
                            expandable
                          />
                        </summary>
                        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 pb-3 pl-11 text-sm text-ink-2 sm:grid-cols-4">
                          {row.items.map((reading) => (
                            <li key={reading.id} className="flex gap-2 tabular-nums">
                              <span className="text-ink-3">{reading.time}</span>
                              <span>{timelineSummary(reading, i18n)}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  ),
                )}
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

/**
 * One entry on one line: the icon (which names the area), name and value on
 * the left, source and time on the right. The source gives way on a phone.
 */
function EntryLine({
  item,
  summary,
  time,
  expandable = false,
}: {
  item: TimelineItemLike;
  /** Overrides the entry's own value (a folded row's "44 readings · 52–95 bpm"). */
  summary?: string;
  time: string;
  expandable?: boolean;
}) {
  const { i18n } = useLingui();
  const tone = severityTone(item.severity);
  const source = sourceLabel(item, i18n);
  const value = summary ?? timelineSummary(item, i18n);
  const look = DOMAIN_ICON[item.domain] ?? OTHER_DOMAIN;
  return (
    <div className="flex min-h-12 items-center gap-3 py-2">
      <ToneIcon icon={look.icon} tone={look.tone} size="sm" />
      <span className="sr-only">{i18n._(domainLabel(item.domain))}</span>
      <p className="flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 truncate">
          <span className="font-semibold text-ink">{timelineTitle(item, i18n)}</span>
          {value ? <span className="text-ink-2"> {value}</span> : null}
        </span>
        {tone ? (
          <StatusPill tone={tone === "destructive" ? "bad" : "warn"}>
            {item.severity === "critical" ? <Trans>Needs attention</Trans> : <Trans>Check</Trans>}
          </StatusPill>
        ) : null}
      </p>
      <span className="flex shrink-0 items-center gap-1.5 text-sm text-ink-3 tabular-nums">
        {source ? <span className="hidden sm:inline">{time ? `${source} ·` : source}</span> : null}
        {/* A workout session has a day but no time of day (#493). */}
        {time ? <span>{time}</span> : null}
        {expandable ? (
          <ChevronRight
            className="size-4 transition-transform duration-[var(--dur-short)] group-open:rotate-90 motion-reduce:transition-none"
            aria-hidden="true"
          />
        ) : null}
      </span>
    </div>
  );
}
